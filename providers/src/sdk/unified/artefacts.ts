import { Buffer } from 'node:buffer';
import type { ProducedArtefact } from '@renku/core';
import type { ProviderMode } from '../../types.js';

export interface BuildArtefactsOptions {
  produces: string[];
  urls: string[];
  mimeType: string;
  mode?: ProviderMode;
}

/**
 * Downloads binary data from URLs and creates ProducedArtefact objects.
 * Handles missing URLs and download failures gracefully.
 */
export async function buildArtefactsFromUrls(options: BuildArtefactsOptions): Promise<ProducedArtefact[]> {
  const { produces, urls, mimeType, mode } = options;
  const artefacts: ProducedArtefact[] = [];
  const useMockDownloads = mode === 'simulated';

  for (let index = 0; index < produces.length; index += 1) {
    const providedId = produces[index];
    const artefactId = providedId && providedId.length > 0 ? providedId : `Artifact:Output#${index}`;
    const url = urls[index];

    if (!url) {
      artefacts.push({
        artefactId,
        status: 'failed',
        diagnostics: {
          reason: 'missing_output',
          index,
        },
      });
      continue;
    }

    try {
      const buffer = useMockDownloads
        ? Buffer.from(`simulated-output:${artefactId}`)
        : await downloadBinary(url);
      artefacts.push({
        artefactId,
        status: 'succeeded',
        blob: {
          data: buffer,
          mimeType,
        },
        diagnostics: {
          sourceUrl: url,
        },
      });
    } catch (error) {
      artefacts.push({
        artefactId,
        status: 'failed',
        diagnostics: {
          reason: 'download_failed',
          url,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return artefacts;
}

/**
 * Downloads binary data from a URL and returns it as a Buffer.
 */
export async function downloadBinary(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
