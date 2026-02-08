/**
 * Shared plan-generation helpers used by both CLI and viewer.
 *
 * These functions handle storage operations around planning (copying
 * manifests/events to memory, persisting blobs, building provider metadata,
 * converting artifact overrides, deriving surgical info). Extracted to
 * eliminate duplication between CLI planner.ts and viewer plan-handler.ts.
 */

import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import type { StorageContext } from '../storage.js';
import { inferMimeType } from '../blob-utils.js';
import { persistInputBlob } from '../input-blob-storage.js';
import type { Manifest } from '../types.js';
import type { ArtifactOverride } from '../parsing/input-loader.js';
import type { PendingArtefactDraft, ProviderOptionEntry } from './planning-service.js';
import type { ProducerOptionsMap } from './producer-options.js';

// ---------------------------------------------------------------------------
// Storage copy helpers
// ---------------------------------------------------------------------------

/**
 * Copy existing manifest from local storage to in-memory storage.
 */
export async function copyManifestToMemory(
  localCtx: StorageContext,
  memoryCtx: StorageContext,
  movieId: string,
): Promise<void> {
  const currentJsonPath = localCtx.resolve(movieId, 'current.json');
  if (await localCtx.storage.fileExists(currentJsonPath)) {
    const content = await localCtx.storage.readToString(currentJsonPath);
    const memoryPath = memoryCtx.resolve(movieId, 'current.json');
    await memoryCtx.storage.write(memoryPath, content, { mimeType: 'application/json' });

    const parsed = JSON.parse(content) as { manifestPath?: string | null };
    if (parsed.manifestPath) {
      const manifestFullPath = localCtx.resolve(movieId, parsed.manifestPath);
      if (await localCtx.storage.fileExists(manifestFullPath)) {
        const manifestContent = await localCtx.storage.readToString(manifestFullPath);
        const memoryManifestPath = memoryCtx.resolve(movieId, parsed.manifestPath);
        await memoryCtx.storage.write(memoryManifestPath, manifestContent, { mimeType: 'application/json' });
      }
    }
  }
}

/**
 * Copy existing event logs from local storage to in-memory storage.
 */
export async function copyEventsToMemory(
  localCtx: StorageContext,
  memoryCtx: StorageContext,
  movieId: string,
): Promise<void> {
  const eventFiles = ['events/inputs.log', 'events/artefacts.log'];
  for (const eventFile of eventFiles) {
    const localPath = localCtx.resolve(movieId, eventFile);
    if (await localCtx.storage.fileExists(localPath)) {
      const content = await localCtx.storage.readToString(localPath);
      const memoryPath = memoryCtx.resolve(movieId, eventFile);
      await memoryCtx.storage.write(memoryPath, content, { mimeType: 'text/plain' });
    }
  }
}

/**
 * Copy blobs from in-memory storage to local storage.
 */
export async function copyBlobsFromMemoryToLocal(
  memoryCtx: StorageContext,
  localCtx: StorageContext,
  movieId: string,
): Promise<void> {
  const blobsDir = memoryCtx.resolve(movieId, 'blobs');

  if (!(await memoryCtx.storage.directoryExists(blobsDir))) {
    return;
  }

  const listing = memoryCtx.storage.list(blobsDir, { deep: true });

  for await (const item of listing) {
    if (item.type === 'file') {
      const content = await memoryCtx.storage.readToUint8Array(item.path);
      const ext = item.path.split('.').pop() || '';
      const mimeType = inferMimeType(ext);
      const buffer = Buffer.from(content);
      await localCtx.storage.write(item.path, buffer, { mimeType });
    }
  }
}

// ---------------------------------------------------------------------------
// Provider metadata
// ---------------------------------------------------------------------------

export interface CatalogSchemaOptions {
  catalogModelsDir: string | null;
  modelCatalog?: unknown;
}

/**
 * Build the provider metadata map needed by the planning service.
 *
 * @param loadModelInputSchema - Function to load input schema from catalog.
 *   Injected to avoid a hard dependency on @gorenku/providers from core.
 */
export async function buildProviderMetadata(
  options: ProducerOptionsMap,
  catalogOptions: CatalogSchemaOptions,
  loadModelInputSchema?: (
    catalogModelsDir: string,
    modelCatalog: unknown,
    provider: string,
    model: string,
  ) => Promise<string | null | undefined>,
): Promise<Map<string, ProviderOptionEntry>> {
  const { catalogModelsDir, modelCatalog } = catalogOptions;
  const map = new Map<string, ProviderOptionEntry>();

  for (const [key, entries] of options) {
    const primary = entries[0];
    if (!primary) {
      continue;
    }

    let inputSchema = primary.inputSchema;
    if (!inputSchema && catalogModelsDir && modelCatalog && primary.provider && primary.model && loadModelInputSchema) {
      inputSchema = (await loadModelInputSchema(catalogModelsDir, modelCatalog, primary.provider, primary.model)) ?? undefined;
    }

    map.set(key, {
      sdkMapping: primary.sdkMapping,
      outputs: primary.outputs,
      inputSchema,
      outputSchema: primary.outputSchema,
      config: primary.config,
      selectionInputKeys: primary.selectionInputKeys,
      configInputPaths: primary.configInputPaths,
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Artifact overrides
// ---------------------------------------------------------------------------

/**
 * Convert artifact overrides from inputs to PendingArtefactDraft objects.
 * Computes blob hash from the data for dirty tracking.
 */
export function convertArtifactOverridesToDrafts(overrides: ArtifactOverride[]): PendingArtefactDraft[] {
  return overrides.map((override) => {
    const buffer = Buffer.isBuffer(override.blob.data)
      ? override.blob.data
      : Buffer.from(override.blob.data);
    const hash = createHash('sha256').update(buffer).digest('hex');

    return {
      artefactId: override.artifactId,
      producedBy: 'user-override',
      output: {
        blob: {
          hash,
          size: buffer.byteLength,
          mimeType: override.blob.mimeType,
        },
      },
    };
  });
}

/**
 * Persist artifact override blobs to storage before converting to drafts.
 */
export async function persistArtifactOverrideBlobs(
  overrides: ArtifactOverride[],
  storage: StorageContext,
  movieId: string,
): Promise<ArtifactOverride[]> {
  for (const override of overrides) {
    await persistInputBlob(storage, movieId, override.blob);
  }
  return overrides;
}

// ---------------------------------------------------------------------------
// Surgical regeneration
// ---------------------------------------------------------------------------

export interface PlanSurgicalInfo {
  targetArtifactId: string;
  sourceJobId: string;
}

/**
 * Derive surgical regeneration info from the manifest for multiple artifacts.
 */
export function deriveSurgicalInfoArray(
  targetArtifactIds: string[],
  manifest: Manifest,
): PlanSurgicalInfo[] | undefined {
  const results: PlanSurgicalInfo[] = [];
  for (const targetArtifactId of targetArtifactIds) {
    const entry = manifest.artefacts[targetArtifactId];
    if (!entry) {
      continue;
    }
    results.push({
      targetArtifactId,
      sourceJobId: entry.producedBy,
    });
  }
  return results.length > 0 ? results : undefined;
}
