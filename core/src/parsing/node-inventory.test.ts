import { describe, expect, it } from 'vitest';
import { collectNodeInventory } from './node-inventory.js';
import type { BlueprintTreeNode } from '../types.js';

function createTree(): BlueprintTreeNode {
  const child: BlueprintTreeNode = {
    id: 'Video',
    namespacePath: ['Video'],
    document: {
      meta: { id: 'Video', name: 'Video Blueprint' },
      inputs: [
        { name: 'Style', type: 'string', required: true },
      ],
      artefacts: [
        { name: 'SegmentVideo', type: 'video', required: true, countInput: 'NumOfSegments' },
      ],
      producers: [
        { name: 'VideoProducer', provider: 'replicate', model: 'bytedance/seedance' },
      ],
      producerImports: [],
      edges: [],
    },
    children: new Map(),
    sourcePath: '/test/mock-blueprint.yaml',
  };

  const root: BlueprintTreeNode = {
    id: 'Root',
    namespacePath: [],
    document: {
      meta: { id: 'Root', name: 'Root Blueprint' },
      inputs: [
        { name: 'InquiryPrompt', type: 'string', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      artefacts: [
        { name: 'NarrationScript', type: 'string', required: true, countInput: 'NumOfSegments' },
      ],
      producers: [
        { name: 'ScriptProducer', provider: 'openai', model: 'gpt-5-mini' },
      ],
      producerImports: [{ name: 'Video' }],
      edges: [],
    },
    children: new Map([['Video', child]]),
    sourcePath: '/test/mock-blueprint.yaml',
  };

  return root;
}

describe('collectNodeInventory', () => {
  it('returns canonical ids for inputs, artefacts, and producers without resolving connections', () => {
    const tree = createTree();
    const inventory = collectNodeInventory(tree);

    expect(inventory.inputs).toEqual(
      expect.arrayContaining([
        'Input:InquiryPrompt',
        'Input:NumOfSegments',
        'Input:Video.Style',
      ]),
    );
    expect(inventory.artefacts).toEqual(
      expect.arrayContaining([
        'Artifact:NarrationScript',
        'Artifact:Video.SegmentVideo',
      ]),
    );
    expect(inventory.producers).toEqual(
      expect.arrayContaining([
        'Producer:ScriptProducer',
        'Producer:Video',
      ]),
    );
  });
});
