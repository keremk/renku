import { inferBlobExtension } from '@gorenku/core';
import { createHash } from 'node:crypto';
import type { ProviderInputFile } from './provider-adapter.js';

const SIMULATED_PROVIDER_CLIENT = Symbol('simulated-provider-client');

export interface SimulatedProviderClient {
  readonly [SIMULATED_PROVIDER_CLIENT]: true;
  readonly provider: string;
}

export function createSimulatedProviderClient(
  provider: string
): SimulatedProviderClient {
  return {
    [SIMULATED_PROVIDER_CLIENT]: true,
    provider,
  };
}

export function isSimulatedProviderClient(
  client: unknown
): client is SimulatedProviderClient {
  if (!client || typeof client !== 'object') {
    return false;
  }

  return (
    (client as Record<PropertyKey, unknown>)[SIMULATED_PROVIDER_CLIENT] === true
  );
}

export function buildSimulatedUploadUrl(
  file: ProviderInputFile,
  providerName: string
): string {
  const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
  const hash = createHash('sha256').update(data).digest('hex');
  const ext = inferBlobExtension(file.mimeType);
  const safeProvider = providerName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const suffix = ext ? `.${ext}` : '';
  return `https://simulated.${safeProvider}.files.invalid/blobs/${hash.slice(0, 2)}/${hash}${suffix}`;
}
