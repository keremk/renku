import { describe, expect, it } from 'vitest';
import { buildBlueprintGraph } from './canonical-graph.js';
import { expandBlueprintGraph } from './canonical-expander.js';
import { buildInputSourceMapFromCanonical, normalizeInputValues } from './input-sources.js';
import type { BlueprintDocument, BlueprintTreeNode } from '../types.js';

function makeChildBlueprint(): BlueprintDocument {
  return {
    meta: { id: 'Child', name: 'Child' },
    inputs: [
      { name: 'ImagesPer', type: 'int', required: false },
    ],
    artefacts: [
      { name: 'Prompt', type: 'array', countInput: 'ImagesPer' },
    ],
    producers: [],
    producerImports: [],
    edges: [],
  };
}

function makeRootBlueprint(extraEdges: Array<{ from: string; to: string }>): BlueprintTreeNode {
  const childDoc = makeChildBlueprint();
  const rootDoc: BlueprintDocument = {
    meta: { id: 'Root', name: 'Root' },
    inputs: [
      { name: 'ImagesPer', type: 'int', required: true },
      { name: 'FallbackImagesPer', type: 'int', required: false },
    ],
    artefacts: [],
    producers: [],
    producerImports: [],
    edges: [
      ...extraEdges,
    ],
  };

  return {
    id: 'Root',
    namespacePath: [],
    document: rootDoc,
    children: new Map<string, BlueprintTreeNode>([
      ['Child', {
        id: 'Child',
        namespacePath: ['Child'],
        document: childDoc,
        children: new Map(),
        sourcePath: '/test/mock-blueprint.yaml',
      }],
    ]),
    sourcePath: '/test/mock-blueprint.yaml',
  };
}

describe('input source mapping', () => {
  it('normalizes downstream input defaults to their upstream source', () => {
    const tree = makeRootBlueprint([
      { from: 'ImagesPer', to: 'Child.ImagesPer' },
    ]);
    const graph = buildBlueprintGraph(tree);
    const sources = buildInputSourceMapFromCanonical(graph);
    const normalized = normalizeInputValues({
      'Input:ImagesPer': 3,
      'Input:Child.ImagesPer': 1,
    }, sources);

    expect(normalized['Input:ImagesPer']).toBe(3);
    expect(normalized).not.toHaveProperty('Input:Child.ImagesPer');

    const canonical = expandBlueprintGraph(graph, normalized, sources);
    const promptNodes = canonical.nodes.filter((node) => node.id.startsWith('Artifact:Child.Prompt['));
    expect(promptNodes).toHaveLength(3);
  });

  it('throws when an input has multiple upstream inputs', () => {
    const tree = makeRootBlueprint([
      { from: 'ImagesPer', to: 'Child.ImagesPer' },
      { from: 'FallbackImagesPer', to: 'Child.ImagesPer' },
    ]);
    const graph = buildBlueprintGraph(tree);

    expect(() => buildInputSourceMapFromCanonical(graph)).toThrow(/multiple upstream inputs/i);
  });
});
