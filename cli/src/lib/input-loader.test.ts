import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { loadInputsFromYaml } from './input-loader.js';
import { loadBlueprintBundle } from './blueprint-loader/index.js';
import { CATALOG_ROOT, CLI_TEST_FIXTURES_ROOT } from '../../tests/test-catalog-paths.js';

const catalogRoot = CATALOG_ROOT;

describe('input-loader', () => {
  it('loads model selections from input template (SDK mappings come from producer YAML)', async () => {
    const blueprintPath = resolve(CLI_TEST_FIXTURES_ROOT, 'audio-only', 'audio-only.yaml');
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath, { catalogRoot });

    // Use the matching input template for the blueprint
    const loaded = await loadInputsFromYaml(
      resolve(CLI_TEST_FIXTURES_ROOT, 'audio-only', 'input-template.yaml'),
      blueprint,
    );

    // Verify model selection is loaded - SDK mappings now come from producer YAML, not input template
    const audioSelection = loaded.modelSelections.find((sel) => sel.producerId.endsWith('AudioProducer'));
    expect(audioSelection).toBeDefined();
    expect(audioSelection?.provider).toBe('replicate');
    expect(audioSelection?.model).toBe('minimax/speech-2.6-hd');
    // inputs property was removed from ModelSelection - SDK mappings now come from producer YAML
    expect('inputs' in (audioSelection ?? {})).toBe(false);
  });

  it('rejects unknown inputs with a clear error', async () => {
    const blueprintPath = resolve(CLI_TEST_FIXTURES_ROOT, 'audio-only', 'audio-only.yaml');
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath, { catalogRoot });
    const invalidPath = join(await mkdtemp(join(tmpdir(), 'renku-inputs-')), 'inputs.yaml');
    await writeFile(
      invalidPath,
      stringifyYaml({
        inputs: { UnknownKey: 'x' },
        models: [
          { producerId: 'ScriptProducer', provider: 'openai', model: 'gpt-5-mini' },
          { producerId: 'AudioProducer', provider: 'replicate', model: 'elevenlabs/v3' },
        ],
      }),
      'utf8',
    );
    await expect(loadInputsFromYaml(invalidPath, blueprint)).rejects.toThrow(/Unknown input "UnknownKey"/);
  });

  it('derives model selection and config from producer-scoped canonical keys', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-inputs-'));
    const blueprintPath = resolve(CLI_TEST_FIXTURES_ROOT, 'audio-only', 'audio-only.yaml');
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath, { catalogRoot });
    const savedPath = join(workdir, 'inputs.yaml');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Duration: 30,
          NumOfSegments: 3,
          InquiryPrompt: 'Test story',
          VoiceId: 'Wise_Woman',
          'Input:AudioProducer.provider': 'replicate',
          'Input:AudioProducer.model': 'minimax/speech-2.6-hd',
        },
        models: [
          { producerId: 'ScriptProducer', provider: 'openai', model: 'gpt-5-mini' },
        ],
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    expect(loaded.modelSelections.find((sel) => sel.producerId.endsWith('AudioProducer'))?.model).toBe(
      'minimax/speech-2.6-hd',
    );
    expect(loaded.values['Input:AudioProducer.provider']).toBe('replicate');
  });
});
