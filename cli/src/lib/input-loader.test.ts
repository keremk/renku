import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { loadInputsFromYaml } from './input-loader.js';
import { applyProviderDefaults } from './provider-defaults.js';
import { loadBlueprintBundle } from './blueprint-loader/index.js';
import { getBundledBlueprintsRoot, resolveBlueprintSpecifier } from './config-assets.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '../../..');
const CLI_ROOT = resolve(REPO_ROOT, 'cli');
const BLUEPRINTS_ROOT = getBundledBlueprintsRoot();

describe('input-loader', () => {
  it('loads saved canonical inputs with schema-backed config keys', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-inputs-'));
    const blueprintPath = await resolveBlueprintSpecifier('video-audio-music.yaml', { cliRoot: CLI_ROOT });
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);
    const initial = await loadInputsFromYaml(
      resolve(BLUEPRINTS_ROOT, 'cut-scene-video', 'input-template.yaml'),
      blueprint,
    );
    applyProviderDefaults(initial.values, initial.providerOptions);

    const savedPath = join(workdir, 'inputs.yaml');
    await writeFile(savedPath, stringifyYaml({ inputs: initial.values }), 'utf8');

    const reloaded = await loadInputsFromYaml(savedPath, blueprint);
    expect(reloaded.values['Input:MusicProducer.force_instrumental']).toBe(true);
  });

  it('rejects unknown inputs with a clear error', async () => {
    const blueprintPath = await resolveBlueprintSpecifier('audio-only.yaml', { cliRoot: CLI_ROOT });
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);
    const invalidPath = join(await mkdtemp(join(tmpdir(), 'renku-inputs-')), 'inputs.yaml');
    await writeFile(
      invalidPath,
      stringifyYaml({
        inputs: { UnknownKey: 'x' },
        models: [
          { producerId: 'AudioProducer', provider: 'replicate', model: 'elevenlabs/v3' },
        ],
      }),
      'utf8',
    );
    await expect(loadInputsFromYaml(invalidPath, blueprint)).rejects.toThrow(/Unknown input "UnknownKey"/);
  });

  it('derives model selection and config from producer-scoped canonical keys', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-inputs-'));
    const blueprintPath = await resolveBlueprintSpecifier('video-audio-music.yaml', { cliRoot: CLI_ROOT });
    const { root: blueprint } = await loadBlueprintBundle(blueprintPath);
    const savedPath = join(workdir, 'inputs.yaml');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Duration: 30,
          NumOfSegments: 3,
          InquiryPrompt: 'Test story',
          Audience: 'Adult',
          Style: 'Ghibli',
          AspectRatio: '16:9',
          Resolution: '480p',
          SegmentDuration: 10,
          VoiceId: 'Wise_Woman',
          'Input:AudioProducer.provider': 'replicate',
          'Input:AudioProducer.model': 'elevenlabs/v3',
          'Input:VideoProducer.provider': 'replicate',
          'Input:VideoProducer.model': 'bytedance/seedance-1-pro-fast',
          'Input:MusicProducer.provider': 'replicate',
          'Input:MusicProducer.model': 'stability-ai/stable-audio-2.5',
          'Input:MusicProducer.force_instrumental': true,
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    expect(loaded.modelSelections.find((sel) => sel.producerId.endsWith('MusicProducer'))?.model).toBe(
      'stability-ai/stable-audio-2.5',
    );
    expect(loaded.values['Input:MusicProducer.force_instrumental']).toBe(true);
  });
});
