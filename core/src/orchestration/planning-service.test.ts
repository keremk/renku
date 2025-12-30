import { describe, expect, it } from 'vitest';
import type {
  BlueprintArtefactDefinition,
  BlueprintDocument,
  BlueprintInputDefinition,
  BlueprintTreeNode,
  ProducerConfig,
} from '../types.js';
import { applyOutputSchemasToBlueprintTree, type ProviderOptionEntry } from './planning-service.js';

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
  };
}
