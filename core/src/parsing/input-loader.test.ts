import { Buffer } from 'node:buffer';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { loadInputsFromYaml } from './input-loader.js';
import { loadYamlBlueprintTree } from './blueprint-loader/yaml-parser.js';
import { CATALOG_BLUEPRINTS_ROOT } from '../testing/catalog-paths.js';
import type { BlueprintTreeNode } from '../types.js';

const BLUEPRINT_ROOT = CATALOG_BLUEPRINTS_ROOT;

// Helper to create a minimal blueprint tree for testing artifact override detection
function createTestBlueprintTree(): BlueprintTreeNode {
  return {
    id: 'TestBlueprint',
    namespacePath: [],
    document: {
      meta: { id: 'TestBlueprint', name: 'Test Blueprint' },
      inputs: [
        { name: 'Topic', type: 'string', required: true },
        { name: 'NumOfSegments', type: 'int', required: false },
      ],
      artefacts: [
        { name: 'VideoScript', type: 'json' },
      ],
      producers: [
        { name: 'DocProducer' },
      ],
      producerImports: [],
      edges: [],
    },
    children: new Map(),
  };
}

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

describe('artifact override detection', () => {
  it('separates simple artifact overrides from regular inputs', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-artifact-override-'));
    const blueprint = createTestBlueprintTree();
    const savedPath = join(workdir, 'inputs.yaml');
    const overrideFile = join(workdir, 'override.txt');

    // Create override file
    await writeFile(overrideFile, 'Override content', 'utf8');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Topic: 'Test topic',
          'DocProducer.VideoScript[0]': `file:${overrideFile}`,
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);

    // Regular input should be in values
    expect(loaded.values['Input:Topic']).toBe('Test topic');

    // Artifact override should be in artifactOverrides, not values
    expect(loaded.artifactOverrides).toHaveLength(1);
    expect(loaded.artifactOverrides[0].artifactId).toBe('Artifact:DocProducer.VideoScript[0]');
    expect(loaded.artifactOverrides[0].blob.mimeType).toBe('text/plain');
  });

  it('handles decomposed artifact paths with multiple indices', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-decomposed-override-'));
    const blueprint = createTestBlueprintTree();
    const savedPath = join(workdir, 'inputs.yaml');
    const overrideFile = join(workdir, 'image-prompt.txt');

    await writeFile(overrideFile, 'A beautiful sunset', 'utf8');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Topic: 'Test topic',
          'DocProducer.VideoScript.Segments[0].ImagePrompts[0]': `file:${overrideFile}`,
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);

    expect(loaded.artifactOverrides).toHaveLength(1);
    expect(loaded.artifactOverrides[0].artifactId).toBe('Artifact:DocProducer.VideoScript.Segments[0].ImagePrompts[0]');
  });

  it('handles multiple artifact overrides', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-multi-override-'));
    const blueprint = createTestBlueprintTree();
    const savedPath = join(workdir, 'inputs.yaml');
    const override1 = join(workdir, 'override1.txt');
    const override2 = join(workdir, 'override2.txt');

    await writeFile(override1, 'First override', 'utf8');
    await writeFile(override2, 'Second override', 'utf8');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Topic: 'Test topic',
          'DocProducer.VideoScript.Segments[0].Script': `file:${override1}`,
          'DocProducer.VideoScript.Segments[0].ImagePrompts[0]': `file:${override2}`,
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);

    expect(loaded.artifactOverrides).toHaveLength(2);
    const artifactIds = loaded.artifactOverrides.map((o) => o.artifactId);
    expect(artifactIds).toContain('Artifact:DocProducer.VideoScript.Segments[0].Script');
    expect(artifactIds).toContain('Artifact:DocProducer.VideoScript.Segments[0].ImagePrompts[0]');
  });

  it('handles artifact override keys with Artifact: prefix', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-prefixed-override-'));
    const blueprint = createTestBlueprintTree();
    const savedPath = join(workdir, 'inputs.yaml');
    const overrideFile = join(workdir, 'override.txt');

    await writeFile(overrideFile, 'Override content', 'utf8');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Topic: 'Test topic',
          'Artifact:DocProducer.VideoScript[0]': `file:${overrideFile}`,
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);

    expect(loaded.artifactOverrides).toHaveLength(1);
    expect(loaded.artifactOverrides[0].artifactId).toBe('Artifact:DocProducer.VideoScript[0]');
  });

  it('rejects artifact overrides without file: prefix', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-invalid-override-'));
    const blueprint = createTestBlueprintTree();
    const savedPath = join(workdir, 'inputs.yaml');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Topic: 'Test topic',
          'DocProducer.VideoScript[0]': 'plain string value',
        },
      }),
      'utf8',
    );

    await expect(loadInputsFromYaml(savedPath, blueprint)).rejects.toThrow(/must be a file reference/);
  });

  it('does not treat qualified names without indices as artifact overrides', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-qualified-input-'));
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
          'AudioProducer.provider': 'replicate',
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);

    // Should be treated as regular input, not artifact override
    expect(loaded.artifactOverrides).toHaveLength(0);
    expect(loaded.values['Input:AudioProducer.provider']).toBe('replicate');
  });

  it('handles binary files (images) as artifact overrides', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-binary-override-'));
    const blueprint = createTestBlueprintTree();
    const savedPath = join(workdir, 'inputs.yaml');
    const imageFile = join(workdir, 'test.png');

    // Create a minimal PNG file (1x1 transparent pixel)
    const pngData = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND chunk
      0x42, 0x60, 0x82,
    ]);
    await writeFile(imageFile, pngData);

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Topic: 'Test topic',
          'ImageProducer.SegmentImage[0][1]': `file:${imageFile}`,
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);

    expect(loaded.artifactOverrides).toHaveLength(1);
    expect(loaded.artifactOverrides[0].artifactId).toBe('Artifact:ImageProducer.SegmentImage[0][1]');
    expect(loaded.artifactOverrides[0].blob.mimeType).toBe('image/png');
  });
});
