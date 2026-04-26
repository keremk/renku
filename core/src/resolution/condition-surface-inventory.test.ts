import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  expandBlueprintResolutionContext,
  loadBlueprintResolutionContext,
  normalizeBlueprintResolutionInputs,
  prepareBlueprintResolutionContext,
} from './blueprint-resolution-context.js';
import { createProducerGraph } from './producer-graph.js';
import {
  collectBlueprintConditionSurfaceInventory,
  type BlueprintConditionSurfaceInventory,
} from './condition-surface-inventory.js';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/yaml-parser.js';
import { CATALOG_ROOT } from '../../tests/catalog-paths.js';
import type {
  BlueprintDocument,
  BlueprintEdgeDefinition,
  BlueprintInputDefinition,
  BlueprintLoopDefinition,
  BlueprintOutputDefinition,
  BlueprintProducerOutputDefinition,
  BlueprintProducerSdkMappingField,
  BlueprintTreeNode,
  ProducerCatalog,
  ProducerConfig,
} from '../types.js';

describe('collectBlueprintConditionSurfaceInventory', () => {
  it('measures the root Seedance wrapper condition surface', async () => {
    const inventory = await collectCatalogBlueprintInventory(
      join(
        CATALOG_ROOT,
        'producers',
        'video',
        'seedance-video-generator',
        'seedance-video-generator.yaml'
      ),
      {}
    );

    expect(inventory.totals).toMatchObject({
      importConditions: 8,
      authoredConnectionConditions: 4,
      propagatedEdgeConditions: 72,
      inputConditions: 3,
      fanInMembersWithConditions: 3,
      routeSelectedOutputBindings: 24,
      routeSelectedOutputBindingsWithConditions: 4,
    });
    expect(inventory.categories).toMatchObject({
      'activation-like': 84,
      'optional-input': 0,
      'fan-in': 6,
      'output-route': 4,
      other: 0,
    });
  });

  it('measures the historical documentary Seedance blueprint condition surface', async () => {
    const inventory = await collectCatalogBlueprintInventory(
      join(
        CATALOG_ROOT,
        'blueprints',
        'historical-documentary-assets-seedance',
        'historical-documentary-assets-seedance.yaml'
      ),
      {
        'Input:Duration': 20,
        'Input:NumOfSegments': 2,
        'Input:NumOfImagesPerSegment': 2,
        'Input:NumOfExperts': 1,
        'Input:NumOfHistoricalCharacters': 1,
      }
    );

    expect(inventory.totals).toMatchObject({
      importConditions: 15,
      authoredConnectionConditions: 14,
      propagatedEdgeConditions: 240,
      inputConditions: 8,
      fanInMembersWithConditions: 8,
      routeSelectedOutputBindings: 180,
      routeSelectedOutputBindingsWithConditions: 30,
    });
    expect(inventory.categories).toMatchObject({
      'activation-like': 265,
      'optional-input': 0,
      'fan-in': 20,
      'output-route': 30,
      other: 0,
    });
  });

  it('separates optional input, fan-in, and output-route conditions in a routing fixture', async () => {
    const root = createConditionalRoutingFixture();
    const providerOptions = createDefaultOptions([
      'GateProducer',
      'PreviewProducer',
      'TimelineProducer',
    ]);
    const context = await prepareBlueprintResolutionContext({
      root,
      schemaSource: {
        kind: 'provider-options',
        providerOptions,
      },
    });
    const canonicalInputs = normalizeBlueprintResolutionInputs(context, {
      'Input:Prompt': 'show preview',
      'Input:Duration': 8,
      'Input:OptionalNote': 'use lower thirds',
    }, {
      requireCanonicalIds: true,
    });
    const canonical = expandBlueprintResolutionContext(
      context,
      canonicalInputs
    ).canonical;
    const producerGraph = createProducerGraph(
      canonical,
      createDefaultCatalog([
        'GateProducer',
        'PreviewProducer',
        'TimelineProducer',
      ]),
      providerOptions
    );

    const inventory = collectBlueprintConditionSurfaceInventory({
      root: context.root,
      canonical,
      producerGraph,
    });

    expect(inventory.totals.authoredConnectionConditions).toBe(3);
    expect(inventory.totals.inputConditions).toBe(2);
    expect(inventory.totals.fanInMembersWithConditions).toBe(1);
    expect(inventory.totals.routeSelectedOutputBindingsWithConditions).toBe(1);

    expect(inventory.inputConditions.map((item) => item.category)).toEqual(
      expect.arrayContaining(['optional-input', 'fan-in'])
    );
    expect(
      inventory.propagatedEdgeConditions.some((item) =>
        item.provenance.includes('authored-edge')
      )
    ).toBe(true);
    expect(inventory.fanInMemberConditions).toHaveLength(1);
    expect(inventory.routeSelectedOutputBindings).toHaveLength(1);
    expect(inventory.categories['output-route']).toBe(1);
  });
});

async function collectCatalogBlueprintInventory(
  blueprintPath: string,
  inputValues: Record<string, unknown>
): Promise<BlueprintConditionSurfaceInventory> {
  const { root } = await loadYamlBlueprintTree(blueprintPath, {
    catalogRoot: CATALOG_ROOT,
  });
  const context = await loadBlueprintResolutionContext({
    blueprintPath,
    catalogRoot: CATALOG_ROOT,
    schemaSource: { kind: 'producer-metadata' },
  });
  const canonicalInputs = normalizeBlueprintResolutionInputs(
    context,
    inputValues,
    { requireCanonicalIds: true }
  );
  const canonical = expandBlueprintResolutionContext(
    context,
    canonicalInputs
  ).canonical;
  const producerOptions = createInventoryProducerOptions(canonical);
  const producerGraph = createProducerGraph(
    canonical,
    createInventoryProducerCatalog(canonical),
    producerOptions
  );

  return collectBlueprintConditionSurfaceInventory({
    root,
    canonical,
    producerGraph,
  });
}

function createInventoryProducerOptions(
  canonical: ReturnType<typeof expandBlueprintResolutionContext>['canonical']
): Map<string, {
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  inputSchema?: string;
  outputSchema?: string;
  config?: Record<string, unknown>;
  selectionInputKeys?: string[];
  configInputPaths?: string[];
}> {
  return new Map(
    canonical.nodes
      .filter((node) => node.type === 'Producer')
      .map((node) => [
        node.producerAlias,
        {
          sdkMapping: node.producer?.sdkMapping,
          outputs: node.producer?.outputs,
          selectionInputKeys: [],
          configInputPaths: [],
        },
      ])
  );
}

function createInventoryProducerCatalog(
  canonical: ReturnType<typeof expandBlueprintResolutionContext>['canonical']
): ProducerCatalog {
  return Object.fromEntries(
    canonical.nodes
      .filter((node) => node.type === 'Producer')
      .map((node) => [
        node.producerAlias,
        {
          provider: 'openai',
          providerModel: 'inventory-only',
          rateKey: `inventory:${node.producerAlias}`,
        },
      ])
  );
}

function createConditionalRoutingFixture(): BlueprintTreeNode {
  const gateDoc = makeBlueprintDocument(
    'GateProducer',
    [{ name: 'Prompt', type: 'string', required: true }],
    [{ name: 'ShouldPublish', type: 'json' }],
    [{ name: 'GateProducer' }],
    [],
    undefined,
    { kind: 'producer' }
  );

  const previewDoc = makeBlueprintDocument(
    'PreviewProducer',
    [
      { name: 'Duration', type: 'int', required: true },
      { name: 'OptionalNote', type: 'string', required: false },
    ],
    [{ name: 'GeneratedVideo', type: 'video' }],
    [{ name: 'PreviewProducer' }],
    [],
    undefined,
    { kind: 'producer' }
  );

  const timelineDoc = makeBlueprintDocument(
    'TimelineProducer',
    [{ name: 'Clips', type: 'array', required: false, fanIn: true }],
    [{ name: 'Movie', type: 'video' }],
    [{ name: 'TimelineProducer' }],
    [],
    undefined,
    { kind: 'producer' }
  );

  const publishPreview = {
    when: 'Artifact:GateProducer.ShouldPublish',
    is: true,
  };
  const rootDoc = makeBlueprintDocument(
    'ConditionalRoutingInventoryFixture',
    [
      { name: 'Prompt', type: 'string', required: true },
      { name: 'Duration', type: 'int', required: true },
      { name: 'OptionalNote', type: 'string', required: false },
    ],
    [
      { name: 'Movie', type: 'video' },
      { name: 'PreviewVideo', type: 'video' },
    ],
    [],
    [
      { from: 'Prompt', to: 'GateProducer.Prompt' },
      {
        from: 'Duration',
        to: 'PreviewProducer.Duration',
      },
      {
        from: 'OptionalNote',
        to: 'PreviewProducer.OptionalNote',
        conditions: publishPreview,
      },
      {
        from: 'PreviewProducer.GeneratedVideo',
        to: 'TimelineProducer.Clips',
        conditions: publishPreview,
      },
      { from: 'TimelineProducer.Movie', to: 'Movie' },
      {
        from: 'PreviewProducer.GeneratedVideo',
        to: 'PreviewVideo',
        conditions: publishPreview,
      },
    ],
    undefined,
    {
      imports: [
        { name: 'GateProducer', producer: 'test/gate-producer' },
        { name: 'PreviewProducer', producer: 'test/preview-producer' },
        { name: 'TimelineProducer', producer: 'test/timeline-producer' },
      ],
    }
  );

  return makeTreeNode(
    rootDoc,
    [],
    new Map([
      ['GateProducer', makeTreeNode(gateDoc, ['GateProducer'])],
      ['PreviewProducer', makeTreeNode(previewDoc, ['PreviewProducer'])],
      ['TimelineProducer', makeTreeNode(timelineDoc, ['TimelineProducer'])],
    ])
  );
}

function makeBlueprintDocument(
  id: string,
  inputs: BlueprintInputDefinition[],
  outputs: BlueprintOutputDefinition[],
  producers: ProducerConfig[],
  edges: BlueprintEdgeDefinition[],
  loops?: BlueprintLoopDefinition[],
  options?: {
    kind?: BlueprintDocument['meta']['kind'];
    imports?: BlueprintDocument['imports'];
  }
): BlueprintDocument {
  return {
    meta: { id, name: id, ...(options?.kind ? { kind: options.kind } : {}) },
    inputs,
    outputs,
    producers,
    imports: options?.imports ?? [],
    edges,
    loops,
  };
}

function makeTreeNode(
  document: BlueprintDocument,
  namespacePath: string[],
  children: Map<string, BlueprintTreeNode> = new Map()
): BlueprintTreeNode {
  return {
    id: document.meta.id,
    namespacePath,
    document,
    children,
    sourcePath: '/test/mock-blueprint.yaml',
  };
}

function createDefaultCatalog(producers: string[]): ProducerCatalog {
  return Object.fromEntries(
    producers.map((producer) => [
      producer,
      {
        provider: 'openai',
        providerModel: 'gpt-4o',
        rateKey: `openai:${producer}`,
      },
    ])
  );
}

function createDefaultOptions(producers: string[]): Map<string, {
  sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
  outputs?: Record<string, BlueprintProducerOutputDefinition>;
  inputSchema?: string;
  outputSchema?: string;
  config?: Record<string, unknown>;
  selectionInputKeys?: string[];
  configInputPaths?: string[];
}> {
  return new Map(
    producers.map((producer) => [
      producer,
      {
        selectionInputKeys: [],
        configInputPaths: [],
      },
    ])
  );
}
