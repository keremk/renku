import { describe, it, expect } from 'vitest';
import { extractProducers, ProducerExtractionError } from './producer-extractor.js';
import type { BlueprintTreeNode, BlueprintDocument } from '@gorenku/core';

interface MockProducerImport {
  name: string;
  producer?: string;
  path?: string;
  description?: string;
}

function createMockDocument(producerImports: MockProducerImport[]): BlueprintDocument {
  return {
    meta: { id: 'test', name: 'Test' },
    inputs: [],
    artefacts: [],
    producers: [],
    producerImports: producerImports.map((p) => ({
      name: p.name,
      producer: p.producer,
      path: p.path,
      description: p.description,
    })),
    edges: [],
  };
}

function createMockNode(
  id: string,
  producerImports: MockProducerImport[],
  children: Map<string, BlueprintTreeNode> = new Map(),
): BlueprintTreeNode {
  return {
    id,
    namespacePath: [],
    document: createMockDocument(producerImports),
    children,
    sourcePath: '/test.yaml',
  };
}

describe('extractProducers', () => {
  it('extracts prompt producers', () => {
    const node = createMockNode('test', [
      { name: 'DocProducer', producer: 'prompt/documentary-talkinghead' },
    ]);
    
    const producers = extractProducers(node);
    
    expect(producers).toHaveLength(1);
    expect(producers[0]).toEqual({
      alias: 'DocProducer',
      localName: 'DocProducer',
      description: undefined,
      category: 'prompt',
      producerRef: 'prompt/documentary-talkinghead',
    });
  });

  it('extracts asset producers', () => {
    const node = createMockNode('test', [
      { name: 'ImageProducer', producer: 'asset/text-to-image' },
    ]);
    
    const producers = extractProducers(node);
    
    expect(producers).toHaveLength(1);
    expect(producers[0]?.category).toBe('asset');
    expect(producers[0]?.producerRef).toBe('asset/text-to-image');
  });

  it('skips composition producers', () => {
    const node = createMockNode('test', [
      { name: 'TimelineComposer', producer: 'composition/timeline-composer' },
    ]);
    
    const producers = extractProducers(node);
    
    expect(producers).toHaveLength(0);
  });

  it('handles multiple producers', () => {
    const node = createMockNode('test', [
      { name: 'DocProducer', producer: 'prompt/documentary-talkinghead' },
      { name: 'ImageProducer', producer: 'asset/text-to-image' },
      { name: 'AudioProducer', producer: 'asset/text-to-speech' },
      { name: 'TimelineComposer', producer: 'composition/timeline-composer' },
    ]);
    
    const producers = extractProducers(node);
    
    // Should have 3 (skips composition)
    expect(producers).toHaveLength(3);
    expect(producers.find(p => p.localName === 'DocProducer')?.category).toBe('prompt');
    expect(producers.find(p => p.localName === 'ImageProducer')?.category).toBe('asset');
    expect(producers.find(p => p.localName === 'AudioProducer')?.category).toBe('asset');
  });

  it('skips producers without producer field', () => {
    const node = createMockNode('test', [{ name: 'NoProducerField' }]);

    const producers = extractProducers(node);

    expect(producers).toHaveLength(0);
  });

  it('includes description when provided', () => {
    const node = createMockNode('test', [
      {
        name: 'DocProducer',
        producer: 'prompt/documentary-talkinghead',
        description: 'Generates documentary narration',
      },
    ]);

    const producers = extractProducers(node);

    expect(producers).toHaveLength(1);
    expect(producers[0]?.description).toBe('Generates documentary narration');
  });

  it('throws error for legacy path syntax', () => {
    const node = createMockNode('test', [
      { name: 'OldProducer', path: '../../producers/old/old.yaml' },
    ]);

    expect(() => extractProducers(node)).toThrow(ProducerExtractionError);
    expect(() => extractProducers(node)).toThrow(
      'Producer "OldProducer" uses legacy "path:" syntax which is no longer supported',
    );
  });

  it('throws error for invalid producer prefix', () => {
    const node = createMockNode('test', [
      { name: 'BadProducer', producer: 'invalid/some-producer' },
    ]);

    expect(() => extractProducers(node)).toThrow(ProducerExtractionError);
    expect(() => extractProducers(node)).toThrow(
      'Producer "BadProducer" has invalid producer reference "invalid/some-producer"',
    );
  });

  it('extracts producers from nested children', () => {
    const childNode = createMockNode('child', [
      { name: 'ChildProducer', producer: 'asset/text-to-image' },
    ]);

    const rootNode = createMockNode(
      'root',
      [{ name: 'RootProducer', producer: 'prompt/documentary-talkinghead' }],
      new Map([['ChildBlueprint', childNode]]),
    );

    const producers = extractProducers(rootNode);

    expect(producers).toHaveLength(2);
    // Root producer: alias = producerName (since aliasPath is empty)
    expect(producers.find((p) => p.localName === 'RootProducer')?.alias).toBe('RootProducer');
    // Child producer: alias = aliasPath.join('.') (aliasPath = ['ChildBlueprint'])
    expect(producers.find((p) => p.localName === 'ChildProducer')?.alias).toBe('ChildBlueprint');
  });

  it('handles deeply nested children', () => {
    const grandchildNode = createMockNode('grandchild', [
      { name: 'GrandchildProducer', producer: 'asset/text-to-speech' },
    ]);

    const childNode = createMockNode(
      'child',
      [{ name: 'ChildProducer', producer: 'asset/text-to-image' }],
      new Map([['GrandchildBlueprint', grandchildNode]]),
    );

    const rootNode = createMockNode(
      'root',
      [{ name: 'RootProducer', producer: 'prompt/documentary-talkinghead' }],
      new Map([['ChildBlueprint', childNode]]),
    );

    const producers = extractProducers(rootNode);

    expect(producers).toHaveLength(3);
    // Grandchild producer: alias = aliasPath.join('.') (aliasPath = ['ChildBlueprint', 'GrandchildBlueprint'])
    expect(producers.find((p) => p.localName === 'GrandchildProducer')?.alias).toBe(
      'ChildBlueprint.GrandchildBlueprint',
    );
  });

  it('propagates error from nested child with legacy path', () => {
    const childNode = createMockNode('child', [
      { name: 'OldChildProducer', path: '../../old/producer.yaml' },
    ]);

    const rootNode = createMockNode(
      'root',
      [{ name: 'RootProducer', producer: 'prompt/documentary-talkinghead' }],
      new Map([['ChildBlueprint', childNode]]),
    );

    expect(() => extractProducers(rootNode)).toThrow(ProducerExtractionError);
    expect(() => extractProducers(rootNode)).toThrow('OldChildProducer');
  });

  it('propagates error from nested child with invalid prefix', () => {
    const childNode = createMockNode('child', [
      { name: 'BadChildProducer', producer: 'unknown/producer' },
    ]);

    const rootNode = createMockNode(
      'root',
      [{ name: 'RootProducer', producer: 'prompt/documentary-talkinghead' }],
      new Map([['ChildBlueprint', childNode]]),
    );

    expect(() => extractProducers(rootNode)).toThrow(ProducerExtractionError);
    expect(() => extractProducers(rootNode)).toThrow('BadChildProducer');
  });
});
