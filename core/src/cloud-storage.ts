import {
  createStorageContext,
  type CloudStorageConfig,
  type StorageContext,
} from './storage.js';
import process  from 'process';

/**
 * Result of checking for cloud storage configuration in environment variables.
 */
export interface CloudStorageEnvConfig {
  /** Whether all required environment variables are set. */
  isConfigured: boolean;
  /** The cloud storage configuration if all required vars are present. */
  config: CloudStorageConfig | null;
  /** List of missing required environment variables. */
  missingVars: string[];
}

/**
 * Required environment variables for cloud storage.
 */
const REQUIRED_ENV_VARS = [
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'S3_BUCKET',
] as const;

/**
 * Load cloud storage configuration from environment variables.
 *
 * Required environment variables:
 * - S3_ACCESS_KEY_ID: Access key ID
 * - S3_SECRET_ACCESS_KEY: Secret access key
 * - S3_ENDPOINT: S3-compatible endpoint URL (e.g., https://<account-id>.r2.cloudflarestorage.com)
 * - S3_BUCKET: Bucket name
 *
 * Optional:
 * - S3_REGION: Region (defaults to 'auto' for CloudFlare R2)
 */
export function loadCloudStorageEnv(): CloudStorageEnvConfig {
  const missingVars = REQUIRED_ENV_VARS.filter((v) => !process.env[v]);

  if (missingVars.length > 0) {
    return {
      isConfigured: false,
      config: null,
      missingVars: [...missingVars],
    };
  }

  return {
    isConfigured: true,
    config: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      endpoint: process.env.S3_ENDPOINT!,
      bucket: process.env.S3_BUCKET!,
      region: process.env.S3_REGION,
    },
    missingVars: [],
  };
}

/**
 * Create a cloud storage context from a cloud storage configuration.
 *
 * @param config - Cloud storage configuration (from loadCloudStorageEnv() or manually created)
 * @param basePath - Optional base path prefix (defaults to 'builds')
 * @returns A StorageContext configured for S3-compatible cloud storage
 */
export function createCloudStorageContext(
  config: CloudStorageConfig,
  basePath?: string
): StorageContext {
  return createStorageContext({
    kind: 'cloud',
    cloudConfig: config,
    basePath,
  });
}
