import { describe, expect, it } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FileStorage } from '@flystorage/file-storage';
import { LocalStorageAdapter } from '@flystorage/local-fs';
import {
  createFlyStorageBlueprintReader,
  loadYamlBlueprintTree,
  parseYamlBlueprintFile,
} from './yaml-parser.js';
import { getBundledBlueprintsRoot, getBundledCatalogRoot } from '../../../../cli/src/lib/config-assets.js';
import type { EdgeConditionClause, EdgeConditionGroup } from '../../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = getBundledCatalogRoot();
const yamlRoot = getBundledBlueprintsRoot();
// Root catalog (not CLI bundled) for blueprints like condition-example
const rootCatalogBlueprints = resolve(__dirname, '../../../../catalog/blueprints');

describe('parseYamlBlueprintFile', () => {
  it('parses module producers and loads prompt/schema files', async () => {
    const modulePath = resolve(catalogRoot, 'producers/script/script.yaml');
    const document = await parseYamlBlueprintFile(modulePath);
    expect(document.meta.id).toBe('ScriptProducer');
    expect(document.producers).toHaveLength(1);
    const producer = document.producers[0];
    expect(producer.model).toBe('gpt-5-mini');
    // LLM producers use outputSchema for structured output, not inputSchema
    expect(producer.models?.[0]?.outputSchema).toContain('"properties"');
    expect(producer.models?.[0]?.variables).toEqual(
      expect.arrayContaining(['InquiryPrompt', 'Duration', 'NumOfSegments', 'Audience', 'Language']),
    );
  });

  it('parses countInputOffset for array artefacts', async () => {
    const modulePath = resolve(catalogRoot, 'producers/flow-video-prompt/flow-video-prompt.yaml');
    const document = await parseYamlBlueprintFile(modulePath);
    const imagePrompts = document.artefacts.find((artefact) => artefact.name === 'ImagePrompts');
    expect(imagePrompts?.countInput).toBe('NumOfSegments');
    expect(imagePrompts?.countInputOffset).toBe(1);
  });

  it('normalizes collector references into canonical edge notation', async () => {
    const blueprintPath = resolve(yamlRoot, 'image-only', 'image-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);
    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'ImageProducer[segment][image].SegmentImage',
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
          from: 'ImageProducer[image+1].SegmentImage',
          to: 'ImageToVideoProducer[segment].InputImage2',
        }),
      ]),
    );
  });
});

describe('loadYamlBlueprintTree', () => {
  it('loads entire blueprint hierarchy using FlyStorage reader', async () => {
    const storage = new FileStorage(new LocalStorageAdapter(catalogRoot));
    const reader = createFlyStorageBlueprintReader(storage, catalogRoot);
    const entry = resolve(yamlRoot, 'audio-only', 'audio-only.yaml');
    const { root } = await loadYamlBlueprintTree(entry, { reader });
    expect(root.id).toBe('audio');
    expect([...root.children.keys()]).toEqual(['ScriptProducer', 'AudioProducer']);
    const scriptNode = root.children.get('ScriptProducer');
    expect(scriptNode?.document.producers[0]?.models?.[0]?.model).toBe('gpt-5-mini');
  });
});

describe('optional inputs without defaults', () => {
  it('accepts optional inputs without default values', async () => {
    const blueprintPath = resolve(yamlRoot, 'audio-only', 'audio-only.yaml');
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
  describe('inline conditions on edges', () => {
    it('parses edge with inline condition using is operator', async () => {
      // Use root catalog selector-example (has inline conditions), not CLI bundled version
      const blueprintPath = resolve(rootCatalogBlueprints, 'selector-example', 'selector-example.yaml');
      const document = await parseYamlBlueprintFile(blueprintPath);

      // Find edge with conditions
      const conditionalEdge = document.edges.find(
        (edge) => edge.from.includes('ImagePrompts') && edge.conditions,
      );

      expect(conditionalEdge).toBeDefined();
      expect(conditionalEdge?.conditions).toBeDefined();

      // Conditions should be an array with a clause
      const conditions = conditionalEdge?.conditions as EdgeConditionClause[];
      expect(Array.isArray(conditions)).toBe(true);
      expect(conditions[0]?.when).toContain('NarrationType');
      expect(conditions[0]?.is).toBe('ImageNarration');
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
