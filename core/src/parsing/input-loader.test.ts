import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { loadInputsFromYaml } from './input-loader.js';
import { loadYamlBlueprintTree } from './blueprint-loader/yaml-parser.js';
import { getBundledBlueprintsRoot } from '../../../cli/src/lib/config-assets.js';

const BLUEPRINT_ROOT = getBundledBlueprintsRoot();

describe('parsing/input-loader', () => {
  it('canonicalizes inputs and derives model selections from producer-scoped keys', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-inputs-'));
    const blueprintPath = resolve(BLUEPRINT_ROOT, 'audio-only', 'audio-only.yaml');
    const { root: blueprint } = await loadYamlBlueprintTree(blueprintPath);
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
          'Input:AudioProducer.model': 'elevenlabs/v3',
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    expect(loaded.modelSelections.find((sel) => sel.producerId.endsWith('AudioProducer'))?.model).toBe(
      'elevenlabs/v3',
    );
    expect(loaded.values['Input:AudioProducer.provider']).toBe('replicate');
  });

  it('rejects unknown inputs with a clear error', async () => {
    const blueprintPath = resolve(BLUEPRINT_ROOT, 'audio-only', 'audio-only.yaml');
    const { root: blueprint } = await loadYamlBlueprintTree(blueprintPath);
    const invalidPath = join(await mkdtemp(join(tmpdir(), 'renku-inputs-')), 'inputs.yaml');
    await writeFile(
      invalidPath,
      stringifyYaml({
        inputs: { UnknownKey: 'x' },
      }),
      'utf8',
    );
    await expect(loadInputsFromYaml(invalidPath, blueprint)).rejects.toThrow(/Unknown input "UnknownKey"/);
  });
});
