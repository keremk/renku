import { describe, expect, it } from 'vitest';
import { buildBlueprintGraph } from './canonical-graph.js';
import { expandBlueprintGraph } from './canonical-expander.js';
import { buildInputSourceMapFromCanonical, normalizeInputValues } from './input-sources.js';
import type { BlueprintTreeNode, BlueprintDocument } from '../types.js';

describe('expandBlueprintGraph', () => {
  it('expands nodes with indices and collapses input aliases', () => {
    const scriptDoc: BlueprintDocument = {
      meta: { id: 'ScriptGenerator', name: 'ScriptGenerator' },
      inputs: [
        { name: 'InquiryPrompt', type: 'string', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      artefacts: [
        { name: 'NarrationScript', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [
        { name: 'ScriptProducer', provider: 'openai', model: 'gpt' },
      ],
      subBlueprints: [],
      edges: [
        { from: 'InquiryPrompt', to: 'ScriptProducer' },
        { from: 'NumOfSegments', to: 'ScriptProducer' },
        { from: 'ScriptProducer', to: 'NarrationScript[i]' },
      ],
    };

    const rootDoc: BlueprintDocument = {
      meta: { id: 'ROOT', name: 'ROOT' },
      inputs: [
        { name: 'InquiryPrompt', type: 'string', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      artefacts: [],
      producers: [],
      subBlueprints: [
        { name: 'ScriptGenerator' },
      ],
      edges: [
        { from: 'InquiryPrompt', to: 'ScriptGenerator.InquiryPrompt' },
        { from: 'NumOfSegments', to: 'ScriptGenerator.NumOfSegments' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'ROOT',
      namespacePath: [],
      document: rootDoc,
      children: new Map([
        ['ScriptGenerator', {
          id: 'ScriptGenerator',
          namespacePath: ['ScriptGenerator'],
          document: scriptDoc,
          children: new Map(),
        }],
      ]),
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues({
      'Input:InquiryPrompt': 'Hello',
      'Input:NumOfSegments': 2,
    }, inputSources);
    const canonical = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    const producerNodes = canonical.nodes.filter((node) => node.type === 'Producer');
    expect(producerNodes).toHaveLength(1);
    expect(producerNodes[0]?.id).toBe('Producer:ScriptGenerator');
    const producerId = producerNodes[0]?.id ?? '';
    expect(canonical.inputBindings[producerId]?.InquiryPrompt).toBe('Input:InquiryPrompt');
    expect(canonical.inputBindings[producerId]?.NumOfSegments).toBe('Input:NumOfSegments');

    const artefactNodes = canonical.nodes.filter((node) => node.type === 'Artifact');
    expect(artefactNodes).toHaveLength(2);
    const edges = canonical.edges.filter((edge) => edge.to.includes('Producer:ScriptGenerator'));
    expect(edges).toHaveLength(2);
    expect(edges.every((edge) => edge.from.startsWith('Input:'))).toBe(true);
  });
});
