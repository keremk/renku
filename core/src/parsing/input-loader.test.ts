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
    sourcePath: '/test/blueprint.yaml',
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

// Helper blueprint for testing SDK mapping parsing
function createMinimalBlueprintTree(): BlueprintTreeNode {
  return {
    id: 'MinimalBlueprint',
    namespacePath: [],
    document: {
      meta: { id: 'MinimalBlueprint', name: 'Minimal Blueprint' },
      inputs: [],
      artefacts: [],
      producers: [{ name: 'AudioProducer' }, { name: 'ImageProducer' }, { name: 'ScriptProducer' }, { name: 'ChatProducer' }, { name: 'ImageToVideoProducer' }],
      producerImports: [],
      edges: [],
    },
    children: new Map(),
    sourcePath: '/test/minimal-blueprint.yaml',
  };
}

describe('model selection SDK mapping parsing', () => {
  it('parses simple string SDK mappings', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-sdk-mapping-'));
    const savedPath = join(workdir, 'inputs.yaml');
    const blueprint = createMinimalBlueprintTree();

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {},
        models: [
          {
            producerId: 'AudioProducer',
            provider: 'replicate',
            model: 'minimax/speech-2.6-hd',
            inputs: {
              TextInput: 'text',
              Emotion: 'emotion',
              VoiceId: 'voice_id',
            },
          },
        ],
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    const selection = loaded.modelSelections.find((s) => s.producerId === 'AudioProducer');

    expect(selection).toBeDefined();
    expect(selection?.inputs).toEqual({
      TextInput: { field: 'text' },
      Emotion: { field: 'emotion' },
      VoiceId: { field: 'voice_id' },
    });
  });

  it('parses complex SDK mappings with field and transform', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-sdk-transform-'));
    const savedPath = join(workdir, 'inputs.yaml');
    const blueprint = createMinimalBlueprintTree();

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {},
        models: [
          {
            producerId: 'ImageProducer',
            provider: 'fal-ai',
            model: 'bytedance/seedream',
            inputs: {
              Prompt: { field: 'prompt' },
              AspectRatio: {
                field: 'image_size',
                transform: {
                  '16:9': 'landscape_16_9',
                  '9:16': 'portrait_16_9',
                  '1:1': 'square',
                },
              },
            },
          },
        ],
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    const selection = loaded.modelSelections.find((s) => s.producerId === 'ImageProducer');

    expect(selection).toBeDefined();
    expect(selection?.inputs?.AspectRatio).toEqual({
      field: 'image_size',
      transform: {
        '16:9': 'landscape_16_9',
        '9:16': 'portrait_16_9',
        '1:1': 'square',
      },
    });
  });

  it('parses SDK mappings with expand flag for object spreading', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-sdk-expand-'));
    const savedPath = join(workdir, 'inputs.yaml');
    const blueprint = createMinimalBlueprintTree();

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {},
        models: [
          {
            producerId: 'ImageToVideoProducer',
            provider: 'fal-ai',
            model: 'kling/image-to-video',
            inputs: {
              ImageConfig: {
                field: 'config',
                expand: true,
              },
            },
          },
        ],
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    const selection = loaded.modelSelections.find((s) => s.producerId === 'ImageToVideoProducer');

    expect(selection).toBeDefined();
    expect(selection?.inputs?.ImageConfig).toEqual({
      field: 'config',
      expand: true,
    });
  });

  it('parses LLM config with text_format config', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-llm-config-'));
    const savedPath = join(workdir, 'inputs.yaml');
    const blueprint = createMinimalBlueprintTree();

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {},
        models: [
          {
            producerId: 'ScriptProducer',
            provider: 'openai',
            model: 'gpt-5-mini',
            config: {
              text_format: 'json_schema',
            },
          },
        ],
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    const selection = loaded.modelSelections.find((s) => s.producerId === 'ScriptProducer');

    expect(selection).toBeDefined();
    // Note: promptFile and outputSchema are now defined in producer YAML meta section, not input templates
    expect(selection?.config).toEqual({ text_format: 'json_schema' });
  });

  it('parses inline LLM config with systemPrompt and userPrompt', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-inline-llm-'));
    const savedPath = join(workdir, 'inputs.yaml');
    const blueprint = createMinimalBlueprintTree();

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {},
        models: [
          {
            producerId: 'ChatProducer',
            provider: 'openai',
            model: 'gpt-4o',
            systemPrompt: 'You are a helpful assistant.',
            userPrompt: 'Answer the following: {{question}}',
            textFormat: 'text',
            variables: ['question'],
          },
        ],
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    const selection = loaded.modelSelections.find((s) => s.producerId === 'ChatProducer');

    expect(selection).toBeDefined();
    expect(selection?.systemPrompt).toBe('You are a helpful assistant.');
    expect(selection?.userPrompt).toBe('Answer the following: {{question}}');
    expect(selection?.textFormat).toBe('text');
    expect(selection?.variables).toEqual(['question']);
  });

  it('loads full input template with SDK mappings from catalog', async () => {
    const blueprintPath = resolve(BLUEPRINT_ROOT, 'audio-only', 'audio-only.yaml');
    const { root: blueprint } = await loadYamlBlueprintTree(blueprintPath);
    const inputPath = resolve(BLUEPRINT_ROOT, 'audio-only', 'input-template.yaml');

    const loaded = await loadInputsFromYaml(inputPath, blueprint);

    // AudioProducer selection should have SDK mappings
    const audioSelection = loaded.modelSelections.find((s) => s.producerId.endsWith('AudioProducer'));
    expect(audioSelection).toBeDefined();
    expect(audioSelection?.inputs).toBeDefined();
    expect(audioSelection?.inputs?.TextInput).toEqual({ field: 'text' });
    expect(audioSelection?.inputs?.Emotion).toEqual({ field: 'emotion' });
    expect(audioSelection?.inputs?.VoiceId).toEqual({ field: 'voice_id' });
  });

  it('loads input template with SDK mappings from catalog', async () => {
    const blueprintPath = resolve(BLUEPRINT_ROOT, 'image-only', 'image-only.yaml');
    const { root: blueprint } = await loadYamlBlueprintTree(blueprintPath);
    const inputPath = resolve(BLUEPRINT_ROOT, 'image-only', 'input-template.yaml');

    const loaded = await loadInputsFromYaml(inputPath, blueprint);

    // ImageProducer selection should have SDK mappings
    const imageSelection = loaded.modelSelections.find((s) => s.producerId.endsWith('ImageProducer'));
    expect(imageSelection).toBeDefined();
    expect(imageSelection?.inputs?.Prompt).toEqual({ field: 'prompt' });
    expect(imageSelection?.inputs?.AspectRatio).toEqual({ field: 'aspect_ratio' });

    // ImagePromptProducer should have LLM config
    // Note: promptFile and outputSchema are now defined in producer YAML meta section
    const imagePromptSelection = loaded.modelSelections.find((s) => s.producerId.endsWith('ImagePromptProducer'));
    expect(imagePromptSelection).toBeDefined();
    expect(imagePromptSelection?.config).toEqual({ text_format: 'json_schema' });
  });

  it('loads input template with LLM config from catalog', async () => {
    const blueprintPath = resolve(BLUEPRINT_ROOT, 'audio-only', 'audio-only.yaml');
    const { root: blueprint } = await loadYamlBlueprintTree(blueprintPath);
    const inputPath = resolve(BLUEPRINT_ROOT, 'audio-only', 'input-template.yaml');

    const loaded = await loadInputsFromYaml(inputPath, blueprint);

    // ScriptProducer selection should have LLM config
    // Note: promptFile and outputSchema are now defined in producer YAML meta section, not input template
    const scriptSelection = loaded.modelSelections.find((s) => s.producerId.endsWith('ScriptProducer'));
    expect(scriptSelection).toBeDefined();
    expect(scriptSelection?.provider).toBe('openai');
    expect(scriptSelection?.model).toBe('gpt-5-mini');
    expect(scriptSelection?.config).toEqual({ text_format: 'json_schema' });

    // AudioProducer should have SDK mappings
    const audioSelection = loaded.modelSelections.find((s) => s.producerId.endsWith('AudioProducer'));
    expect(audioSelection).toBeDefined();
    expect(audioSelection?.provider).toBe('replicate');
    expect(audioSelection?.model).toBe('minimax/speech-2.6-hd');
  });
});

describe('input-loader edge cases', () => {
  it('handles empty inputs section', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-empty-inputs-'));
    const blueprint = createMinimalBlueprintTree();
    const savedPath = join(workdir, 'inputs.yaml');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {},
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    expect(Object.keys(loaded.values).length).toBe(0);
  });

  it('handles inputs with various data types', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-types-'));
    const blueprint: BlueprintTreeNode = {
      id: 'TypedBlueprint',
      namespacePath: [],
      document: {
        meta: { id: 'TypedBlueprint', name: 'Typed Blueprint' },
        inputs: [
          { name: 'StringInput', type: 'string', required: true },
          { name: 'IntInput', type: 'int', required: true },
          { name: 'BoolInput', type: 'boolean', required: true },
          { name: 'FloatInput', type: 'float', required: true },
        ],
        artefacts: [],
        producers: [],
        producerImports: [],
        edges: [],
      },
      children: new Map(),
      sourcePath: '/test/typed-blueprint.yaml',
    };
    const savedPath = join(workdir, 'inputs.yaml');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          StringInput: 'test string',
          IntInput: 42,
          BoolInput: true,
          FloatInput: 3.14,
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    expect(loaded.values['Input:StringInput']).toBe('test string');
    expect(loaded.values['Input:IntInput']).toBe(42);
    expect(loaded.values['Input:BoolInput']).toBe(true);
    expect(loaded.values['Input:FloatInput']).toBe(3.14);
  });

  it('handles nested blueprint with producer-scoped inputs', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-nested-'));
    const blueprintPath = resolve(BLUEPRINT_ROOT, 'audio-only', 'audio-only.yaml');
    const { root: blueprint } = await loadYamlBlueprintTree(blueprintPath);
    const savedPath = join(workdir, 'inputs.yaml');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Duration: 60,
          NumOfSegments: 5,
          InquiryPrompt: 'Tell me about space',
          VoiceId: 'Old_Man',
          // Producer-scoped input
          'ScriptProducer.provider': 'anthropic',
          'ScriptProducer.model': 'claude-sonnet',
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);

    // Verify regular inputs are canonicalized
    expect(loaded.values['Input:Duration']).toBe(60);
    expect(loaded.values['Input:NumOfSegments']).toBe(5);

    // Verify producer-scoped inputs are handled
    const scriptSelection = loaded.modelSelections.find((s) => s.producerId.endsWith('ScriptProducer'));
    expect(scriptSelection?.provider).toBe('anthropic');
    expect(scriptSelection?.model).toBe('claude-sonnet');
  });

  it('handles array values in inputs', async () => {
    const workdir = await mkdtemp(join(tmpdir(), 'renku-array-input-'));
    const blueprint: BlueprintTreeNode = {
      id: 'ArrayBlueprint',
      namespacePath: [],
      document: {
        meta: { id: 'ArrayBlueprint', name: 'Array Blueprint' },
        inputs: [
          { name: 'Tags', type: 'array', required: true },
        ],
        artefacts: [],
        producers: [],
        producerImports: [],
        edges: [],
      },
      children: new Map(),
      sourcePath: '/test/array-blueprint.yaml',
    };
    const savedPath = join(workdir, 'inputs.yaml');

    await writeFile(
      savedPath,
      stringifyYaml({
        inputs: {
          Tags: ['tag1', 'tag2', 'tag3'],
        },
      }),
      'utf8',
    );

    const loaded = await loadInputsFromYaml(savedPath, blueprint);
    expect(loaded.values['Input:Tags']).toEqual(['tag1', 'tag2', 'tag3']);
  });
});
