import type { SecretResolver, ProviderLogger, ProviderMode } from '../../types.js';
import type { SchemaRegistry } from '../../schema-registry.js';

/**
 * Provider adapter interface for unified handler.
 * Each provider (replicate, fal-ai, wavespeed-ai) implements this interface
 * to handle provider-specific API invocation and output parsing.
 */
export interface ProviderAdapter {
  /** Provider identifier (e.g., 'replicate', 'fal-ai', 'wavespeed-ai') */
  readonly name: string;

  /** Environment variable name for the API key */
  readonly secretKey: string;

  /** Initialize and return the provider client */
  createClient(options: ClientOptions): Promise<ProviderClient>;

  /** Format the model identifier for API calls (provider-specific) */
  formatModelIdentifier(model: string): string;

  /** Execute the API call and return raw output */
  invoke(client: ProviderClient, model: string, input: Record<string, unknown>): Promise<unknown>;

  /** Extract URLs from provider-specific response structure */
  normalizeOutput(response: unknown): string[];

  /**
   * Optional: Create a provider-specific retry wrapper.
   * If undefined, no retry wrapping is applied.
   * Each provider can implement its own retry strategy based on how it handles 429 errors.
   */
  createRetryWrapper?: (options: RetryWrapperOptions) => RetryWrapper;
}

/**
 * Options passed to create a retry wrapper.
 */
export interface RetryWrapperOptions {
  logger?: ProviderLogger;
  jobId: string;
  model: string;
  plannerContext: Record<string, unknown>;
}

/**
 * Retry wrapper that can wrap an async function with retry logic.
 */
export interface RetryWrapper {
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

export interface ClientOptions {
  secretResolver: SecretResolver;
  logger?: ProviderLogger;
  mode: ProviderMode;
  schemaRegistry?: SchemaRegistry;
}

/**
 * Opaque client type - each provider has its own client implementation.
 */
export type ProviderClient = unknown;
