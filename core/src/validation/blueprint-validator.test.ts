import { describe, expect, it } from 'vitest';
import type { BlueprintTreeNode, BlueprintDocument } from '../types.js';
import {
  validateBlueprintTree,
  validateConnectionEndpoints,
  validateProducerInputOutput,
  validateMediaProducerDurationContract,
  validateSegmentDurationContract,
  validateInputCountInputs,
  validateLoopCountInputs,
  validateArtifactCountInputs,
  validateConditionPaths,
  validateTypes,
  validateProducerCycles,
  validateDimensionConsistency,
  findUnusedInputs,
  findUnusedArtifacts,
  findUnreachableProducers,
  validatePublishedOutputsAreTerminal,
  validateSemanticRules,
} from './blueprint-validator.js';
import { ValidationErrorCode } from './types.js';

/**
 * Helper to create a minimal valid blueprint document
 */
function createDocument(
  overrides: Partial<BlueprintDocument> = {}
): BlueprintDocument {
  return {
    meta: { id: 'test', name: 'Test Blueprint' },
    inputs: [],
    outputs: [],
    producers: [],
    imports: [],
    edges: [],
    ...overrides,
  };
}

/**
 * Helper to create a blueprint tree node
 */
function createTreeNode(
  document: BlueprintDocument,
  options: {
    sourcePath?: string;
    namespacePath?: string[];
    children?: Map<string, BlueprintTreeNode>;
  } = {}
): BlueprintTreeNode {
  return {
    id: document.meta.id,
    namespacePath: options.namespacePath ?? [],
    document,
    children: options.children ?? new Map(),
    sourcePath: options.sourcePath ?? '/test/blueprint.yaml',
  };
}

describe('validateBlueprintTree', () => {
  it('returns valid result for valid blueprint', () => {
    const doc = createDocument({
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      edges: [{ from: 'Prompt', to: 'Output' }],
    });
    const tree = createTreeNode(doc);

    const result = validateBlueprintTree(tree);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('collects multiple errors without failing early', () => {
    const doc = createDocument({
      inputs: [{ name: 'Prompt', type: 'invalid-type', required: true }],
      outputs: [{ name: 'Output', type: 'invalid-type', required: true }],
      edges: [{ from: 'NonExistent', to: 'AlsoNonExistent' }],
    });
    const tree = createTreeNode(doc);

    const result = validateBlueprintTree(tree);

    expect(result.valid).toBe(false);
    // Should have multiple errors: invalid types + missing references
    expect(result.errors.length).toBeGreaterThan(1);
  });

  it('skips warnings when errorsOnly is true', () => {
    const doc = createDocument({
      inputs: [
        { name: 'UsedInput', type: 'string', required: true },
        { name: 'UnusedInput', type: 'string', required: false },
      ],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      edges: [{ from: 'UsedInput', to: 'Output' }],
    });
    const tree = createTreeNode(doc);

    const resultWithWarnings = validateBlueprintTree(tree);
    const resultWithoutWarnings = validateBlueprintTree(tree, {
      errorsOnly: true,
    });

    expect(resultWithWarnings.warnings.length).toBeGreaterThan(0);
    expect(resultWithoutWarnings.warnings).toHaveLength(0);
  });

  it('rejects using a published output as an internal producer source', () => {
    const producer = createTreeNode(
      createDocument({
        meta: { id: 'ImageConsumer', name: 'Image Consumer', kind: 'producer' },
        inputs: [{ name: 'Image', type: 'image', required: true }],
        outputs: [{ name: 'Result', type: 'string', required: true }],
      }),
      { namespacePath: ['ImageConsumer'] }
    );
    const doc = createDocument({
      outputs: [
        { name: 'PublishedImage', type: 'image', required: true },
        { name: 'Result', type: 'string', required: true },
      ],
      imports: [{ name: 'ImageConsumer', path: './image-consumer.yaml' }],
      edges: [
        { from: 'PublishedImage', to: 'ImageConsumer.Image' },
        { from: 'ImageConsumer.Result', to: 'Result' },
      ],
    });
    const tree = createTreeNode(doc, {
      children: new Map([['ImageConsumer', producer]]),
    });

    const result = validateBlueprintTree(tree);

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PUBLISHED_OUTPUT_USED_AS_INTERNAL_SOURCE,
      })
    );
  });

  it('allows producer outputs to feed both published outputs and internal producer inputs', () => {
    const imageProducer = createTreeNode(
      createDocument({
        meta: { id: 'ImageProducer', name: 'Image Producer', kind: 'producer' },
        inputs: [{ name: 'Prompt', type: 'string', required: true }],
        outputs: [{ name: 'GeneratedImage', type: 'image', required: true }],
      }),
      { namespacePath: ['ImageProducer'] }
    );
    const videoProducer = createTreeNode(
      createDocument({
        meta: { id: 'VideoProducer', name: 'Video Producer', kind: 'producer' },
        inputs: [{ name: 'StartImage', type: 'image', required: true }],
        outputs: [{ name: 'GeneratedVideo', type: 'video', required: true }],
      }),
      { namespacePath: ['VideoProducer'] }
    );
    const doc = createDocument({
      inputs: [{ name: 'Prompt', type: 'text', required: true }],
      outputs: [
        { name: 'PublishedImage', type: 'image', required: true },
        { name: 'PublishedVideo', type: 'video', required: true },
      ],
      imports: [
        { name: 'ImageProducer', path: './image-producer.yaml' },
        { name: 'VideoProducer', path: './video-producer.yaml' },
      ],
      edges: [
        { from: 'Prompt', to: 'ImageProducer.Prompt' },
        { from: 'ImageProducer.GeneratedImage', to: 'PublishedImage' },
        { from: 'ImageProducer.GeneratedImage', to: 'VideoProducer.StartImage' },
        { from: 'VideoProducer.GeneratedVideo', to: 'PublishedVideo' },
      ],
    });
    const tree = createTreeNode(doc, {
      children: new Map([
        ['ImageProducer', imageProducer],
        ['VideoProducer', videoProducer],
      ]),
    });

    const issues = validatePublishedOutputsAreTerminal(tree);

    expect(issues).toHaveLength(0);
  });

  it('rejects semantic rules when required connections are not guarded by the declared condition', () => {
    const doc = createDocument({
      inputs: [
        { name: 'Workflow', type: 'string', required: true },
        { name: 'Prompt', type: 'text', required: true },
      ],
      outputs: [{ name: 'PromptOut', type: 'text', required: true }],
      conditions: {
        textWorkflow: { when: 'Workflow', is: 'Text' },
      },
      validation: {
        semanticRules: [
          {
            name: 'text prompt branch',
            condition: 'textWorkflow',
            requireGuardedConnections: [{ from: 'Prompt', to: 'PromptOut' }],
          },
        ],
      },
      edges: [{ from: 'Prompt', to: 'PromptOut' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateSemanticRules(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.SEMANTIC_VALIDATION_RULE_FAILED,
      })
    );
  });

  it('rejects semantic rules with isNot conditions when required connections are unguarded', () => {
    const doc = createDocument({
      inputs: [
        { name: 'Workflow', type: 'string', required: true },
        { name: 'Prompt', type: 'text', required: true },
      ],
      outputs: [{ name: 'PromptOut', type: 'text', required: true }],
      conditions: {
        notReferenceWorkflow: { when: 'Workflow', isNot: 'Reference' },
      },
      validation: {
        semanticRules: [
          {
            name: 'non-reference prompt branch',
            condition: 'notReferenceWorkflow',
            requireGuardedConnections: [{ from: 'Prompt', to: 'PromptOut' }],
          },
        ],
      },
      edges: [{ from: 'Prompt', to: 'PromptOut' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateSemanticRules(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.SEMANTIC_VALIDATION_RULE_FAILED,
      })
    );
  });

  it('rejects semantic rules with exists conditions when required connections are unguarded', () => {
    const doc = createDocument({
      inputs: [
        { name: 'ReferenceImage', type: 'image', required: false },
        { name: 'Prompt', type: 'text', required: true },
      ],
      outputs: [{ name: 'PromptOut', type: 'text', required: true }],
      conditions: {
        hasReferenceImage: { when: 'ReferenceImage', exists: true },
      },
      validation: {
        semanticRules: [
          {
            name: 'reference prompt branch',
            condition: 'hasReferenceImage',
            requireGuardedConnections: [{ from: 'Prompt', to: 'PromptOut' }],
          },
        ],
      },
      edges: [{ from: 'Prompt', to: 'PromptOut' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateSemanticRules(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.SEMANTIC_VALIDATION_RULE_FAILED,
      })
    );
  });
});

describe('validateConnectionEndpoints', () => {
  it('validates producer names exist', () => {
    const doc = createDocument({
      producers: [{ name: 'ValidProducer' }],
      edges: [{ from: 'InvalidProducer.Output', to: 'SomeInput' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateConnectionEndpoints(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PRODUCER_NOT_FOUND,
        message: expect.stringContaining('InvalidProducer'),
      })
    );
  });

  it('validates input references exist', () => {
    const doc = createDocument({
      inputs: [{ name: 'ValidInput', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      edges: [{ from: 'InvalidInput', to: 'Output' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateConnectionEndpoints(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INPUT_NOT_FOUND,
        message: expect.stringContaining('InvalidInput'),
      })
    );
  });

  it('validates artifact references exist', () => {
    const doc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [{ name: 'ValidArtifact', type: 'string', required: true }],
      edges: [{ from: 'Input', to: 'InvalidArtifact' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateConnectionEndpoints(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.ARTIFACT_NOT_FOUND,
        message: expect.stringContaining('InvalidArtifact'),
      })
    );
  });

  it('accepts system inputs without declaration', () => {
    const doc = createDocument({
      outputs: [{ name: 'Output', type: 'string', required: true }],
      edges: [
        { from: 'Duration', to: 'Output' },
        { from: 'NumOfSegments', to: 'Output' },
        { from: 'SegmentDuration', to: 'Output' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateConnectionEndpoints(tree);

    expect(issues).toHaveLength(0);
  });

  it('validates dimension references against declared loops', () => {
    const doc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      producers: [{ name: 'Producer' }],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [{ from: 'Input', to: 'Producer[undeclaredLoop].Input' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateConnectionEndpoints(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INVALID_NESTED_PATH,
        message: expect.stringContaining('undeclaredLoop'),
      })
    );
  });
});

describe('validateProducerInputOutput', () => {
  it('validates producer input exists', () => {
    const producerDoc = createDocument({
      inputs: [{ name: 'ValidInput', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, {
      namespacePath: ['Producer'],
    });

    const rootDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      imports: [{ name: 'Producer', producer: 'test/producer' }],
      edges: [{ from: 'Input', to: 'Producer.InvalidInput' }],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['Producer', producerNode]]),
    });

    const issues = validateProducerInputOutput(rootNode);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PRODUCER_INPUT_MISMATCH,
        message: expect.stringContaining('InvalidInput'),
      })
    );
  });

  it('validates producer output exists', () => {
    const producerDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [{ name: 'ValidOutput', type: 'string', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, {
      namespacePath: ['Producer'],
    });

    const rootDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      imports: [{ name: 'Producer', producer: 'test/producer' }],
      edges: [{ from: 'Producer.InvalidOutput', to: 'Output' }],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['Producer', producerNode]]),
    });

    const issues = validateProducerInputOutput(rootNode);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PRODUCER_OUTPUT_MISMATCH,
        message: expect.stringContaining('InvalidOutput'),
      })
    );
  });

  it('accepts valid producer input/output references', () => {
    const producerDoc = createDocument({
      inputs: [{ name: 'ProducerInput', type: 'string', required: true }],
      outputs: [{ name: 'ProducerOutput', type: 'string', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, {
      namespacePath: ['Producer'],
    });

    const rootDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      imports: [{ name: 'Producer', producer: 'test/producer' }],
      edges: [
        { from: 'Input', to: 'Producer.ProducerInput' },
        { from: 'Producer.ProducerOutput', to: 'Output' },
      ],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['Producer', producerNode]]),
    });

    const issues = validateProducerInputOutput(rootNode);

    expect(issues).toHaveLength(0);
  });

  it('rejects parent access to a composite producer private internal input', () => {
    const prepDoc = createDocument({
      inputs: [{ name: 'SourceImage', type: 'image', required: true }],
      outputs: [{ name: 'EditedImage', type: 'image', required: true }],
    });
    const mainVideoDoc = createDocument({
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'number', required: true },
        { name: 'StartImage', type: 'image', required: true },
      ],
      outputs: [{ name: 'GeneratedVideo', type: 'video', required: true }],
    });
    const compositeDoc = createDocument({
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'number', required: true },
        { name: 'SourceImage', type: 'image', required: true },
      ],
      outputs: [{ name: 'FinalVideo', type: 'video', required: true }],
      imports: [
        { name: 'PrepImage', path: './prep-image.yaml' },
        { name: 'MainVideo', path: './main-video.yaml' },
      ],
      edges: [
        { from: 'SourceImage', to: 'PrepImage.SourceImage' },
        { from: 'Prompt', to: 'MainVideo.Prompt' },
        { from: 'Duration', to: 'MainVideo.Duration' },
        { from: 'PrepImage.EditedImage', to: 'MainVideo.StartImage' },
        { from: 'MainVideo.GeneratedVideo', to: 'FinalVideo' },
      ],
    });

    const compositeNode = createTreeNode(compositeDoc, {
      namespacePath: ['SegmentUnit'],
      children: new Map([
        [
          'PrepImage',
          createTreeNode(prepDoc, { namespacePath: ['SegmentUnit', 'PrepImage'] }),
        ],
        [
          'MainVideo',
          createTreeNode(mainVideoDoc, {
            namespacePath: ['SegmentUnit', 'MainVideo'],
          }),
        ],
      ]),
    });

    const rootDoc = createDocument({
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'number', required: true },
        { name: 'SourceImage', type: 'image', required: true },
      ],
      outputs: [{ name: 'Output', type: 'video', required: true }],
      imports: [{ name: 'SegmentUnit', path: './segment-unit.yaml' }],
      edges: [
        { from: 'Prompt', to: 'SegmentUnit.MainVideo.Prompt' },
        { from: 'Duration', to: 'SegmentUnit.Duration' },
        { from: 'SourceImage', to: 'SegmentUnit.SourceImage' },
        { from: 'SegmentUnit.FinalVideo', to: 'Output' },
      ],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['SegmentUnit', compositeNode]]),
    });

    const issues = validateProducerInputOutput(rootNode);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PRODUCER_INPUT_MISMATCH,
        message: expect.stringContaining('does not expose input "MainVideo"'),
      })
    );
  });

  it('rejects parent access to a composite producer private internal artifact', () => {
    const compositeDoc = createDocument({
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'number', required: true },
        { name: 'SourceImage', type: 'image', required: true },
      ],
      outputs: [{ name: 'FinalVideo', type: 'video', required: true }],
      imports: [{ name: 'MainVideo', path: './main-video.yaml' }],
      edges: [
        { from: 'Prompt', to: 'MainVideo.Prompt' },
        { from: 'Duration', to: 'MainVideo.Duration' },
        { from: 'SourceImage', to: 'MainVideo.StartImage' },
        { from: 'MainVideo.GeneratedVideo', to: 'FinalVideo' },
      ],
    });

    const compositeNode = createTreeNode(compositeDoc, {
      namespacePath: ['SegmentUnit'],
      children: new Map([
        [
          'MainVideo',
          createTreeNode(
            createDocument({
              inputs: [
                { name: 'Prompt', type: 'string', required: true },
                { name: 'Duration', type: 'number', required: true },
                { name: 'StartImage', type: 'image', required: true },
              ],
              outputs: [
                { name: 'GeneratedVideo', type: 'video', required: true },
              ],
            }),
            {
              namespacePath: ['SegmentUnit', 'MainVideo'],
            }
          ),
        ],
      ]),
    });

    const rootDoc = createDocument({
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'number', required: true },
        { name: 'SourceImage', type: 'image', required: true },
      ],
      outputs: [{ name: 'Output', type: 'video', required: true }],
      imports: [{ name: 'SegmentUnit', path: './segment-unit.yaml' }],
      edges: [
        { from: 'Prompt', to: 'SegmentUnit.Prompt' },
        { from: 'Duration', to: 'SegmentUnit.Duration' },
        { from: 'SourceImage', to: 'SegmentUnit.SourceImage' },
        { from: 'SegmentUnit.MainVideo.GeneratedVideo', to: 'Output' },
      ],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['SegmentUnit', compositeNode]]),
    });

    const issues = validateProducerInputOutput(rootNode);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PRODUCER_OUTPUT_MISMATCH,
        message: expect.stringContaining(
          'does not expose output "MainVideo"'
        ),
      })
    );
  });
});

describe('validateMediaProducerDurationContract', () => {
  it('validates standalone media producer definitions too', () => {
    const producerDoc = createDocument({
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'Video', type: 'video', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, {
      sourcePath: '/test/producer.yaml',
    });

    const issues = validateMediaProducerDurationContract(producerNode);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.MEDIA_PRODUCER_MISSING_DURATION_INPUT,
      })
    );
  });

  it('requires media producers to declare a required Duration input', () => {
    const producerDoc = createDocument({
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'Video', type: 'video', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, {
      namespacePath: ['VideoProducer'],
    });

    const rootDoc = createDocument({
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'video', required: true }],
      imports: [{ name: 'VideoProducer', producer: 'test/video-producer' }],
      edges: [
        { from: 'Prompt', to: 'VideoProducer.Prompt' },
        { from: 'VideoProducer.Video', to: 'Output' },
      ],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['VideoProducer', producerNode]]),
    });

    const issues = validateMediaProducerDurationContract(rootNode);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.MEDIA_PRODUCER_MISSING_DURATION_INPUT,
      })
    );
  });

  it('requires media producers to have an explicit Duration binding', () => {
    const producerDoc = createDocument({
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'number', required: true },
      ],
      outputs: [{ name: 'Video', type: 'video', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, {
      namespacePath: ['VideoProducer'],
    });

    const rootDoc = createDocument({
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'video', required: true }],
      imports: [{ name: 'VideoProducer', producer: 'test/video-producer' }],
      edges: [
        { from: 'Prompt', to: 'VideoProducer.Prompt' },
        { from: 'VideoProducer.Video', to: 'Output' },
      ],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['VideoProducer', producerNode]]),
    });

    const issues = validateMediaProducerDurationContract(rootNode);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.MEDIA_PRODUCER_MISSING_DURATION_BINDING,
      })
    );
  });

  it('accepts media producers with a required Duration input and explicit binding', () => {
    const producerDoc = createDocument({
      inputs: [
        { name: 'Prompt', type: 'string', required: true },
        { name: 'Duration', type: 'number', required: true },
      ],
      outputs: [{ name: 'Audio', type: 'audio', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, {
      namespacePath: ['AudioProducer'],
    });

    const rootDoc = createDocument({
      inputs: [{ name: 'Prompt', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'audio', required: true }],
      imports: [{ name: 'AudioProducer', producer: 'test/audio-producer' }],
      edges: [
        { from: 'Prompt', to: 'AudioProducer.Prompt' },
        { from: 'SegmentDuration', to: 'AudioProducer.Duration' },
        { from: 'AudioProducer.Audio', to: 'Output' },
      ],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['AudioProducer', producerNode]]),
    });

    const issues = validateMediaProducerDurationContract(rootNode);

    expect(issues).toHaveLength(0);
  });
});

describe('validateSegmentDurationContract', () => {
  it('rejects SegmentDuration declared as a user-facing orchestration input', () => {
    const doc = createDocument({
      inputs: [
        { name: 'Duration', type: 'int', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
        { name: 'SegmentDuration', type: 'int', required: false },
      ],
      imports: [{ name: 'VideoProducer', producer: 'test/video-producer' }],
      edges: [{ from: 'SegmentDuration', to: 'VideoProducer.Duration' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateSegmentDurationContract(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.SEGMENT_DURATION_INPUT_DECLARED,
      })
    );
  });

  it('requires Duration when SegmentDuration is used', () => {
    const doc = createDocument({
      inputs: [{ name: 'NumOfSegments', type: 'int', required: true }],
      imports: [{ name: 'VideoProducer', producer: 'test/video-producer' }],
      edges: [{ from: 'SegmentDuration', to: 'VideoProducer.Duration' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateSegmentDurationContract(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.SEGMENT_DURATION_REQUIRES_DURATION_INPUT,
      })
    );
  });

  it('requires NumOfSegments when SegmentDuration is used', () => {
    const doc = createDocument({
      inputs: [{ name: 'Duration', type: 'int', required: true }],
      imports: [{ name: 'VideoProducer', producer: 'test/video-producer' }],
      edges: [{ from: 'SegmentDuration', to: 'VideoProducer.Duration' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateSegmentDurationContract(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.SEGMENT_DURATION_REQUIRES_NUM_SEGMENTS_INPUT,
      })
    );
  });

  it('accepts orchestration blueprints that derive SegmentDuration from required Duration and NumOfSegments', () => {
    const doc = createDocument({
      inputs: [
        { name: 'Duration', type: 'int', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      imports: [{ name: 'VideoProducer', producer: 'test/video-producer' }],
      edges: [{ from: 'SegmentDuration', to: 'VideoProducer.Duration' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateSegmentDurationContract(tree);

    expect(issues).toHaveLength(0);
  });

  it('does not apply the SegmentDuration input rule to leaf prompt blueprints', () => {
    const doc = createDocument({
      inputs: [{ name: 'SegmentDuration', type: 'int', required: true }],
      outputs: [{ name: 'Prompt', type: 'string', required: true }],
    });
    const tree = createTreeNode(doc);

    const issues = validateSegmentDurationContract(tree);

    expect(issues).toHaveLength(0);
  });
});

describe('validateLoopCountInputs', () => {
  it('validates loop countInput references exist', () => {
    const doc = createDocument({
      inputs: [{ name: 'ValidInput', type: 'number', required: true }],
      loops: [{ name: 'segment', countInput: 'InvalidCountInput' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateLoopCountInputs(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.LOOP_COUNTINPUT_NOT_FOUND,
        message: expect.stringContaining('InvalidCountInput'),
      })
    );
  });

  it('accepts system inputs as countInput', () => {
    const doc = createDocument({
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateLoopCountInputs(tree);

    expect(issues).toHaveLength(0);
  });
});

describe('validateInputCountInputs', () => {
  it('validates input countInput references exist', () => {
    const doc = createDocument({
      inputs: [
        {
          name: 'CharacterDescriptions',
          type: 'array',
          itemType: 'string',
          required: true,
          countInput: 'InvalidCountInput',
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateInputCountInputs(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INPUT_COUNTINPUT_NOT_FOUND,
        message: expect.stringContaining('InvalidCountInput'),
      })
    );
  });

  it('accepts system inputs as input countInput', () => {
    const doc = createDocument({
      inputs: [
        {
          name: 'ScenePrompts',
          type: 'array',
          itemType: 'text',
          required: true,
          countInput: 'NumOfSegments',
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateInputCountInputs(tree);

    expect(issues).toHaveLength(0);
  });
});

describe('validateArtifactCountInputs', () => {
  it('validates artifact countInput references exist', () => {
    const doc = createDocument({
      inputs: [{ name: 'ValidInput', type: 'number', required: true }],
      outputs: [
        {
          name: 'ArrayArtifact',
          type: 'array',
          itemType: 'string',
          countInput: 'InvalidCountInput',
          required: true,
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateArtifactCountInputs(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.ARTIFACT_COUNTINPUT_NOT_FOUND,
        message: expect.stringContaining('InvalidCountInput'),
      })
    );
  });

  it('accepts valid countInput references', () => {
    const doc = createDocument({
      inputs: [{ name: 'Count', type: 'number', required: true }],
      outputs: [
        {
          name: 'ArrayArtifact',
          type: 'array',
          itemType: 'string',
          countInput: 'Count',
          required: true,
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateArtifactCountInputs(tree);

    expect(issues).toHaveLength(0);
  });
});

describe('validateConditionPaths', () => {
  it('validates condition when path producer exists', () => {
    const doc = createDocument({
      imports: [{ name: 'ValidProducer', producer: 'test/valid-producer' }],
      conditions: {
        testCondition: {
          when: 'InvalidProducer.Output.Field',
          is: 'value',
        },
      },
    });
    const tree = createTreeNode(doc);

    const issues = validateConditionPaths(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.CONDITION_PATH_INVALID,
        message: expect.stringContaining('InvalidProducer'),
      })
    );
  });

  it('accepts valid condition paths', () => {
    const doc = createDocument({
      imports: [{ name: 'Producer', producer: 'test/producer' }],
      conditions: {
        testCondition: {
          when: 'Producer.Output.Field',
          is: 'value',
        },
      },
    });
    const tree = createTreeNode(doc);

    const issues = validateConditionPaths(tree);

    expect(issues).toHaveLength(0);
  });

  it('validates nested condition groups', () => {
    const doc = createDocument({
      imports: [{ name: 'ValidProducer', producer: 'test/valid-producer' }],
      conditions: {
        testCondition: {
          any: [
            { when: 'InvalidProducer1.Output', is: 'value' },
            { when: 'InvalidProducer2.Output', is: 'value' },
          ],
        },
      },
    });
    const tree = createTreeNode(doc);

    const issues = validateConditionPaths(tree);

    expect(issues.length).toBe(2);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.CONDITION_PATH_INVALID,
        message: expect.stringContaining('InvalidProducer1'),
      })
    );
  });
});

describe('validateTypes', () => {
  it('validates invalid input types', () => {
    const doc = createDocument({
      inputs: [{ name: 'Input', type: 'invalid-type', required: true }],
    });
    const tree = createTreeNode(doc);

    const issues = validateTypes(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INVALID_INPUT_TYPE,
        message: expect.stringContaining('invalid-type'),
      })
    );
  });

  it('validates invalid artifact types', () => {
    const doc = createDocument({
      outputs: [{ name: 'Artifact', type: 'invalid-type', required: true }],
    });
    const tree = createTreeNode(doc);

    const issues = validateTypes(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INVALID_ARTIFACT_TYPE,
        message: expect.stringContaining('invalid-type'),
      })
    );
  });

  it('validates invalid itemTypes', () => {
    const doc = createDocument({
      outputs: [
        {
          name: 'ArrayArtifact',
          type: 'array',
          itemType: 'invalid-item-type',
          required: true,
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateTypes(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INVALID_ITEM_TYPE,
        message: expect.stringContaining('invalid-item-type'),
      })
    );
  });

  it('accepts valid types', () => {
    const doc = createDocument({
      inputs: [
        { name: 'StringInput', type: 'string', required: true },
        { name: 'NumberInput', type: 'number', required: true },
        { name: 'IntInput', type: 'int', required: true },
        { name: 'BoolInput', type: 'boolean', required: true },
      ],
      outputs: [
        { name: 'StringArtifact', type: 'string', required: true },
        { name: 'ImageArtifact', type: 'image', required: true },
        { name: 'VideoArtifact', type: 'video', required: true },
        { name: 'AudioArtifact', type: 'audio', required: true },
        { name: 'JsonArtifact', type: 'json', required: true },
        {
          name: 'ArrayArtifact',
          type: 'array',
          itemType: 'image',
          required: true,
        },
        {
          name: 'TextArrayArtifact',
          type: 'array',
          itemType: 'text',
          required: true,
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateTypes(tree);

    expect(issues).toHaveLength(0);
  });
});

describe('findUnusedInputs', () => {
  it('finds unused inputs', () => {
    const doc = createDocument({
      inputs: [
        { name: 'UsedInput', type: 'string', required: true },
        { name: 'UnusedInput', type: 'string', required: false },
      ],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      edges: [{ from: 'UsedInput', to: 'Output' }],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedInputs(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.UNUSED_INPUT,
        message: expect.stringContaining('UnusedInput'),
      })
    );
  });

  it('does not report inputs used in loop countInput', () => {
    const doc = createDocument({
      inputs: [{ name: 'Count', type: 'number', required: true }],
      loops: [{ name: 'segment', countInput: 'Count' }],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedInputs(tree);

    expect(issues).toHaveLength(0);
  });

  it('does not report inputs used in artifact countInput', () => {
    const doc = createDocument({
      inputs: [{ name: 'Count', type: 'number', required: true }],
      outputs: [
        {
          name: 'Array',
          type: 'array',
          itemType: 'string',
          countInput: 'Count',
          required: true,
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedInputs(tree);

    expect(issues).toHaveLength(0);
  });

  it('does not report inputs used in input countInput', () => {
    const doc = createDocument({
      inputs: [
        {
          name: 'CharacterDescriptions',
          type: 'array',
          itemType: 'text',
          required: true,
          countInput: 'NumOfCharacters',
        },
        { name: 'NumOfCharacters', type: 'number', required: true },
      ],
      outputs: [{ name: 'Output', type: 'string', required: true }],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedInputs(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.UNUSED_INPUT,
        message: expect.stringContaining('CharacterDescriptions'),
      })
    );
    expect(issues).not.toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.UNUSED_INPUT,
        message: expect.stringContaining('NumOfCharacters'),
      })
    );
  });

  it('emits a targeted warning for unused count-style inputs', () => {
    const doc = createDocument({
      inputs: [{ name: 'NumOfStyleImages', type: 'number', required: false }],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedInputs(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.UNUSED_INPUT,
        message: expect.stringContaining(
          'count-style input looks unnecessary and should be removed'
        ),
        suggestion: expect.stringContaining('loops[].countInput'),
      })
    );
  });

  it('does not warn on declared producer-contract inputs inside producer blueprints', () => {
    const doc = createDocument({
      meta: { kind: 'producer' },
      inputs: [{ name: 'NumOfSegments', type: 'number', required: true }],
      outputs: [{ name: 'AssetPlan', type: 'json', required: true }],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedInputs(tree);

    expect(issues).toHaveLength(0);
  });
});

describe('findUnusedArtifacts', () => {
  it('finds unused artifacts', () => {
    const doc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [
        { name: 'UsedArtifact', type: 'string', required: true },
        { name: 'UnusedArtifact', type: 'string', required: false },
      ],
      edges: [{ from: 'Input', to: 'UsedArtifact' }],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedArtifacts(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.UNUSED_ARTIFACT,
        message: expect.stringContaining('UnusedArtifact'),
      })
    );
  });

  it('does not warn on declared producer-contract outputs inside producer blueprints', () => {
    const doc = createDocument({
      meta: { kind: 'producer' },
      outputs: [{ name: 'AssetPlan', type: 'json', required: true }],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedArtifacts(tree);

    expect(issues).toHaveLength(0);
  });
});

describe('findUnreachableProducers', () => {
  it('finds producers with no incoming connections', () => {
    const doc = createDocument({
      imports: [
        { name: 'ReachableProducer', producer: 'test/reachable-producer' },
        { name: 'UnreachableProducer', producer: 'test/unreachable-producer' },
      ],
      inputs: [{ name: 'Input', type: 'string', required: true }],
      edges: [{ from: 'Input', to: 'ReachableProducer.Input' }],
    });
    const tree = createTreeNode(doc);

    const issues = findUnreachableProducers(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.UNREACHABLE_PRODUCER,
        message: expect.stringContaining('UnreachableProducer'),
      })
    );
    expect(issues).not.toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('ReachableProducer'),
      })
    );
  });
});

describe('recursive validation', () => {
  it('validates nested producer blueprints', () => {
    const childDoc = createDocument({
      inputs: [{ name: 'ChildInput', type: 'invalid-type', required: true }],
      outputs: [{ name: 'ChildOutput', type: 'string', required: true }],
    });
    const childNode = createTreeNode(childDoc, {
      namespacePath: ['Producer'],
      sourcePath: '/test/producer.yaml',
    });

    const rootDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      producers: [{ name: 'Producer' }],
      edges: [
        { from: 'Input', to: 'Producer.ChildInput' },
        { from: 'Producer.ChildOutput', to: 'Output' },
      ],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['Producer', childNode]]),
    });

    const result = validateBlueprintTree(rootNode);

    // Should find the invalid type in the child blueprint
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INVALID_INPUT_TYPE,
        location: expect.objectContaining({
          namespacePath: ['Producer'],
        }),
      })
    );
  });
});

describe('validateProducerCycles', () => {
  it('detects simple two-node cycle', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      edges: [
        { from: 'ProducerA.Output', to: 'ProducerB.Input' },
        { from: 'ProducerB.Output', to: 'ProducerA.Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateProducerCycles(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PRODUCER_CYCLE,
        message: expect.stringMatching(
          /cycle.*ProducerA.*ProducerB.*ProducerA/i
        ),
      })
    );
  });

  it('detects multi-node cycle', () => {
    const doc = createDocument({
      producers: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
        { name: 'ProducerC' },
      ],
      edges: [
        { from: 'ProducerA.Output', to: 'ProducerB.Input' },
        { from: 'ProducerB.Output', to: 'ProducerC.Input' },
        { from: 'ProducerC.Output', to: 'ProducerA.Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateProducerCycles(tree);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: ValidationErrorCode.PRODUCER_CYCLE,
    });
  });

  it('does not report false positives for valid DAG', () => {
    const doc = createDocument({
      producers: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
        { name: 'ProducerC' },
      ],
      edges: [
        { from: 'ProducerA.Output', to: 'ProducerB.Input' },
        { from: 'ProducerA.Output', to: 'ProducerC.Input' },
        { from: 'ProducerB.Output', to: 'ProducerC.OtherInput' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateProducerCycles(tree);

    expect(issues).toHaveLength(0);
  });

  it('handles self-referencing edges gracefully', () => {
    // Self-reference (A -> A) is not a cycle in traditional graph sense
    // since we filter fromProducer !== toProducer
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }],
      edges: [{ from: 'ProducerA.Output', to: 'ProducerA.Input' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateProducerCycles(tree);

    // Self-references are filtered out (not considered cycles in this validator)
    expect(issues).toHaveLength(0);
  });

  it('ignores edges from/to inputs and artifacts', () => {
    const doc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      producers: [{ name: 'Producer' }],
      edges: [
        { from: 'Input', to: 'Producer.Input' },
        { from: 'Producer.Output', to: 'Output' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateProducerCycles(tree);

    expect(issues).toHaveLength(0);
  });
});

describe('validateDimensionConsistency', () => {
  it('detects dimension loss when target input is not fanIn', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [{ from: 'ProducerA[segment].Output', to: 'ProducerB.Input' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.DIMENSION_MISMATCH,
        message: expect.stringContaining('1 dimension'),
      })
    );
  });

  it('allows cross-dimension patterns (different dimension names)', () => {
    // Cross-dimension patterns like [image] -> [segment] are valid
    // for sliding window and other intentional patterns
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      loops: [
        { name: 'segment', countInput: 'NumOfSegments' },
        { name: 'image', countInput: 'NumOfImages' },
      ],
      edges: [
        { from: 'ProducerA[segment].Output', to: 'ProducerB[image].Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    // Cross-dimension is allowed, not an error
    expect(issues).toHaveLength(0);
  });

  it('allows matching dimensions', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'ProducerA[segment].Output', to: 'ProducerB[segment].Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    expect(issues).toHaveLength(0);
  });

  it('allows dimension loss when target input is fanIn', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [{ from: 'ProducerA[segment].Output', to: 'ProducerB.Input' }],
    });
    const tree = createTreeNode(doc, {
      children: new Map([
        [
          'ProducerB',
          createTreeNode(
            createDocument({
              inputs: [
                { name: 'Input', type: 'string', required: false, fanIn: true },
              ],
            }),
            { namespacePath: ['ProducerB'] }
          ),
        ],
      ]),
    });

    const issues = validateDimensionConsistency(tree);

    expect(issues).toHaveLength(0);
  });

  it('reports error when edge has dimension loss and target input is not fanIn', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [{ from: 'ProducerA[segment].Output', to: 'ProducerB.Input' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: ValidationErrorCode.DIMENSION_MISMATCH,
      message: expect.stringContaining('ProducerA'),
    });
  });

  it('rejects groupBy/orderBy on non-fanIn targets', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [
        {
          from: 'ProducerA[segment].Output',
          to: 'ProducerB.Input',
          groupBy: 'segment',
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.DIMENSION_MISMATCH,
        message: expect.stringContaining('declares groupBy/orderBy'),
      })
    );
  });

  it('requires explicit metadata when fanIn source has more than two dimensions', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      loops: [
        { name: 'segment', countInput: 'NumOfSegments' },
        { name: 'image', countInput: 'NumOfImages' },
        { name: 'variant', countInput: 'NumOfVariants' },
      ],
      edges: [
        {
          from: 'ProducerA[segment][image][variant].Output',
          to: 'ProducerB.Input',
        },
      ],
    });
    const tree = createTreeNode(doc, {
      children: new Map([
        [
          'ProducerB',
          createTreeNode(
            createDocument({
              inputs: [
                { name: 'Input', type: 'string', required: false, fanIn: true },
              ],
            }),
            { namespacePath: ['ProducerB'] }
          ),
        ],
      ]),
    });

    const issues = validateDimensionConsistency(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.DIMENSION_MISMATCH,
        message: expect.stringContaining('uses 3 dimensions'),
      })
    );
  });

  it('allows high-dimensional fanIn when groupBy is provided', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      loops: [
        { name: 'segment', countInput: 'NumOfSegments' },
        { name: 'image', countInput: 'NumOfImages' },
        { name: 'variant', countInput: 'NumOfVariants' },
      ],
      edges: [
        {
          from: 'ProducerA[segment][image][variant].Output',
          to: 'ProducerB.Input',
          groupBy: 'segment',
          orderBy: 'image',
        },
      ],
    });
    const tree = createTreeNode(doc, {
      children: new Map([
        [
          'ProducerB',
          createTreeNode(
            createDocument({
              inputs: [
                { name: 'Input', type: 'string', required: false, fanIn: true },
              ],
            }),
            { namespacePath: ['ProducerB'] }
          ),
        ],
      ]),
    });

    const issues = validateDimensionConsistency(tree);

    expect(issues).toHaveLength(0);
  });

  it('ignores numeric indices in dimensions', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      edges: [{ from: 'ProducerA[0].Output', to: 'ProducerB.Input' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    // Numeric indices are not loop dimensions
    expect(issues).toHaveLength(0);
  });

  it('ignores offset expressions in dimensions', () => {
    const doc = createDocument({
      producers: [{ name: 'ProducerA' }, { name: 'ProducerB' }],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'ProducerA[segment+1].Output', to: 'ProducerB[segment].Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    // segment+1 is treated as offset expression, not a loop dimension
    // This edge has 0 extracted dimensions on both sides, so no mismatch
    expect(issues).toHaveLength(0);
  });

  it('does not check input-to-producer or producer-to-artifact edges', () => {
    const doc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      outputs: [{ name: 'Output', type: 'string', required: true }],
      producers: [{ name: 'Producer' }],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'Input', to: 'Producer[segment].Input' },
        { from: 'Producer[segment].Output', to: 'Output' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    // Only producer-to-producer edges are checked
    expect(issues).toHaveLength(0);
  });
});
