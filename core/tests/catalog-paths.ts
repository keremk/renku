/**
 * Test utility for resolving catalog paths.
 * Tests should use this instead of importing from CLI to avoid cross-package dependencies.
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

/** Shared test catalog used across packages */
export const SHARED_TEST_CATALOG_ROOT = resolve(
  SHARED_TEST_FIXTURES_ROOT,
  'catalog'
);

/** Shared blueprint producer modules hosted in core test fixtures */
export const SHARED_BLUEPRINT_MODULES_ROOT = resolve(
  __dirname,
  'fixtures',
  '_shared'
);

/** Test fixtures directory */
export const TEST_FIXTURES_ROOT = resolve(__dirname, 'fixtures');

/** Repository catalog root consumed by core tests */
export const CATALOG_ROOT = resolve(REPO_ROOT, 'catalog');

/** Blueprints directory within the catalog */
export const CATALOG_BLUEPRINTS_ROOT = resolve(CATALOG_ROOT, 'blueprints');

/** Models directory within the catalog */
export const CATALOG_MODELS_ROOT = resolve(CATALOG_ROOT, 'models');

/** Producers directory within the catalog */
export const CATALOG_PRODUCERS_ROOT = resolve(CATALOG_ROOT, 'producers');
