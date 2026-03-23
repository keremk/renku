/**
 * Test utility for resolving catalog paths.
 * Tests should use this instead of hardcoded paths so provider tests
 * stay decoupled from the production catalog.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root directory */
export const REPO_ROOT = resolve(__dirname, '..', '..');

/** Shared test fixtures root used across packages */
export const SHARED_TEST_FIXTURES_ROOT = resolve(
  REPO_ROOT,
  'tests',
  'shared-fixtures'
);

/** Shared media fixtures used by CLI and providers tests */
export const SHARED_TEST_MEDIA_ROOT = resolve(
  SHARED_TEST_FIXTURES_ROOT,
  'media'
);

/** Shared test catalog used across packages */
export const SHARED_TEST_CATALOG_ROOT = resolve(
  SHARED_TEST_FIXTURES_ROOT,
  'catalog'
);

/** Providers test fixtures directory */
export const TEST_FIXTURES_ROOT = resolve(__dirname, 'fixtures');

/** Fully decoupled shared catalog snapshot used by providers tests */
export const CATALOG_ROOT = SHARED_TEST_CATALOG_ROOT;

/** Blueprints directory within the catalog */
export const CATALOG_BLUEPRINTS_ROOT = resolve(CATALOG_ROOT, 'blueprints');

/** Models directory within the catalog */
export const CATALOG_MODELS_ROOT = resolve(CATALOG_ROOT, 'models');

/** Producers directory within the catalog */
export const CATALOG_PRODUCERS_ROOT = resolve(CATALOG_ROOT, 'producers');
