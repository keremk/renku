import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadBlueprintBundle } from '../blueprint-loader/index.js';
import { loadInputsFromYaml } from '../input-loader.js';
import { applyProviderDefaults } from '../provider-defaults.js';
import { getBundledBlueprintsRoot, resolveBlueprintSpecifier } from '../config-assets.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '../../../..');
const CLI_ROOT = resolve(REPO_ROOT, 'cli');
const BLUEPRINTS_ROOT = getBundledBlueprintsRoot();
const FIXTURE_PATH = resolve(CLI_ROOT, 'src/lib/__fixtures__/video-audio-music-canonical-inputs.json');

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
  it('captures all canonical input ids for video-audio-music blueprint', async () => {
    const blueprintPath = await resolveBlueprintSpecifier(
      'video-audio-music.yaml',
      { cliRoot: CLI_ROOT },
    );
    const inputsPath = resolve(BLUEPRINTS_ROOT, 'cut-scene-video', 'input-template.yaml');
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);
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
