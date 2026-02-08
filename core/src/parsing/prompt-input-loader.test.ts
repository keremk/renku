import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProducerPromptInputs, resolveAllPromptPaths } from './prompt-input-loader.js';
import { loadYamlBlueprintTree } from './blueprint-loader/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CATALOG_ROOT = resolve(REPO_ROOT, 'catalog');
const AUDIO_ONLY_BLUEPRINT = resolve(__dirname, '../../tests/fixtures/audio-only/audio-only.yaml');

describe('resolveAllPromptPaths', () => {
  it('resolves prompt paths for producers with promptFile in meta', async () => {
    const { root } = await loadYamlBlueprintTree(AUDIO_ONLY_BLUEPRINT, { catalogRoot: CATALOG_ROOT });
    const paths = await resolveAllPromptPaths(root);

    // ScriptProducer has a promptFile in its meta
    expect(paths.has('ScriptProducer')).toBe(true);
    const scriptPath = paths.get('ScriptProducer')!;
    expect(scriptPath).toContain('script.toml');

    // AudioProducer is a catalog producer without promptFile
    expect(paths.has('AudioProducer')).toBe(false);
  });
});

describe('loadProducerPromptInputs', () => {
  it('loads TOML prompt values as canonical input IDs', async () => {
    const { root } = await loadYamlBlueprintTree(AUDIO_ONLY_BLUEPRINT, { catalogRoot: CATALOG_ROOT });
    const inputs = await loadProducerPromptInputs(root);

    // ScriptProducer's script.toml has systemPrompt, userPrompt, and variables
    expect(inputs['Input:ScriptProducer.systemPrompt']).toBeDefined();
    expect(typeof inputs['Input:ScriptProducer.systemPrompt']).toBe('string');

    expect(inputs['Input:ScriptProducer.userPrompt']).toBeDefined();
    expect(typeof inputs['Input:ScriptProducer.userPrompt']).toBe('string');

    expect(inputs['Input:ScriptProducer.variables']).toBeDefined();
    expect(Array.isArray(inputs['Input:ScriptProducer.variables'])).toBe(true);

    // AudioProducer should have no prompt inputs
    const audioKeys = Object.keys(inputs).filter((k) => k.includes('AudioProducer'));
    expect(audioKeys).toHaveLength(0);
  });

  it('returns empty record when no producers have promptFile', async () => {
    const { root } = await loadYamlBlueprintTree(AUDIO_ONLY_BLUEPRINT, { catalogRoot: CATALOG_ROOT });

    // Create a minimal node with no children (no promptFile producers)
    const minimalNode = {
      ...root,
      document: {
        ...root.document,
        producers: root.document.producers.map((p) => ({ ...p })),
      },
      children: new Map(),
    };

    const inputs = await loadProducerPromptInputs(minimalNode);
    expect(Object.keys(inputs)).toHaveLength(0);
  });
});
