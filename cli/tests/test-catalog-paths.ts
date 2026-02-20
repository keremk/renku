/**
 * Test utility for resolving catalog paths.
 * Tests should use these paths to stay decoupled from the production catalog.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root directory */
export const REPO_ROOT = resolve(__dirname, '..', '..');

/** CLI test fixtures directory */
export const CLI_TEST_FIXTURES_ROOT = resolve(__dirname, 'fixtures');

/** Fully decoupled catalog snapshot used by CLI tests */
export const CLI_FIXTURES_CATALOG = resolve(CLI_TEST_FIXTURES_ROOT, 'catalog');

/** Catalog root consumed by CLI tests */
export const CATALOG_ROOT = CLI_FIXTURES_CATALOG;

/** Blueprints directory within the catalog */
export const CATALOG_BLUEPRINTS_ROOT = resolve(CATALOG_ROOT, 'blueprints');

/** Models directory within the catalog */
export const CATALOG_MODELS_ROOT = resolve(CATALOG_ROOT, 'models');

/** Producers directory within the catalog */
export const CATALOG_PRODUCERS_ROOT = resolve(CATALOG_ROOT, 'producers');

/** CLI fixtures subdirectories */
export const CLI_FIXTURES_BLUEPRINTS = resolve(
	CLI_TEST_FIXTURES_ROOT,
	'blueprints'
);
export const CLI_FIXTURES_INPUTS = resolve(CLI_TEST_FIXTURES_ROOT, 'inputs');
export const CLI_FIXTURES_MEDIA = resolve(CLI_TEST_FIXTURES_ROOT, 'media');
export const CLI_FIXTURES_PRODUCERS = resolve(
	CLI_TEST_FIXTURES_ROOT,
	'producers'
);
export const CLI_FIXTURES_SCHEMAS = resolve(CLI_TEST_FIXTURES_ROOT, 'schemas');
