import { describe, expect, it } from 'vitest';
import type { BlueprintTreeNode, BlueprintDocument } from '../types.js';
import {
  validateBlueprintTree,
  validateConnectionEndpoints,
  validateProducerInputOutput,
  validateLoopCountInputs,
  validateArtifactCountInputs,
  validateCollectors,
  validateCollectorConnections,
  validateConditionPaths,
  validateTypes,
  validateProducerCycles,
  validateDimensionConsistency,
  findUnusedInputs,
  findUnusedArtifacts,
  findUnreachableProducers,
} from './blueprint-validator.js';
import { ValidationErrorCode } from './types.js';

/**
 * Helper to create a minimal valid blueprint document
 */
function createDocument(overrides: Partial<BlueprintDocument> = {}): BlueprintDocument {
  return {
    meta: { id: 'test', name: 'Test Blueprint' },
    inputs: [],
    artefacts: [],
    producers: [],
    producerImports: [],
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
  } = {},
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
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      edges: [
        { from: 'Prompt', to: 'Output' },
      ],
    });
    const tree = createTreeNode(doc);

    const result = validateBlueprintTree(tree);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('collects multiple errors without failing early', () => {
    const doc = createDocument({
      inputs: [{ name: 'Prompt', type: 'invalid-type', required: true }],
      artefacts: [{ name: 'Output', type: 'invalid-type', required: true }],
      edges: [
        { from: 'NonExistent', to: 'AlsoNonExistent' },
      ],
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
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      edges: [
        { from: 'UsedInput', to: 'Output' },
      ],
    });
    const tree = createTreeNode(doc);

    const resultWithWarnings = validateBlueprintTree(tree);
    const resultWithoutWarnings = validateBlueprintTree(tree, { errorsOnly: true });

    expect(resultWithWarnings.warnings.length).toBeGreaterThan(0);
    expect(resultWithoutWarnings.warnings).toHaveLength(0);
  });
});

describe('validateConnectionEndpoints', () => {
  it('validates producer names exist', () => {
    const doc = createDocument({
      producerImports: [{ name: 'ValidProducer' }],
      edges: [
        { from: 'InvalidProducer.Output', to: 'SomeInput' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateConnectionEndpoints(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PRODUCER_NOT_FOUND,
        message: expect.stringContaining('InvalidProducer'),
      }),
    );
  });

  it('validates input references exist', () => {
    const doc = createDocument({
      inputs: [{ name: 'ValidInput', type: 'string', required: true }],
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      edges: [
        { from: 'InvalidInput', to: 'Output' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateConnectionEndpoints(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INPUT_NOT_FOUND,
        message: expect.stringContaining('InvalidInput'),
      }),
    );
  });

  it('validates artifact references exist', () => {
    const doc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      artefacts: [{ name: 'ValidArtifact', type: 'string', required: true }],
      edges: [
        { from: 'Input', to: 'InvalidArtifact' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateConnectionEndpoints(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.ARTIFACT_NOT_FOUND,
        message: expect.stringContaining('InvalidArtifact'),
      }),
    );
  });

  it('accepts system inputs without declaration', () => {
    const doc = createDocument({
      artefacts: [{ name: 'Output', type: 'string', required: true }],
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
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      producerImports: [{ name: 'Producer' }],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'Input', to: 'Producer[undeclaredLoop].Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateConnectionEndpoints(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INVALID_NESTED_PATH,
        message: expect.stringContaining('undeclaredLoop'),
      }),
    );
  });
});

describe('validateProducerInputOutput', () => {
  it('validates producer input exists', () => {
    const producerDoc = createDocument({
      inputs: [{ name: 'ValidInput', type: 'string', required: true }],
      artefacts: [{ name: 'Output', type: 'string', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, { namespacePath: ['Producer'] });

    const rootDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      producerImports: [{ name: 'Producer' }],
      edges: [
        { from: 'Input', to: 'Producer.InvalidInput' },
      ],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['Producer', producerNode]]),
    });

    const issues = validateProducerInputOutput(rootNode);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PRODUCER_INPUT_MISMATCH,
        message: expect.stringContaining('InvalidInput'),
      }),
    );
  });

  it('validates producer output exists', () => {
    const producerDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      artefacts: [{ name: 'ValidOutput', type: 'string', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, { namespacePath: ['Producer'] });

    const rootDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      producerImports: [{ name: 'Producer' }],
      edges: [
        { from: 'Producer.InvalidOutput', to: 'Output' },
      ],
    });
    const rootNode = createTreeNode(rootDoc, {
      children: new Map([['Producer', producerNode]]),
    });

    const issues = validateProducerInputOutput(rootNode);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.PRODUCER_OUTPUT_MISMATCH,
        message: expect.stringContaining('InvalidOutput'),
      }),
    );
  });

  it('accepts valid producer input/output references', () => {
    const producerDoc = createDocument({
      inputs: [{ name: 'ProducerInput', type: 'string', required: true }],
      artefacts: [{ name: 'ProducerOutput', type: 'string', required: true }],
    });
    const producerNode = createTreeNode(producerDoc, { namespacePath: ['Producer'] });

    const rootDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      producerImports: [{ name: 'Producer' }],
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
      }),
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

describe('validateArtifactCountInputs', () => {
  it('validates artifact countInput references exist', () => {
    const doc = createDocument({
      inputs: [{ name: 'ValidInput', type: 'number', required: true }],
      artefacts: [
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
      }),
    );
  });

  it('accepts valid countInput references', () => {
    const doc = createDocument({
      inputs: [{ name: 'Count', type: 'number', required: true }],
      artefacts: [
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

describe('validateCollectors', () => {
  it('validates collector from producer exists', () => {
    const doc = createDocument({
      producerImports: [{ name: 'ValidProducer' }],
      collectors: [
        {
          name: 'TestCollector',
          from: 'InvalidProducer.Output',
          into: 'ValidProducer.Input',
          groupBy: 'segment',
        },
      ],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateCollectors(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.COLLECTOR_SOURCE_INVALID,
        message: expect.stringContaining('InvalidProducer'),
      }),
    );
  });

  it('validates collector into producer exists', () => {
    const doc = createDocument({
      producerImports: [{ name: 'ValidProducer' }],
      collectors: [
        {
          name: 'TestCollector',
          from: 'ValidProducer.Output',
          into: 'InvalidProducer.Input',
          groupBy: 'segment',
        },
      ],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
    });
    const tree = createTreeNode(doc);

    const issues = validateCollectors(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.COLLECTOR_TARGET_INVALID,
        message: expect.stringContaining('InvalidProducer'),
      }),
    );
  });
});

describe('validateCollectorConnections', () => {
  it('detects collector without corresponding connection', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ImageProducer' },
        { name: 'TimelineComposer' },
      ],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      // Collector defined but NO connection
      collectors: [
        {
          name: 'TimelineImages',
          from: 'ImageProducer[segment].GeneratedImage',
          into: 'TimelineComposer.ImageSegments',
          groupBy: 'segment',
        },
      ],
      edges: [
        // Missing the required connection!
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateCollectorConnections(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.COLLECTOR_MISSING_CONNECTION,
        message: expect.stringMatching(/TimelineImages.*no corresponding connection/),
      }),
    );
  });

  it('accepts collector with matching connection', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ImageProducer' },
        { name: 'TimelineComposer' },
      ],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      // Both collector AND connection defined
      collectors: [
        {
          name: 'TimelineImages',
          from: 'ImageProducer[segment].GeneratedImage',
          into: 'TimelineComposer.ImageSegments',
          groupBy: 'segment',
        },
      ],
      edges: [
        // The required connection
        {
          from: 'ImageProducer[segment].GeneratedImage',
          to: 'TimelineComposer.ImageSegments',
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateCollectorConnections(tree);

    expect(issues).toHaveLength(0);
  });

  it('matches connection even with different dimension selectors', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ImageProducer' },
        { name: 'TimelineComposer' },
      ],
      loops: [
        { name: 'segment', countInput: 'NumOfSegments' },
        { name: 'image', parent: 'segment', countInput: 'NumOfImages' },
      ],
      collectors: [
        {
          name: 'TimelineImages',
          from: 'ImageProducer[segment][image].GeneratedImage',
          into: 'TimelineComposer.ImageSegments',
          groupBy: 'segment',
          orderBy: 'image',
        },
      ],
      edges: [
        // Connection with same base path but different dimension notation
        {
          from: 'ImageProducer[segment][image].GeneratedImage',
          to: 'TimelineComposer.ImageSegments',
        },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateCollectorConnections(tree);

    expect(issues).toHaveLength(0);
  });

  it('detects multiple collectors without connections', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ImageProducer' },
        { name: 'AudioProducer' },
        { name: 'TimelineComposer' },
      ],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      collectors: [
        {
          name: 'TimelineImages',
          from: 'ImageProducer[segment].GeneratedImage',
          into: 'TimelineComposer.ImageSegments',
          groupBy: 'segment',
        },
        {
          name: 'TimelineAudio',
          from: 'AudioProducer[segment].GeneratedAudio',
          into: 'TimelineComposer.AudioSegments',
          groupBy: 'segment',
        },
      ],
      edges: [],
    });
    const tree = createTreeNode(doc);

    const issues = validateCollectorConnections(tree);

    expect(issues).toHaveLength(2);
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.COLLECTOR_MISSING_CONNECTION,
        message: expect.stringContaining('TimelineImages'),
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.COLLECTOR_MISSING_CONNECTION,
        message: expect.stringContaining('TimelineAudio'),
      }),
    );
  });
});

describe('validateConditionPaths', () => {
  it('validates condition when path producer exists', () => {
    const doc = createDocument({
      producerImports: [{ name: 'ValidProducer' }],
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
      }),
    );
  });

  it('accepts valid condition paths', () => {
    const doc = createDocument({
      producerImports: [{ name: 'Producer' }],
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
      producerImports: [{ name: 'ValidProducer' }],
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
      }),
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
      }),
    );
  });

  it('validates invalid artifact types', () => {
    const doc = createDocument({
      artefacts: [{ name: 'Artifact', type: 'invalid-type', required: true }],
    });
    const tree = createTreeNode(doc);

    const issues = validateTypes(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.INVALID_ARTIFACT_TYPE,
        message: expect.stringContaining('invalid-type'),
      }),
    );
  });

  it('validates invalid itemTypes', () => {
    const doc = createDocument({
      artefacts: [
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
      }),
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
      artefacts: [
        { name: 'StringArtifact', type: 'string', required: true },
        { name: 'ImageArtifact', type: 'image', required: true },
        { name: 'VideoArtifact', type: 'video', required: true },
        { name: 'AudioArtifact', type: 'audio', required: true },
        { name: 'JsonArtifact', type: 'json', required: true },
        { name: 'ArrayArtifact', type: 'array', itemType: 'image', required: true },
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
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      edges: [
        { from: 'UsedInput', to: 'Output' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedInputs(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.UNUSED_INPUT,
        message: expect.stringContaining('UnusedInput'),
      }),
    );
  });

  it('does not report inputs used in loop countInput', () => {
    const doc = createDocument({
      inputs: [
        { name: 'Count', type: 'number', required: true },
      ],
      loops: [{ name: 'segment', countInput: 'Count' }],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedInputs(tree);

    expect(issues).toHaveLength(0);
  });

  it('does not report inputs used in artifact countInput', () => {
    const doc = createDocument({
      inputs: [
        { name: 'Count', type: 'number', required: true },
      ],
      artefacts: [
        { name: 'Array', type: 'array', itemType: 'string', countInput: 'Count', required: true },
      ],
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
      artefacts: [
        { name: 'UsedArtifact', type: 'string', required: true },
        { name: 'UnusedArtifact', type: 'string', required: false },
      ],
      edges: [
        { from: 'Input', to: 'UsedArtifact' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = findUnusedArtifacts(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.UNUSED_ARTIFACT,
        message: expect.stringContaining('UnusedArtifact'),
      }),
    );
  });
});

describe('findUnreachableProducers', () => {
  it('finds producers with no incoming connections', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ReachableProducer' },
        { name: 'UnreachableProducer' },
      ],
      inputs: [{ name: 'Input', type: 'string', required: true }],
      edges: [
        { from: 'Input', to: 'ReachableProducer.Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = findUnreachableProducers(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.UNREACHABLE_PRODUCER,
        message: expect.stringContaining('UnreachableProducer'),
      }),
    );
    expect(issues).not.toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('ReachableProducer'),
      }),
    );
  });
});

describe('recursive validation', () => {
  it('validates nested producer blueprints', () => {
    const childDoc = createDocument({
      inputs: [{ name: 'ChildInput', type: 'invalid-type', required: true }],
      artefacts: [{ name: 'ChildOutput', type: 'string', required: true }],
    });
    const childNode = createTreeNode(childDoc, {
      namespacePath: ['Producer'],
      sourcePath: '/test/producer.yaml',
    });

    const rootDoc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      producerImports: [{ name: 'Producer' }],
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
      }),
    );
  });
});

describe('validateProducerCycles', () => {
  it('detects simple two-node cycle', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
      ],
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
        message: expect.stringMatching(/cycle.*ProducerA.*ProducerB.*ProducerA/i),
      }),
    );
  });

  it('detects multi-node cycle', () => {
    const doc = createDocument({
      producerImports: [
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
      producerImports: [
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
      producerImports: [{ name: 'ProducerA' }],
      edges: [
        { from: 'ProducerA.Output', to: 'ProducerA.Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateProducerCycles(tree);

    // Self-references are filtered out (not considered cycles in this validator)
    expect(issues).toHaveLength(0);
  });

  it('ignores edges from/to inputs and artifacts', () => {
    const doc = createDocument({
      inputs: [{ name: 'Input', type: 'string', required: true }],
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      producerImports: [{ name: 'Producer' }],
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
  it('detects dimension loss without collector', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
      ],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'ProducerA[segment].Output', to: 'ProducerB.Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: ValidationErrorCode.DIMENSION_MISMATCH,
        message: expect.stringContaining('1 dimension'),
      }),
    );
  });

  it('allows cross-dimension patterns (different dimension names)', () => {
    // Cross-dimension patterns like [image] -> [segment] are valid
    // for sliding window and other intentional patterns
    const doc = createDocument({
      producerImports: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
      ],
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
      producerImports: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
      ],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'ProducerA[segment].Output', to: 'ProducerB[segment].Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    expect(issues).toHaveLength(0);
  });

  it('allows dimension loss with matching collector', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
      ],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'ProducerA[segment].Output', to: 'ProducerB.Input' },
      ],
      collectors: [
        { name: 'Collector', from: 'ProducerA[segment].Output', into: 'ProducerB.Input', groupBy: 'segment' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    expect(issues).toHaveLength(0);
  });

  it('reports error when edge has dimension loss but no matching collector', () => {
    // Each producer needs its own collector - just having any collector
    // for the target is not enough
    const doc = createDocument({
      producerImports: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
        { name: 'ProducerC' },
      ],
      loops: [{ name: 'segment', countInput: 'NumOfSegments' }],
      edges: [
        { from: 'ProducerA[segment].Output', to: 'ProducerC.Input' },
        { from: 'ProducerB[segment].Output', to: 'ProducerC.Input' },
      ],
      collectors: [
        // Only ProducerA has a collector, ProducerB is missing one
        { name: 'CollectorA', from: 'ProducerA[segment].Output', into: 'ProducerC.Input', groupBy: 'segment' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    // ProducerB's edge should be flagged as missing a collector
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: ValidationErrorCode.DIMENSION_MISMATCH,
      message: expect.stringContaining('ProducerB'),
    });
  });

  it('ignores numeric indices in dimensions', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
      ],
      edges: [
        { from: 'ProducerA[0].Output', to: 'ProducerB.Input' },
      ],
    });
    const tree = createTreeNode(doc);

    const issues = validateDimensionConsistency(tree);

    // Numeric indices are not loop dimensions
    expect(issues).toHaveLength(0);
  });

  it('ignores offset expressions in dimensions', () => {
    const doc = createDocument({
      producerImports: [
        { name: 'ProducerA' },
        { name: 'ProducerB' },
      ],
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
      artefacts: [{ name: 'Output', type: 'string', required: true }],
      producerImports: [{ name: 'Producer' }],
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
