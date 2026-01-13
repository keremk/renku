import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadBlueprintBundle } from './blueprint-loader/index.js';
import { loadInputsFromYaml } from './input-loader.js';
import { applyProviderDefaults } from './provider-defaults.js';
import { CATALOG_ROOT, CLI_FIXTURES_BLUEPRINTS, CLI_FIXTURES_SCHEMAS } from '../../tests/test-catalog-paths.js';

const catalogRoot = CATALOG_ROOT;
const FIXTURE_PATH = resolve(CLI_FIXTURES_SCHEMAS, 'audio-only-canonical-inputs.json');

async function readFixture(): Promise<string[] | null> {
  try {
    const contents = await readFile(FIXTURE_PATH, 'utf8');
    return JSON.parse(contents) as string[];
  } catch {
    return null;
  }
}

async function writeFixture(values: string[]): Promise<void> {
  await mkdir(dirname(FIXTURE_PATH), { recursive: true });
  await writeFile(FIXTURE_PATH, JSON.stringify(values, null, 2), 'utf8');
}

describe('canonical inputs snapshot', () => {
  it('captures all canonical input ids for audio-only blueprint', async () => {
    // Use audio-only blueprint from CLI fixtures
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'audio-only', 'audio-only.yaml');
    const inputsPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'audio-only', 'input-template.yaml');
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath, { catalogRoot });
    const { values, providerOptions } = await loadInputsFromYaml(inputsPath, blueprint);
    applyProviderDefaults(values, providerOptions);
    const canonicalIds = Object.keys(values)
      .filter((key) => key.startsWith('Input:'))
      .sort();

    const fixture = await readFixture();
    if (!fixture) {
      await writeFixture(canonicalIds);
      expect(canonicalIds).toEqual(canonicalIds);
      return;
    }
    expect(canonicalIds).toEqual(fixture);
  });
});
