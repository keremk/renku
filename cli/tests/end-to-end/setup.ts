/**
 * E2E test setup - sets mock API keys for dry-run tests
 *
 * Dry-run mode requires API key validation (same as live mode)
 * to ensure configuration errors are caught early.
 */

// Set mock API key for OpenAI provider
process.env.OPENAI_API_KEY = 'test-api-key-for-e2e-dry-run';
