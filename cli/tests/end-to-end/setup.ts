/**
 * E2E test setup - sets mock API keys for dry-run tests
 *
 * Dry-run mode requires API key validation (same as live mode)
 * to ensure configuration errors are caught early.
 */

const testProviderSecrets: Record<string, string> = {
  OPENAI_API_KEY: 'test-openai-api-key-for-e2e-dry-run',
  AI_GATEWAY_API_KEY: 'test-ai-gateway-api-key-for-e2e-dry-run',
  REPLICATE_API_TOKEN: 'test-replicate-api-token-for-e2e-dry-run',
  FAL_KEY: 'test-fal-key-for-e2e-dry-run',
  WAVESPEED_API_KEY: 'test-wavespeed-api-key-for-e2e-dry-run',
  ELEVENLABS_API_KEY: 'test-elevenlabs-api-key-for-e2e-dry-run',
};

for (const [key, value] of Object.entries(testProviderSecrets)) {
  process.env[key] = value;
}
