/**
 * Test utility for resolving catalog paths.
 * Tests should use these paths for stable catalog and fixture resolution.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
/** Repository root directory */
export const REPO_ROOT = resolve(__dirname, '..', '..');
/** Shared test fixtures root used across packages */
export const SHARED_TEST_FIXTURES_ROOT = resolve(REPO_ROOT, 'tests', 'shared-fixtures');
/** Shared media fixtures used by CLI and providers tests */
export const SHARED_TEST_MEDIA_ROOT = resolve(SHARED_TEST_FIXTURES_ROOT, 'media');
/** Shared test catalog used across packages */
export const SHARED_TEST_CATALOG_ROOT = resolve(SHARED_TEST_FIXTURES_ROOT, 'catalog');
/** CLI test fixtures directory */
export const CLI_TEST_FIXTURES_ROOT = resolve(__dirname, 'fixtures');
/** Catalog root consumed by CLI tests */
export const CATALOG_ROOT = resolve(REPO_ROOT, 'catalog');
/** Catalog source copied by CLI init/update tests */
export const CLI_FIXTURES_CATALOG = CATALOG_ROOT;
/** Blueprints directory within the catalog */
export const CATALOG_BLUEPRINTS_ROOT = resolve(CATALOG_ROOT, 'blueprints');
/** Models directory within the catalog */
export const CATALOG_MODELS_ROOT = resolve(CATALOG_ROOT, 'models');
/** Producers directory within the catalog */
export const CATALOG_PRODUCERS_ROOT = resolve(CATALOG_ROOT, 'producers');
/** CLI fixtures subdirectories */
export const CLI_FIXTURES_BLUEPRINTS = resolve(CLI_TEST_FIXTURES_ROOT, 'blueprints');
export const CLI_FIXTURES_BLUEPRINT_MODULES = resolve(CLI_FIXTURES_BLUEPRINTS, '_shared');
export const CLI_FIXTURES_INPUTS = resolve(CLI_TEST_FIXTURES_ROOT, 'inputs');
export const CLI_FIXTURES_MEDIA = resolve(CLI_TEST_FIXTURES_ROOT, 'media');
export const CLI_FIXTURES_PRODUCERS = resolve(CLI_TEST_FIXTURES_ROOT, 'producers');
export const CLI_FIXTURES_SCHEMAS = resolve(CLI_TEST_FIXTURES_ROOT, 'schemas');
