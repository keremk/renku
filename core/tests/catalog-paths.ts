/**
 * Test utility for resolving catalog paths.
 * Tests should use this instead of importing from CLI to avoid cross-package dependencies
 * and keep test runs decoupled from the production catalog.
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repository root directory */
export const REPO_ROOT = resolve(__dirname, '..', '..');

/** Test fixtures directory */
export const TEST_FIXTURES_ROOT = resolve(__dirname, 'fixtures');

/** Fully decoupled catalog snapshot used by core tests */
export const CATALOG_ROOT = resolve(TEST_FIXTURES_ROOT, 'catalog');

/** Blueprints directory within the catalog */
export const CATALOG_BLUEPRINTS_ROOT = resolve(CATALOG_ROOT, 'blueprints');

/** Models directory within the catalog */
export const CATALOG_MODELS_ROOT = resolve(CATALOG_ROOT, 'models');

/** Producers directory within the catalog */
export const CATALOG_PRODUCERS_ROOT = resolve(CATALOG_ROOT, 'producers');
