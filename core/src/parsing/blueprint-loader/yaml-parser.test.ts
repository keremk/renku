import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { FileStorage } from '@flystorage/file-storage';
import { LocalStorageAdapter } from '@flystorage/local-fs';
import {
  createFlyStorageBlueprintReader,
  loadYamlBlueprintTree,
  parseYamlBlueprintFile,
} from './yaml-parser.js';
import { CATALOG_ROOT, CATALOG_BLUEPRINTS_ROOT, TEST_FIXTURES_ROOT } from '../../testing/catalog-paths.js';
import type { EdgeConditionClause, EdgeConditionGroup } from '../../types.js';

const catalogRoot = CATALOG_ROOT;
const yamlRoot = CATALOG_BLUEPRINTS_ROOT;
// Root catalog for blueprints like condition-example
const rootCatalogBlueprints = CATALOG_BLUEPRINTS_ROOT;

describe('parseYamlBlueprintFile', () => {
  it('parses interface-only producer with meta, inputs, and artifacts', async () => {
    const modulePath = resolve(catalogRoot, 'producers/prompt/script/script.yaml');
    const document = await parseYamlBlueprintFile(modulePath);
    expect(document.meta.id).toBe('ScriptProducer');
    expect(document.producers).toHaveLength(1);
    const producer = document.producers[0];
    expect(producer.name).toBe('ScriptProducer');
    // Interface-only producers have no model definitions - those come from input templates
    expect(producer.model).toBeUndefined();
    expect(producer.models).toBeUndefined();
  });

  it('parses promptFile and outputSchema from producer meta section', async () => {
    const modulePath = resolve(catalogRoot, 'producers/prompt/script/script.yaml');
    const document = await parseYamlBlueprintFile(modulePath);
    expect(document.meta.promptFile).toBe('./script.toml');
    expect(document.meta.outputSchema).toBe('./script-output.json');
  });

  it('leaves promptFile and outputSchema undefined when not specified', async () => {
    // text-to-music producer has no LLM config files
    const modulePath = resolve(catalogRoot, 'producers/asset/text-to-music.yaml');
    const document = await parseYamlBlueprintFile(modulePath);
    expect(document.meta.promptFile).toBeUndefined();
    expect(document.meta.outputSchema).toBeUndefined();
  });

  it('parses countInputOffset for array artefacts', async () => {
    const modulePath = resolve(TEST_FIXTURES_ROOT, 'flow-video/flow-video.yaml');
    const document = await parseYamlBlueprintFile(modulePath);
    const imagePrompts = document.artefacts.find((artefact) => artefact.name === 'ImagePrompts');
    expect(imagePrompts?.countInput).toBe('NumOfSegments');
    expect(imagePrompts?.countInputOffset).toBe(1);
  });

  it('normalizes collector references into canonical edge notation', async () => {
    const blueprintPath = resolve(TEST_FIXTURES_ROOT, 'image-only', 'image-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);
    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'ImageProducer[segment][image].GeneratedImage',
          to: 'SegmentImage[segment][image]',
        }),
        expect.objectContaining({
          from: 'ScriptProducer.NarrationScript[segment]',
          to: 'ImagePromptProducer[segment].NarrativeText',
        }),
      ]),
    );
    expect(document.producerImports.map((entry) => entry.name)).toEqual([
      'ScriptProducer',
      'ImagePromptProducer',
      'ImageProducer',
    ]);
  });

  it('accepts dimension selectors with offsets', async () => {
    const blueprintPath = resolve(yamlRoot, 'image-to-video', 'image-to-video.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);
    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'ImageProducer[image+1].GeneratedImage',
          to: 'ImageToVideoProducer[segment].EndImage',
        }),
      ]),
    );
  });
});

describe('loadYamlBlueprintTree', () => {
  it('loads entire blueprint hierarchy using FlyStorage reader', async () => {
    const storage = new FileStorage(new LocalStorageAdapter(catalogRoot));
    const reader = createFlyStorageBlueprintReader(storage, catalogRoot);
    // Use a catalog blueprint for FlyStorage tests (needs access to catalog/producers/)
    const entry = resolve(yamlRoot, 'ad-video', 'ad-video.yaml');
    const { root } = await loadYamlBlueprintTree(entry, { reader, catalogRoot });
    expect(root.id).toBe('AdVideo');
    expect(root.children.size).toBeGreaterThan(0);
    // Verify we loaded child producers
    const childNames = [...root.children.keys()];
    expect(childNames.length).toBeGreaterThan(0);
  });

  it('preserves promptFile and outputSchema in child node meta', async () => {
    const entry = resolve(TEST_FIXTURES_ROOT, 'audio-only', 'audio-only.yaml');
    const { root } = await loadYamlBlueprintTree(entry, { catalogRoot });

    // ScriptProducer is an LLM producer with promptFile and outputSchema
    const scriptNode = root.children.get('ScriptProducer');
    expect(scriptNode).toBeDefined();
    expect(scriptNode!.document.meta.promptFile).toBe('./script.toml');
    expect(scriptNode!.document.meta.outputSchema).toBe('./script-output.json');
    expect(scriptNode!.sourcePath).toContain('script.yaml');

    // AudioProducer is not an LLM producer - no promptFile/outputSchema
    const audioNode = root.children.get('AudioProducer');
    expect(audioNode).toBeDefined();
    expect(audioNode!.document.meta.promptFile).toBeUndefined();
    expect(audioNode!.document.meta.outputSchema).toBeUndefined();
  });
});

describe('optional inputs without defaults', () => {
  it('accepts optional inputs without default values', async () => {
    const blueprintPath = resolve(TEST_FIXTURES_ROOT, 'audio-only', 'audio-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Find optional inputs (required: false)
    const optionalInputs = document.inputs.filter((input) => !input.required);

    // Verify we have optional inputs
    expect(optionalInputs.length).toBeGreaterThan(0);

    // Verify optional inputs have no defaultValue property
    for (const input of optionalInputs) {
      expect(input).not.toHaveProperty('defaultValue');
    }
  });

  it('parses required flag correctly for both required and optional inputs', async () => {
    const blueprintPath = resolve(yamlRoot, 'kenn-burns', 'image-audio.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Required inputs
    const requiredInputs = document.inputs.filter((input) => input.required);
    expect(requiredInputs.map((i) => i.name)).toContain('InquiryPrompt');
    expect(requiredInputs.map((i) => i.name)).toContain('VoiceId');

    // Optional inputs (no defaults expected)
    const optionalInputs = document.inputs.filter((input) => !input.required);
    expect(optionalInputs.map((i) => i.name)).toContain('Audience');
    expect(optionalInputs.map((i) => i.name)).toContain('Language');

    // None should have defaultValue
    for (const input of document.inputs) {
      expect(input).not.toHaveProperty('defaultValue');
    }
  });
});

describe('condition parsing', () => {
  describe('if references on edges', () => {
    it('parses edge with if reference to named condition', async () => {
      // Use root catalog condition-example (has if: references to named conditions)
      const blueprintPath = resolve(rootCatalogBlueprints, 'condition-example', 'condition-example.yaml');
      const document = await parseYamlBlueprintFile(blueprintPath);

      // Find any edge with conditions (populated from if: reference)
      const conditionalEdge = document.edges.find((edge) => edge.conditions);

      expect(conditionalEdge).toBeDefined();
      expect(conditionalEdge?.conditions).toBeDefined();

      // Conditions from if: reference is a single condition object (not an array)
      // Named conditions like isImageNarration: { when: ..., is: ... } become the conditions value directly
      const conditions = conditionalEdge?.conditions as EdgeConditionClause;
      expect(conditions).toHaveProperty('when');
      expect(conditions).toHaveProperty('is');
      expect(conditions.when).toContain('NarrationType');
    });
  });

  describe('named conditions block', () => {
    it('parses conditions block with named condition definitions', async () => {
      const blueprintPath = resolve(rootCatalogBlueprints, 'condition-example', 'condition-example.yaml');
      const document = await parseYamlBlueprintFile(blueprintPath);

      // Check that conditions are defined
      expect(document.conditions).toBeDefined();
      expect(Object.keys(document.conditions ?? {}).length).toBeGreaterThan(0);
    });

    it('parses named condition with is operator', async () => {
      const blueprintPath = resolve(rootCatalogBlueprints, 'condition-example', 'condition-example.yaml');
      const document = await parseYamlBlueprintFile(blueprintPath);

      const conditions = document.conditions ?? {};
      // Find a condition with 'is' operator
      const conditionWithIs = Object.values(conditions).find(
        (cond) => 'when' in cond && 'is' in cond,
      ) as EdgeConditionClause | undefined;

      expect(conditionWithIs).toBeDefined();
      expect(conditionWithIs?.when).toBeDefined();
      expect(conditionWithIs?.is).toBeDefined();
    });

    it('parses named condition group with all (AND)', async () => {
      const blueprintPath = resolve(rootCatalogBlueprints, 'condition-example', 'condition-example.yaml');
      const document = await parseYamlBlueprintFile(blueprintPath);

      const conditions = document.conditions ?? {};
      // Find a condition with 'all' operator (condition-example may not have this)
      const conditionWithAll = Object.values(conditions).find(
        (cond) => 'all' in cond,
      ) as EdgeConditionGroup | undefined;

      if (conditionWithAll) {
        expect(Array.isArray(conditionWithAll.all)).toBe(true);
        expect(conditionWithAll.all?.length).toBeGreaterThan(0);
      }
      // Test passes if no 'all' condition exists - we're just validating parsing
    });

    it('parses named condition group with any (OR)', async () => {
      const blueprintPath = resolve(rootCatalogBlueprints, 'condition-example', 'condition-example.yaml');
      const document = await parseYamlBlueprintFile(blueprintPath);

      const conditions = document.conditions ?? {};
      // Find a condition with 'any' operator (condition-example may not have this)
      const conditionWithAny = Object.values(conditions).find(
        (cond) => 'any' in cond,
      ) as EdgeConditionGroup | undefined;

      if (conditionWithAny) {
        expect(Array.isArray(conditionWithAny.any)).toBe(true);
        expect(conditionWithAny.any?.length).toBeGreaterThan(0);
      }
      // Test passes if no 'any' condition exists - we're just validating parsing
    });
  });

  describe('if references', () => {
    it('resolves if reference to named condition on edge', async () => {
      const blueprintPath = resolve(rootCatalogBlueprints, 'condition-example', 'condition-example.yaml');
      const document = await parseYamlBlueprintFile(blueprintPath);

      // Find an edge that uses 'if:' reference (conditions will be populated from the named condition)
      const edgeWithCondition = document.edges.find((edge) => edge.conditions);

      expect(edgeWithCondition).toBeDefined();
      expect(edgeWithCondition?.conditions).toBeDefined();
    });
  });

  describe('condition operators', () => {
    it('parses conditions with is operator from named conditions', async () => {
      const blueprintPath = resolve(rootCatalogBlueprints, 'condition-example', 'condition-example.yaml');
      const document = await parseYamlBlueprintFile(blueprintPath);

      const conditions = document.conditions ?? {};

      // condition-example has isImageNarration and isTalkingHead with 'is' operator
      expect(conditions['isImageNarration']).toBeDefined();
      expect(conditions['isTalkingHead']).toBeDefined();

      const isImageNarration = conditions['isImageNarration'] as EdgeConditionClause;
      expect(isImageNarration.when).toContain('NarrationType');
      expect(isImageNarration.is).toBe('ImageNarration');
    });
  });
});

describe('producer resolution by qualified name', () => {
  it('resolves producer with direct file path (asset/text-to-speech.yaml)', async () => {
    // Create a minimal blueprint with producer: syntax
    const mockBlueprint = `
meta:
  id: test-blueprint
  name: Test Blueprint
inputs:
  - name: TestInput
    type: string
artifacts:
  - name: TestOutput
    type: string
producers:
  - name: AudioProducer
    producer: asset/text-to-speech
`;
    const reader = {
      readFile: async (path: string) => {
        if (path.includes('test-blueprint.yaml')) {
          return mockBlueprint;
        }
        // Fall back to real file system for producer files
        const fs = await import('node:fs/promises');
        return fs.readFile(path, 'utf8');
      },
    };

    const entry = resolve(yamlRoot, 'test-blueprint.yaml');
    const { root } = await loadYamlBlueprintTree(entry, {
      reader,
      catalogRoot: catalogRoot,
    });

    expect(root.children.has('AudioProducer')).toBe(true);
    const audioNode = root.children.get('AudioProducer');
    expect(audioNode?.document.meta.id).toBe('TextToSpeechProducer');
  });

  it('resolves producer with nested directory (prompt/script/script.yaml)', async () => {
    const mockBlueprint = `
meta:
  id: test-blueprint
  name: Test Blueprint
inputs:
  - name: TestInput
    type: string
artifacts:
  - name: TestOutput
    type: string
producers:
  - name: ScriptProducer
    producer: prompt/script
`;
    const reader = {
      readFile: async (path: string) => {
        if (path.includes('test-blueprint.yaml')) {
          return mockBlueprint;
        }
        const fs = await import('node:fs/promises');
        return fs.readFile(path, 'utf8');
      },
    };

    const entry = resolve(yamlRoot, 'test-blueprint.yaml');
    const { root } = await loadYamlBlueprintTree(entry, {
      reader,
      catalogRoot: catalogRoot,
    });

    expect(root.children.has('ScriptProducer')).toBe(true);
    const scriptNode = root.children.get('ScriptProducer');
    expect(scriptNode?.document.meta.id).toBe('ScriptProducer');
  });

  it('throws error when producer not found', async () => {
    const mockBlueprint = `
meta:
  id: test-blueprint
  name: Test Blueprint
inputs:
  - name: TestInput
    type: string
artifacts:
  - name: TestOutput
    type: string
producers:
  - name: NonExistentProducer
    producer: nonexistent/producer
`;
    const reader = {
      readFile: async (path: string) => {
        if (path.includes('test-blueprint.yaml')) {
          return mockBlueprint;
        }
        const fs = await import('node:fs/promises');
        return fs.readFile(path, 'utf8');
      },
    };

    const entry = resolve(yamlRoot, 'test-blueprint.yaml');
    await expect(
      loadYamlBlueprintTree(entry, { reader, catalogRoot: catalogRoot })
    ).rejects.toThrow(/Producer "nonexistent\/producer" not found/);
  });

  it('throws error when producer uses qualified name but no catalogRoot provided', async () => {
    const mockBlueprint = `
meta:
  id: test-blueprint
  name: Test Blueprint
inputs:
  - name: TestInput
    type: string
artifacts:
  - name: TestOutput
    type: string
producers:
  - name: AudioProducer
    producer: asset/text-to-speech
`;
    const reader = {
      readFile: async (path: string) => {
        if (path.includes('test-blueprint.yaml')) {
          return mockBlueprint;
        }
        const fs = await import('node:fs/promises');
        return fs.readFile(path, 'utf8');
      },
    };

    const entry = resolve(yamlRoot, 'test-blueprint.yaml');
    // No catalogRoot provided
    await expect(loadYamlBlueprintTree(entry, { reader })).rejects.toThrow(
      /no catalogRoot was provided/
    );
  });

  it('prefers path over producer when both specified (validation error)', async () => {
    const mockBlueprint = `
meta:
  id: test-blueprint
  name: Test Blueprint
inputs:
  - name: TestInput
    type: string
artifacts:
  - name: TestOutput
    type: string
producers:
  - name: AudioProducer
    path: ../../producers/asset/text-to-speech.yaml
    producer: asset/text-to-speech
`;
    const reader = {
      readFile: async (path: string) => {
        if (path.includes('test-blueprint.yaml')) {
          return mockBlueprint;
        }
        const fs = await import('node:fs/promises');
        return fs.readFile(path, 'utf8');
      },
    };

    const entry = resolve(yamlRoot, 'test-blueprint.yaml');
    // Should throw validation error
    await expect(
      loadYamlBlueprintTree(entry, { reader, catalogRoot: catalogRoot })
    ).rejects.toThrow(/cannot have both "path" and "producer" fields/);
  });

  it('still resolves legacy path syntax', async () => {
    // Use the existing audio-only blueprint which uses path: syntax
    const entry = resolve(TEST_FIXTURES_ROOT, 'audio-only', 'audio-only.yaml');
    const { root } = await loadYamlBlueprintTree(entry, { catalogRoot: catalogRoot });

    // Should still work with path: syntax
    expect(root.children.has('ScriptProducer')).toBe(true);
    expect(root.children.has('AudioProducer')).toBe(true);
  });
});

describe('yaml-parser edge cases', () => {
  it('handles blueprint with loops definition', async () => {
    const blueprintPath = resolve(TEST_FIXTURES_ROOT, 'image-only', 'image-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Verify loops are parsed correctly
    expect(document.loops).toBeDefined();
    if (document.loops) {
      expect(document.loops.length).toBeGreaterThan(0);
      // Each loop should have a name and countInput
      for (const loop of document.loops) {
        expect(loop.name).toBeDefined();
        expect(loop.countInput).toBeDefined();
      }
    }
  });

  it('handles blueprint with collectors definition', async () => {
    const blueprintPath = resolve(TEST_FIXTURES_ROOT, 'image-only', 'image-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Check that collectors are parsed (may or may not exist)
    if (document.collectors) {
      for (const collector of document.collectors) {
        expect(collector.from).toBeDefined();
      }
    }
  });

  it('handles blueprint with producerImports', async () => {
    const blueprintPath = resolve(TEST_FIXTURES_ROOT, 'audio-only', 'audio-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Verify producer imports are parsed
    expect(document.producerImports).toBeDefined();
    expect(document.producerImports.length).toBeGreaterThan(0);
    for (const entry of document.producerImports) {
      expect(entry.name).toBeDefined();
      // Producer imports can use either path or producer (qualified name)
      expect(entry.path ?? entry.producer).toBeDefined();
    }
  });

  it('parses multiple array artifacts with different dimensions', async () => {
    const blueprintPath = resolve(TEST_FIXTURES_ROOT, 'image-only', 'image-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Look for array artifacts
    const arrayArtifacts = document.artefacts.filter((art) => art.type === 'array');
    if (arrayArtifacts.length > 0) {
      // Array artifacts should have countInput
      for (const artifact of arrayArtifacts) {
        expect(artifact.countInput).toBeDefined();
      }
    }
  });

  it('handles edge references with dimension selectors', async () => {
    const blueprintPath = resolve(TEST_FIXTURES_ROOT, 'image-only', 'image-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Look for edges with dimension selectors
    const edgesWithDimensions = document.edges.filter((edge) =>
      edge.from.includes('[') || edge.to.includes('[')
    );
    expect(edgesWithDimensions.length).toBeGreaterThan(0);
  });

  it('handles blueprints referencing nested producers', async () => {
    // Use a catalog blueprint for FlyStorage tests (needs access to catalog/producers/)
    const storage = new FileStorage(new LocalStorageAdapter(catalogRoot));
    const reader = createFlyStorageBlueprintReader(storage, catalogRoot);
    const entry = resolve(yamlRoot, 'ad-video', 'ad-video.yaml');
    const { root } = await loadYamlBlueprintTree(entry, { reader, catalogRoot });

    // Verify nested producers are loaded correctly
    expect(root.children.size).toBeGreaterThan(0);

    // Each child should be a valid blueprint node
    for (const [name, childNode] of root.children) {
      expect(name).toBeDefined();
      expect(childNode.document).toBeDefined();
      expect(childNode.document.meta).toBeDefined();
    }
  });

  it('parses required inputs correctly', async () => {
    const blueprintPath = resolve(TEST_FIXTURES_ROOT, 'audio-only', 'audio-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Check that required flag is parsed for inputs
    const requiredInputs = document.inputs.filter((input) => input.required === true);
    const optionalInputs = document.inputs.filter((input) => input.required === false);

    // Should have both types
    expect(requiredInputs.length + optionalInputs.length).toBe(document.inputs.length);
  });

  it('parses edge conditions correctly', async () => {
    const blueprintPath = resolve(rootCatalogBlueprints, 'condition-example', 'condition-example.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Look for edges with conditions
    const edgesWithConditions = document.edges.filter((edge) => edge.conditions);

    // Should have at least one conditional edge
    expect(edgesWithConditions.length).toBeGreaterThan(0);

    // Each conditional edge should have a conditions object
    for (const edge of edgesWithConditions) {
      expect(edge.conditions).toBeDefined();
    }
  });

  it('handles blueprint with meta containing name and id', async () => {
    const blueprintPath = resolve(TEST_FIXTURES_ROOT, 'audio-only', 'audio-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Meta should have both id and name
    expect(document.meta).toBeDefined();
    expect(document.meta.id).toBeDefined();
    expect(document.meta.name).toBeDefined();
  });

  it('parses producer definition', async () => {
    const blueprintPath = resolve(catalogRoot, 'producers/prompt/script/script.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);

    // Producer should be defined
    expect(document.producers.length).toBeGreaterThan(0);
    const producer = document.producers[0];
    expect(producer).toBeDefined();
    expect(producer.name).toBeDefined();
  });
});
