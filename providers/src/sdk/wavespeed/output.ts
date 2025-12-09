import type { WavespeedResult } from './client.js';

/**
 * Normalizes wavespeed-ai API output to extract URL strings.
 *
 * Wavespeed returns: { data: { outputs: ["url1", "url2", ...] } }
 */
export function normalizeWavespeedOutput(result: WavespeedResult): string[] {
  if (!result.data || !Array.isArray(result.data.outputs)) {
    return [];
  }
  return result.data.outputs.filter((url): url is string => typeof url === 'string' && url.length > 0);
}
