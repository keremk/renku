/**
 * Shared plan-generation helpers used by both CLI and viewer.
 *
 * These functions handle storage operations around planning (copying
 * run archives/events to memory, persisting blobs, building provider metadata,
 * converting artifact overrides, deriving surgical info). Extracted to
 * eliminate duplication between CLI planner.ts and viewer plan-handler.ts.
 */

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { StorageContext } from '../storage.js';
import { inferMimeType } from '../blob-utils.js';
import { persistInputBlob } from '../input-blob-storage.js';
import type { BuildState } from '../types.js';
import type { ArtifactOverride } from '../parsing/input-loader.js';
import type { PendingArtifactDraft, ProviderOptionEntry } from './planning-service.js';
import type { ProducerOptionsMap } from './producer-options.js';

// ---------------------------------------------------------------------------
// Storage copy helpers
// ---------------------------------------------------------------------------

/**
 * Copy existing run archives from local storage to in-memory storage.
 */
export async function copyRunArchivesToMemory(
  localCtx: StorageContext,
  memoryCtx: StorageContext,
  movieId: string,
): Promise<void> {
  const runsDir = localCtx.resolve(movieId, 'runs');
  if (!(await localCtx.storage.directoryExists(runsDir))) {
    return;
  }

  const listing = localCtx.storage.list(runsDir, { deep: true });
  for await (const item of listing) {
    if (item.type !== 'file') {
      continue;
    }
    const content = await localCtx.storage.readToUint8Array(item.path);
    await memoryCtx.storage.write(item.path, Buffer.from(content), {
      mimeType: item.path.endsWith('.json')
        ? 'application/json'
        : 'application/x-yaml',
    });
  }
}

export async function copyPlansToMemory(
  localCtx: StorageContext,
  memoryCtx: StorageContext,
  movieId: string,
): Promise<void> {
  const runsDir = localCtx.resolve(movieId, 'runs');
  if (!(await localCtx.storage.directoryExists(runsDir))) {
    return;
  }

  const listing = localCtx.storage.list(runsDir, { deep: false });
  for await (const item of listing) {
    if (item.type !== 'file' || !item.path.endsWith('-plan.json')) {
      continue;
    }
    const content = await localCtx.storage.readToUint8Array(item.path);
    await memoryCtx.storage.write(item.path, Buffer.from(content), {
      mimeType: 'application/json',
    });
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
  const eventFiles = ['events/inputs.log', 'events/artifacts.log'];
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
 * Convert artifact overrides from inputs to PendingArtifactDraft objects.
 * Computes blob hash from the data for dirty tracking.
 */
export function convertArtifactOverridesToDrafts(overrides: ArtifactOverride[]): PendingArtifactDraft[] {
  return overrides.map((override) => {
    const buffer = Buffer.isBuffer(override.blob.data)
      ? override.blob.data
      : Buffer.from(override.blob.data);
    const hash = createHash('sha256').update(buffer).digest('hex');

    return {
      artifactId: override.artifactId,
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

export interface SurgicalInfo {
  targetArtifactId: string;
  sourceJobId: string;
}

/**
 * Derive surgical regeneration info from the current build state for multiple artifacts.
 */
export function deriveSurgicalInfoArray(
  regenerateArtifactIds: string[],
  buildState: BuildState,
): SurgicalInfo[] | undefined {
  const results: SurgicalInfo[] = [];
  for (const artifactId of regenerateArtifactIds) {
    const entry = buildState.artifacts[artifactId];
    if (!entry) {
      continue;
    }
    results.push({
      targetArtifactId: artifactId,
      sourceJobId: entry.producedBy,
    });
  }
  return results.length > 0 ? results : undefined;
}
