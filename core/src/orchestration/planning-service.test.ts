import { describe, expect, it, beforeEach } from 'vitest';
import type {
  BlueprintArtefactDefinition,
  BlueprintDocument,
  BlueprintInputDefinition,
  BlueprintTreeNode,
  ProducerCatalog,
  ProducerConfig,
} from '../types.js';
import {
  applyOutputSchemasToBlueprintTree,
  createPlanningService,
  injectDerivedInputs,
  type ProviderOptionEntry,
  type PendingArtefactDraft,
} from './planning-service.js';
import { createStorageContext, initializeMovieStorage } from '../storage.js';
import { createManifestService } from '../manifest.js';
import { createEventLog } from '../event-log.js';

describe('applyOutputSchemasToBlueprintTree', () => {
  it('applies outputSchema from providerOptions to JSON artifacts with arrays', () => {
    const tree = makeTreeNode(
      makeBlueprintDocument(
        'TestBlueprint',
        [{ name: 'NumOfSegments', type: 'int', required: true }],
        [
          {
            name: 'VideoScript',
            type: 'json',
            arrays: [{ path: 'Segments', countInput: 'NumOfSegments' }],
            // schema is initially undefined
          },
        ],
        [{ name: 'ScriptProducer' }],
        [],
      ),
      [],
    );

    const providerOptions = new Map<string, ProviderOptionEntry>([
      [
        'ScriptProducer',
        {
          outputSchema: JSON.stringify({
            name: 'VideoScript',
            schema: { type: 'object', properties: { Segments: { type: 'array' } } },
          }),
        },
      ],
    ]);

    applyOutputSchemasToBlueprintTree(tree, providerOptions);

    const artifact = tree.document.artefacts[0];
    expect(artifact.schema).toBeDefined();
    expect(artifact.schema?.name).toBe('VideoScript');
    expect(artifact.schema?.schema).toEqual({
      type: 'object',
      properties: { Segments: { type: 'array' } },
    });
  });

  it('does not overwrite existing schema on artifact', () => {
    const existingSchema = {
      name: 'Existing',
      schema: { type: 'object' as const },
    };
    const tree = makeTreeNode(
      makeBlueprintDocument(
        'TestBlueprint',
        [],
        [
          {
            name: 'VideoScript',
            type: 'json',
            arrays: [{ path: 'Segments', countInput: 'NumOfSegments' }],
            schema: existingSchema,
          },
        ],
        [{ name: 'ScriptProducer' }],
        [],
      ),
      [],
    );

    const providerOptions = new Map<string, ProviderOptionEntry>([
      [
        'ScriptProducer',
        {
          outputSchema: JSON.stringify({
            name: 'NewSchema',
            schema: { type: 'object' },
          }),
        },
      ],
    ]);

    applyOutputSchemasToBlueprintTree(tree, providerOptions);

    // Original schema should be preserved
    expect(tree.document.artefacts[0].schema).toBe(existingSchema);
  });

  it('applies schema to nested child blueprints', () => {
    const childDoc = makeBlueprintDocument(
      'ChildBlueprint',
      [{ name: 'Count', type: 'int', required: true }],
      [
        {
          name: 'Items',
          type: 'json',
          arrays: [{ path: 'Data', countInput: 'Count' }],
        },
      ],
      [{ name: 'ChildProducer' }],
      [],
    );

    const rootDoc = makeBlueprintDocument('Root', [], [], [], []);

    const tree = makeTreeNode(
      rootDoc,
      [],
      new Map([['ChildBlueprint', makeTreeNode(childDoc, ['ChildBlueprint'])]]),
    );

    // formatProducerAlias(['ChildBlueprint'], 'ChildProducer') returns 'ChildBlueprint'
    // (the producer name is ignored when namespace path is not empty)
    const providerOptions = new Map<string, ProviderOptionEntry>([
      [
        'ChildBlueprint',
        {
          outputSchema: JSON.stringify({
            name: 'Items',
            schema: { type: 'object', properties: { Data: { type: 'array' } } },
          }),
        },
      ],
    ]);

    applyOutputSchemasToBlueprintTree(tree, providerOptions);

    const childTree = tree.children.get('ChildBlueprint');
    expect(childTree?.document.artefacts[0].schema).toBeDefined();
    expect(childTree?.document.artefacts[0].schema?.name).toBe('Items');
  });

  it('ignores artifacts without arrays', () => {
    const tree = makeTreeNode(
      makeBlueprintDocument(
        'TestBlueprint',
        [],
        [
          {
            name: 'SimpleOutput',
            type: 'json',
            // no arrays property
          },
        ],
        [{ name: 'Producer' }],
        [],
      ),
      [],
    );

    const providerOptions = new Map<string, ProviderOptionEntry>([
      [
        'Producer',
        {
          outputSchema: JSON.stringify({
            name: 'Schema',
            schema: { type: 'object' },
          }),
        },
      ],
    ]);

    applyOutputSchemasToBlueprintTree(tree, providerOptions);

    // Schema should NOT be applied (no arrays)
    expect(tree.document.artefacts[0].schema).toBeUndefined();
  });

  it('ignores non-json artifacts', () => {
    const tree = makeTreeNode(
      makeBlueprintDocument(
        'TestBlueprint',
        [],
        [
          {
            name: 'ImageOutput',
            type: 'image',
          },
        ],
        [{ name: 'ImageProducer' }],
        [],
      ),
      [],
    );

    const providerOptions = new Map<string, ProviderOptionEntry>([
      [
        'ImageProducer',
        {
          outputSchema: JSON.stringify({
            name: 'Schema',
            schema: { type: 'object' },
          }),
        },
      ],
    ]);

    applyOutputSchemasToBlueprintTree(tree, providerOptions);

    // Schema should NOT be applied (not json type)
    expect(tree.document.artefacts[0].schema).toBeUndefined();
  });

  it('handles empty arrays property', () => {
    const tree = makeTreeNode(
      makeBlueprintDocument(
        'TestBlueprint',
        [],
        [
          {
            name: 'JsonOutput',
            type: 'json',
            arrays: [], // empty arrays
          },
        ],
        [{ name: 'Producer' }],
        [],
      ),
      [],
    );

    const providerOptions = new Map<string, ProviderOptionEntry>([
      [
        'Producer',
        {
          outputSchema: JSON.stringify({
            name: 'Schema',
            schema: { type: 'object' },
          }),
        },
      ],
    ]);

    applyOutputSchemasToBlueprintTree(tree, providerOptions);

    // Schema should NOT be applied (empty arrays)
    expect(tree.document.artefacts[0].schema).toBeUndefined();
  });

  it('handles provider options without outputSchema', () => {
    const tree = makeTreeNode(
      makeBlueprintDocument(
        'TestBlueprint',
        [{ name: 'Count', type: 'int', required: true }],
        [
          {
            name: 'JsonOutput',
            type: 'json',
            arrays: [{ path: 'Items', countInput: 'Count' }],
          },
        ],
        [{ name: 'Producer' }],
        [],
      ),
      [],
    );

    const providerOptions = new Map<string, ProviderOptionEntry>([
      [
        'Producer',
        {
          // No outputSchema
          sdkMapping: { Input: { field: 'input' } },
        },
      ],
    ]);

    applyOutputSchemasToBlueprintTree(tree, providerOptions);

    // Schema should not be applied (no outputSchema in options)
    expect(tree.document.artefacts[0].schema).toBeUndefined();
  });

  it('parses outputSchema without name property using default name', () => {
    const tree = makeTreeNode(
      makeBlueprintDocument(
        'TestBlueprint',
        [{ name: 'Count', type: 'int', required: true }],
        [
          {
            name: 'Output',
            type: 'json',
            arrays: [{ path: 'Items', countInput: 'Count' }],
          },
        ],
        [{ name: 'Producer' }],
        [],
      ),
      [],
    );

    // Schema JSON without 'name' property - should use default 'Schema'
    const providerOptions = new Map<string, ProviderOptionEntry>([
      [
        'Producer',
        {
          outputSchema: JSON.stringify({
            type: 'object',
            properties: { Items: { type: 'array' } },
          }),
        },
      ],
    ]);

    applyOutputSchemasToBlueprintTree(tree, providerOptions);

    expect(tree.document.artefacts[0].schema?.name).toBe('Schema');
    // When no 'schema' property, the whole object becomes the schema
    expect(tree.document.artefacts[0].schema?.schema).toEqual({
      type: 'object',
      properties: { Items: { type: 'array' } },
    });
  });

  it('adds edges for both top-level scalar properties and array items', () => {
    // This test ensures we don't regress on the fix for top-level scalar properties.
    // Previously, only array items (with dimensions) got edges, causing top-level
    // scalars like CharacterImagePrompt to not be connected to their producer.
    const tree = makeTreeNode(
      makeBlueprintDocument(
        'AdVideoBlueprint',
        [{ name: 'NumOfClips', type: 'int', required: true }],
        [
          {
            name: 'AdScript',
            type: 'json',
            arrays: [{ path: 'Scenes', countInput: 'NumOfClips' }],
          },
        ],
        [{ name: 'ScriptProducer' }],
        [], // No edges initially
      ),
      [],
    );

    // Schema with both top-level scalars and an array
    const outputSchema = {
      name: 'AdScript',
      schema: {
        type: 'object',
        properties: {
          AdTitle: { type: 'string' },
          CharacterImagePrompt: { type: 'string' },
          ProductImagePrompt: { type: 'string' },
          Scenes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                SceneNumber: { type: 'integer' },
                VideoPrompt: { type: 'string' },
              },
            },
          },
        },
      },
    };

    const providerOptions = new Map<string, ProviderOptionEntry>([
      ['ScriptProducer', { outputSchema: JSON.stringify(outputSchema) }],
    ]);

    applyOutputSchemasToBlueprintTree(tree, providerOptions);

    // Verify edges were added for top-level scalar properties (dimensions: [])
    const edgePaths = tree.document.edges.map((e) => e.to);
    expect(edgePaths).toContain('AdScript.AdTitle');
    expect(edgePaths).toContain('AdScript.CharacterImagePrompt');
    expect(edgePaths).toContain('AdScript.ProductImagePrompt');

    // Verify edges were also added for array item properties (dimensions: ['clip'])
    expect(edgePaths).toContain('AdScript.Scenes[clip].SceneNumber');
    expect(edgePaths).toContain('AdScript.Scenes[clip].VideoPrompt');

    // Verify all edges come from the producer
    for (const edge of tree.document.edges) {
      expect(edge.from).toBe('ScriptProducer');
    }
  });
});

function makeBlueprintDocument(
  id: string,
  inputs: BlueprintInputDefinition[],
  artefacts: BlueprintArtefactDefinition[],
  producers: ProducerConfig[],
  edges: { from: string; to: string }[],
): BlueprintDocument {
  return {
    meta: { id, name: id },
    inputs,
    artefacts,
    producers,
    producerImports: [],
    edges,
  };
}

function makeTreeNode(
  document: BlueprintDocument,
  namespacePath: string[],
  children: Map<string, BlueprintTreeNode> = new Map(),
): BlueprintTreeNode {
  return {
    id: document.meta.id,
    namespacePath,
    document,
    children,
    sourcePath: '/test/mock-blueprint.yaml',
  };
}

describe('createPlanningService', () => {
  const movieId = 'test-movie';
  let storage: ReturnType<typeof createStorageContext>;

  beforeEach(async () => {
    storage = createStorageContext({ kind: 'memory', basePath: 'test-builds' });
    await initializeMovieStorage(storage, movieId);
  });

  const defaultCatalog: ProducerCatalog = {
    'TestProducer': {
      provider: 'openai',
      providerModel: 'gpt-4',
      rateKey: 'openai-gpt4',
    },
    'ScriptProducer': {
      provider: 'openai',
      providerModel: 'gpt-4o',
      rateKey: 'openai-gpt4o',
    },
  };

  function createDefaultOptions(aliases: string[]): Map<string, ProviderOptionEntry> {
    const options = new Map<string, ProviderOptionEntry>();
    for (const alias of aliases) {
      options.set(alias, {});
    }
    return options;
  }

  function createSimpleBlueprint(): BlueprintTreeNode {
    const doc = makeBlueprintDocument(
      'SimpleBlueprint',
      [
        { name: 'Prompt', type: 'string', required: true },
      ],
      [
        { name: 'Output', type: 'string' },
      ],
      [{ name: 'TestProducer' }],
      [
        { from: 'Prompt', to: 'TestProducer' },
        { from: 'TestProducer', to: 'Output' },
      ],
    );
    return makeTreeNode(doc, []);
  }

  describe('generatePlan', () => {
    it('generates a plan for first run (new manifest)', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      const result = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Hello world' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      expect(result.plan).toBeDefined();
      expect(result.plan.layers.length).toBeGreaterThan(0);
      expect(result.targetRevision).toBe('rev-0001');
      expect(result.manifest.revision).toBe('rev-0000');
      expect(result.manifestHash).toBeNull();
      expect(result.inputEvents).toHaveLength(1);
      expect(result.inputEvents[0]?.id).toBe('Input:Prompt');
      expect(result.inputEvents[0]?.payload).toBe('Hello world');
    });

    it('generates a plan with subsequent revision', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      // First plan
      const firstResult = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'First prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      expect(firstResult.targetRevision).toBe('rev-0001');

      // Second plan
      const secondResult = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Second prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      expect(secondResult.targetRevision).toBe('rev-0002');
    });

    it('appends input events to event log', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      const inputEvents: unknown[] = [];
      for await (const event of eventLog.streamInputs(movieId)) {
        inputEvents.push(event);
      }

      expect(inputEvents).toHaveLength(1);
      expect((inputEvents[0] as { id: string }).id).toBe('Input:Prompt');
    });

    it('handles pending artifact drafts', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      const pendingArtefacts: PendingArtefactDraft[] = [
        {
          artefactId: 'Artifact:Output',
          producedBy: 'Producer:TestProducer',
          output: { blob: { hash: 'abc123', size: 100, mimeType: 'text/plain' } },
        },
      ];

      await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
        pendingArtefacts,
      });

      const artefactEvents: unknown[] = [];
      for await (const event of eventLog.streamArtefacts(movieId)) {
        artefactEvents.push(event);
      }

      expect(artefactEvents).toHaveLength(1);
      expect((artefactEvents[0] as { artefactId: string }).artefactId).toBe('Artifact:Output');
    });

    it('skips undefined input values', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      const result = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: {
          'Input:Prompt': 'Valid prompt',
          'Input:OptionalField': undefined,
        },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      // Only the non-undefined input should be included
      expect(result.inputEvents).toHaveLength(1);
      expect(result.inputEvents[0]?.id).toBe('Input:Prompt');
    });

    it('includes resolved inputs in result', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      const result = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      expect(result.resolvedInputs).toEqual({ 'Input:Prompt': 'Test prompt' });
    });

    it('uses provided input source', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      const result = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
        inputSource: 'system',
      });

      expect(result.inputEvents[0]?.editedBy).toBe('system');
    });

    it('uses custom clock for timestamps', async () => {
      const fixedTime = '2024-01-01T00:00:00.000Z';
      const service = createPlanningService({
        clock: { now: () => fixedTime },
      });
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      const result = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      expect(result.inputEvents[0]?.createdAt).toBe(fixedTime);
    });

    it('saves the plan to storage', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      const result = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      // Verify plan file exists
      const planExists = await storage.storage.fileExists(result.planPath);
      expect(planExists).toBe(true);
    });
  });

  describe('input event creation', () => {
    it('throws for non-canonical input IDs', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      await expect(
        service.generatePlan({
          movieId,
          blueprintTree: createSimpleBlueprint(),
          inputValues: { 'InvalidId': 'test' }, // Missing Input: prefix
          providerCatalog: defaultCatalog,
          providerOptions: createDefaultOptions(['TestProducer']),
          storage,
          manifestService,
          eventLog,
        }),
      ).rejects.toThrow('Input "InvalidId" is not a canonical input id');
    });

    it('hashes input payloads correctly', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      const result = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      expect(result.inputEvents[0]?.hash).toBeDefined();
      expect(typeof result.inputEvents[0]?.hash).toBe('string');
      expect(result.inputEvents[0]?.hash.length).toBeGreaterThan(0);
    });
  });

  describe('artifact events', () => {
    it('creates artifact event with default status succeeded', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
        pendingArtefacts: [
          {
            artefactId: 'Artifact:Output',
            producedBy: 'Producer:TestProducer',
            output: {},
          },
        ],
      });

      const artefactEvents: unknown[] = [];
      for await (const event of eventLog.streamArtefacts(movieId)) {
        artefactEvents.push(event);
      }

      expect((artefactEvents[0] as { status: string }).status).toBe('succeeded');
    });

    it('uses provided status in artifact draft', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
        pendingArtefacts: [
          {
            artefactId: 'Artifact:Output',
            producedBy: 'Producer:TestProducer',
            output: {},
            status: 'skipped',
          },
        ],
      });

      const artefactEvents: unknown[] = [];
      for await (const event of eventLog.streamArtefacts(movieId)) {
        artefactEvents.push(event);
      }

      expect((artefactEvents[0] as { status: string }).status).toBe('skipped');
    });

    it('uses manual-edit as default inputsHash for artifact drafts', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Test prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
        pendingArtefacts: [
          {
            artefactId: 'Artifact:Output',
            producedBy: 'Producer:TestProducer',
            output: {},
          },
        ],
      });

      const artefactEvents: unknown[] = [];
      for await (const event of eventLog.streamArtefacts(movieId)) {
        artefactEvents.push(event);
      }

      expect((artefactEvents[0] as { inputsHash: string }).inputsHash).toBe('manual-edit');
    });
  });

  describe('revision uniqueness', () => {
    it('increments revision when plan file already exists', async () => {
      const service = createPlanningService();
      const manifestService = createManifestService(storage);
      const eventLog = createEventLog(storage);

      // Create first plan
      const firstResult = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'First prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      expect(firstResult.targetRevision).toBe('rev-0001');

      // Manually create a plan file for rev-0002 to simulate conflict
      const rev2Path = storage.resolve(movieId, 'runs', 'rev-0002-plan.json');
      await storage.storage.write(rev2Path, '{}', { mimeType: 'application/json' });

      // Create second plan - should skip to rev-0003
      const secondResult = await service.generatePlan({
        movieId,
        blueprintTree: createSimpleBlueprint(),
        inputValues: { 'Input:Prompt': 'Second prompt' },
        providerCatalog: defaultCatalog,
        providerOptions: createDefaultOptions(['TestProducer']),
        storage,
        manifestService,
        eventLog,
      });

      expect(secondResult.targetRevision).toBe('rev-0003');
    });
  });
});

describe('injectDerivedInputs', () => {
  it('computes SegmentDuration from Duration and NumOfSegments', () => {
    const inputs = {
      'Input:Duration': 40,
      'Input:NumOfSegments': 5,
    };
    const result = injectDerivedInputs(inputs);
    expect(result['Input:SegmentDuration']).toBe(8);
  });

  it('does not overwrite existing SegmentDuration', () => {
    const inputs = {
      'Input:Duration': 40,
      'Input:NumOfSegments': 5,
      'Input:SegmentDuration': 10, // User override
    };
    const result = injectDerivedInputs(inputs);
    expect(result['Input:SegmentDuration']).toBe(10);
  });

  it('handles missing Duration gracefully', () => {
    const inputs = {
      'Input:NumOfSegments': 5,
    };
    const result = injectDerivedInputs(inputs);
    expect(result['Input:SegmentDuration']).toBeUndefined();
  });

  it('handles missing NumOfSegments gracefully', () => {
    const inputs = {
      'Input:Duration': 40,
    };
    const result = injectDerivedInputs(inputs);
    expect(result['Input:SegmentDuration']).toBeUndefined();
  });

  it('handles zero NumOfSegments gracefully', () => {
    const inputs = {
      'Input:Duration': 40,
      'Input:NumOfSegments': 0,
    };
    const result = injectDerivedInputs(inputs);
    expect(result['Input:SegmentDuration']).toBeUndefined();
  });

  it('preserves other inputs', () => {
    const inputs = {
      'Input:Duration': 40,
      'Input:NumOfSegments': 5,
      'Input:SomeOther': 'value',
    };
    const result = injectDerivedInputs(inputs);
    expect(result['Input:SomeOther']).toBe('value');
    expect(result['Input:Duration']).toBe(40);
    expect(result['Input:NumOfSegments']).toBe(5);
  });

  it('handles fractional segment durations', () => {
    const inputs = {
      'Input:Duration': 100,
      'Input:NumOfSegments': 3,
    };
    const result = injectDerivedInputs(inputs);
    expect(result['Input:SegmentDuration']).toBeCloseTo(33.333, 2);
  });
});
