import { describe, expect, it } from 'vitest';
import { collectNodeInventory } from './node-inventory.js';
import type { BlueprintTreeNode } from '../types.js';

function createTree(): BlueprintTreeNode {
  const scriptProducer: BlueprintTreeNode = {
    id: 'Script',
    namespacePath: ['Script'],
    document: {
      meta: { id: 'Script', name: 'Script Producer', kind: 'producer' },
      inputs: [
        { name: 'InquiryPrompt', type: 'string', required: true },
      ],
      outputs: [
        { name: 'NarrationScript', type: 'string', required: true, countInput: 'NumOfSegments' },
      ],
      producers: [
        { name: 'Script', provider: 'openai', model: 'gpt-5-mini' },
      ],
      imports: [],
      edges: [],
    },
    children: new Map(),
    sourcePath: '/test/mock-blueprint.yaml',
  };

  const videoProducer: BlueprintTreeNode = {
    id: 'Video',
    namespacePath: ['Video'],
    document: {
      meta: { id: 'Video', name: 'Video Producer', kind: 'producer' },
      inputs: [
        { name: 'Style', type: 'string', required: true },
      ],
      outputs: [
        { name: 'SegmentVideo', type: 'video', required: true, countInput: 'NumOfSegments' },
      ],
      producers: [
        { name: 'Video', provider: 'replicate', model: 'bytedance/seedance' },
      ],
      imports: [],
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
      outputs: [
        { name: 'NarrationScript', type: 'string', required: true, countInput: 'NumOfSegments' },
      ],
      producers: [],
      imports: [{ name: 'Script' }, { name: 'Video' }],
      edges: [],
    },
    children: new Map([
      ['Script', scriptProducer],
      ['Video', videoProducer],
    ]),
    sourcePath: '/test/mock-blueprint.yaml',
  };

  return root;
}

describe('collectNodeInventory', () => {
  it('returns canonical ids for inputs, outputs, and producers without resolving connections', () => {
    const tree = createTree();
    const inventory = collectNodeInventory(tree);

    expect(inventory.inputs).toEqual(
      expect.arrayContaining([
        'Input:InquiryPrompt',
        'Input:NumOfSegments',
        'Input:Video.Style',
      ]),
    );
    expect(inventory.outputs).toEqual(
      expect.arrayContaining([
        'Output:NarrationScript',
        'Output:Video.SegmentVideo',
      ]),
    );
    expect(inventory.producers).toEqual(
      expect.arrayContaining([
        'Producer:Script',
        'Producer:Video',
      ]),
    );
  });
});
