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

  it('expands array artifacts using countInput', () => {
    // Test the countInput-based dimension expansion (traditional approach)
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
      ],
      producers: [
        { name: 'Producer', provider: 'openai', model: 'gpt-4' },
      ],
      producerImports: [],
      edges: [
        { from: 'NumOfSegments', to: 'Producer' },
        { from: 'Producer', to: 'Script[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues({
      'Input:NumOfSegments': 3,
    }, inputSources);

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Should have 3 artifacts (one per segment)
    const scriptArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Script')
    );
    expect(scriptArtifacts).toHaveLength(3);
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[0]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[1]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[2]');
  });

  it('handles countInputOffset for array artifacts', () => {
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments', countInputOffset: 1 },
      ],
      producers: [
        { name: 'Producer', provider: 'openai', model: 'gpt-4' },
      ],
      producerImports: [],
      edges: [
        { from: 'NumOfSegments', to: 'Producer' },
        { from: 'Producer', to: 'Script[i]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues({
      'Input:NumOfSegments': 2,
    }, inputSources);

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // With offset of 1, NumOfSegments=2 means 3 artifacts (2+1)
    const scriptArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Script')
    );
    expect(scriptArtifacts).toHaveLength(3);
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[0]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[1]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[2]');
  });

  it('expands nested dimensions using loops', () => {
    // Test nested dimensions (2 segments × 3 images = 6 image artifacts)
    // Uses loops to define dimension sizing for both dimensions
    const doc: BlueprintDocument = {
      meta: { id: 'Test', name: 'Test' },
      inputs: [
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'NumOfImages', type: 'int', required: true },
      ],
      artefacts: [
        { name: 'Script', type: 'array', countInput: 'NumOfSegments' },
        { name: 'Image', type: 'array', countInput: 'NumOfImages' },
      ],
      producers: [
        { name: 'ScriptProducer', provider: 'openai', model: 'gpt-4' },
        { name: 'ImageProducer', provider: 'replicate', model: 'flux' },
      ],
      producerImports: [],
      loops: [
        { name: 'i', countInput: 'NumOfSegments' },
        { name: 'j', countInput: 'NumOfImages' },
      ],
      edges: [
        { from: 'NumOfSegments', to: 'ScriptProducer' },
        { from: 'ScriptProducer', to: 'Script[i]' },
        { from: 'NumOfImages', to: 'ImageProducer' },
        { from: 'Script[i]', to: 'ImageProducer' },
        { from: 'ImageProducer', to: 'Image[i][j]' },
      ],
    };

    const tree: BlueprintTreeNode = {
      id: 'Test',
      namespacePath: [],
      document: doc,
      children: new Map(),
    };

    const graph = buildBlueprintGraph(tree);
    const inputSources = buildInputSourceMapFromCanonical(graph);
    const canonicalInputs = normalizeInputValues({
      'Input:NumOfSegments': 2,
      'Input:NumOfImages': 3,
    }, inputSources);

    const expanded = expandBlueprintGraph(graph, canonicalInputs, inputSources);

    // Should have 2 script artifacts (one per segment)
    const scriptArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Script')
    );
    expect(scriptArtifacts).toHaveLength(2);
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[0]');
    expect(scriptArtifacts.map((a) => a.id)).toContain('Artifact:Script[1]');

    // Should have 6 image artifacts (2 segments × 3 images)
    const imageArtifacts = expanded.nodes.filter(
      (n) => n.type === 'Artifact' && n.id.includes('Image')
    );
    expect(imageArtifacts).toHaveLength(6);
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[0][0]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[0][1]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[0][2]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[1][0]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[1][1]');
    expect(imageArtifacts.map((a) => a.id)).toContain('Artifact:Image[1][2]');
  });

});
