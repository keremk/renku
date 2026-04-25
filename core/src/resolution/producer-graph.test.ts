import { describe, expect, it } from 'vitest';
import { createProducerGraph } from './producer-graph.js';
import type { CanonicalBlueprint } from './canonical-expander.js';
import type { ProducerCatalog, BlueprintProducerSdkMappingField, FanInDescriptor } from '../types.js';

describe('createProducerGraph', () => {
  const defaultCatalog: ProducerCatalog = {
    'TestProducer': {
      provider: 'openai',
      providerModel: 'gpt-4',
      rateKey: 'openai-gpt4',
    },
    'ImageProducer': {
      provider: 'replicate',
      providerModel: 'flux',
      rateKey: 'replicate-flux',
    },
    'ScriptProducer': {
      provider: 'openai',
      providerModel: 'gpt-4o',
      rateKey: 'openai-gpt4o',
    },
    'Namespace.NestedProducer': {
      provider: 'openai',
      providerModel: 'gpt-4',
      rateKey: 'openai-gpt4',
    },
  };

  function createDefaultOptions(
    aliases: string[],
    overrides: Partial<{
      sdkMapping: Record<string, BlueprintProducerSdkMappingField>;
      outputs: Record<string, { type: string }>;
      inputSchema: string;
      outputSchema: string;
      config: Record<string, unknown>;
      selectionInputKeys: string[];
      configInputPaths: string[];
    }> = {},
  ) {
    const options = new Map<string, {
      sdkMapping?: Record<string, BlueprintProducerSdkMappingField>;
      outputs?: Record<string, { type: string }>;
      inputSchema?: string;
      outputSchema?: string;
      config?: Record<string, unknown>;
      selectionInputKeys?: string[];
      configInputPaths?: string[];
    }>();
    for (const alias of aliases) {
      options.set(alias, { ...overrides });
    }
    return options;
  }

  describe('basic graph creation', () => {
    it('creates a graph with a single producer', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Input:Prompt',
            type: 'Input',
            producerAlias: '',
            namespacePath: [],
            name: 'Prompt',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:Output',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'Output',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          { from: 'Input:Prompt', to: 'Producer:TestProducer' },
          { from: 'Producer:TestProducer', to: 'Artifact:Output' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.nodes).toHaveLength(1);
      const node = result.nodes[0]!;
      expect(node.jobId).toBe('Producer:TestProducer');
      expect(node.producer).toBe('TestProducer');
      expect(node.provider).toBe('openai');
      expect(node.providerModel).toBe('gpt-4');
      expect(node.inputs).toContain('Input:Prompt');
      expect(node.produces).toContain('Artifact:Output');
      expect(result.edges).toHaveLength(0); // No producer-to-producer edges
    });

    it('creates edges between producers when one depends on another artifact', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:ScriptProducer',
            type: 'Producer',
            producerAlias: 'ScriptProducer',
            namespacePath: [],
            name: 'ScriptProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Producer:ImageProducer',
            type: 'Producer',
            producerAlias: 'ImageProducer',
            namespacePath: [],
            name: 'ImageProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:Script',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'Script',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:Image',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'Image',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          { from: 'Producer:ScriptProducer', to: 'Artifact:Script' },
          { from: 'Artifact:Script', to: 'Producer:ImageProducer' },
          { from: 'Producer:ImageProducer', to: 'Artifact:Image' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['ScriptProducer', 'ImageProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.nodes).toHaveLength(2);
      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        from: 'Producer:ScriptProducer',
        to: 'Producer:ImageProducer',
      });
    });

    it('handles producers with dimension indices', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer[0]',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: { segment_sym: 0 },
            dimensions: ['segment'],
          },
          {
            id: 'Producer:TestProducer[1]',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: { segment_sym: 1 },
            dimensions: ['segment'],
          },
          {
            id: 'Artifact:Output[0]',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'Output',
            indices: { segment_sym: 0 },
            dimensions: ['segment'],
          },
          {
            id: 'Artifact:Output[1]',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'Output',
            indices: { segment_sym: 1 },
            dimensions: ['segment'],
          },
        ],
        edges: [
          { from: 'Producer:TestProducer[0]', to: 'Artifact:Output[0]' },
          { from: 'Producer:TestProducer[1]', to: 'Artifact:Output[1]' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.nodes).toHaveLength(2);
      expect(result.nodes.map((n) => n.jobId)).toContain('Producer:TestProducer[0]');
      expect(result.nodes.map((n) => n.jobId)).toContain('Producer:TestProducer[1]');
    });
  });

  describe('input bindings', () => {
    it('includes input bindings in producer context', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {
          'Producer:TestProducer': {
            'Prompt': 'Input:Prompt',
            'Context': 'Input:Context',
          },
        },
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.nodes).toHaveLength(1);
      const node = result.nodes[0]!;
      expect(node.context!.inputBindings).toEqual({
        'Prompt': 'Input:Prompt',
        'Context': 'Input:Context',
      });
    });

    it('tracks dependencies from inputBindings with artifact sources', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:ScriptProducer',
            type: 'Producer',
            producerAlias: 'ScriptProducer',
            namespacePath: [],
            name: 'ScriptProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Producer:ImageProducer',
            type: 'Producer',
            producerAlias: 'ImageProducer',
            namespacePath: [],
            name: 'ImageProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:Script',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'Script',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          { from: 'Producer:ScriptProducer', to: 'Artifact:Script' },
        ],
        inputBindings: {
          'Producer:ImageProducer': {
            'ScriptText': 'Artifact:Script',
          },
        },
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['ScriptProducer', 'ImageProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        from: 'Producer:ScriptProducer',
        to: 'Producer:ImageProducer',
      });
      expect(
        result.nodes.find((node) => node.jobId === 'Producer:ImageProducer')?.context
          ?.extras?.inputArtifactSources
      ).toEqual({
        'Artifact:Script': {
          artifactId: 'Artifact:Script',
          upstreamJobId: 'Producer:ScriptProducer',
          upstreamProducerId: 'Producer:ScriptProducer',
          upstreamProducerAlias: 'ScriptProducer',
          provider: 'openai',
          model: 'gpt-4o',
        },
      });
    });

    it('includes element-level bindings for array inputs', () => {
      // Test element-level binding pattern: ReferenceImages[0], ReferenceImages[1]
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:VideoProducer',
            type: 'Producer',
            producerAlias: 'VideoProducer',
            namespacePath: [],
            name: 'VideoProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:CharacterImage.GeneratedImage',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['CharacterImage'],
            name: 'GeneratedImage',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:ProductImage.GeneratedImage',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['ProductImage'],
            name: 'GeneratedImage',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {
          'Producer:VideoProducer': {
            'ReferenceImages[0]': 'Artifact:CharacterImage.GeneratedImage',
            'ReferenceImages[1]': 'Artifact:ProductImage.GeneratedImage',
          },
        },
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const videoCatalog: ProducerCatalog = {
        'VideoProducer': {
          provider: 'fal-ai',
          providerModel: 'video',
          rateKey: 'fal-video',
        },
      };
      const options = createDefaultOptions(['VideoProducer']);
      const result = createProducerGraph(canonical, videoCatalog, options);

      expect(result.nodes).toHaveLength(1);
      const node = result.nodes[0]!;
      // Element-level bindings should be included in context
      expect(node.context!.inputBindings).toEqual({
        'ReferenceImages[0]': 'Artifact:CharacterImage.GeneratedImage',
        'ReferenceImages[1]': 'Artifact:ProductImage.GeneratedImage',
      });
      // Artifact IDs from element-level bindings should be in inputs list
      expect(node.inputs).toContain('Artifact:CharacterImage.GeneratedImage');
      expect(node.inputs).toContain('Artifact:ProductImage.GeneratedImage');
    });

    it('includes whole-array binding for array inputs', () => {
      // Test whole-array binding pattern: ReferenceImages (no index)
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:VideoProducer',
            type: 'Producer',
            producerAlias: 'VideoProducer',
            namespacePath: [],
            name: 'VideoProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:ImageGenerator.AllImages',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['ImageGenerator'],
            name: 'AllImages',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {
          'Producer:VideoProducer': {
            'ReferenceImages': 'Artifact:ImageGenerator.AllImages',
          },
        },
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const videoCatalog: ProducerCatalog = {
        'VideoProducer': {
          provider: 'fal-ai',
          providerModel: 'video',
          rateKey: 'fal-video',
        },
      };
      const options = createDefaultOptions(['VideoProducer']);
      const result = createProducerGraph(canonical, videoCatalog, options);

      expect(result.nodes).toHaveLength(1);
      const node = result.nodes[0]!;
      // Whole-array binding should be included in context
      expect(node.context!.inputBindings).toEqual({
        'ReferenceImages': 'Artifact:ImageGenerator.AllImages',
      });
      // Artifact ID should be in inputs list
      expect(node.inputs).toContain('Artifact:ImageGenerator.AllImages');
    });
  });

  describe('SDK mapping', () => {
    it('uses SDK mapping from options when provided', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
            producer: {
              name: 'TestProducer',
              sdkMapping: { 'messages': { field: 'node.messages' } },
            },
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer'], {
        sdkMapping: { 'prompt': { field: 'option.prompt' } },
      });
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      expect(node.context!.sdkMapping).toEqual({
        'prompt': { field: 'option.prompt' },
      });
    });

    it('falls back to node SDK mapping when options do not provide one', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
            producer: {
              name: 'TestProducer',
              sdkMapping: { 'messages': { field: 'node.messages' } },
            },
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      expect(node.context!.sdkMapping).toEqual({
        'messages': { field: 'node.messages' },
      });
    });
  });

  describe('fan-in arrays', () => {
    it('includes fan-in descriptors for relevant inputs', () => {
      const fanInDescriptor: FanInDescriptor = {
        members: [
          { id: 'Artifact:Script[0]', group: 0, order: 0 },
          { id: 'Artifact:Script[1]', group: 0, order: 1 },
        ],
        groupBy: 'segment',
        orderBy: 'segment',
      };

      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          { from: 'Artifact:Script[0]', to: 'Producer:TestProducer' },
          { from: 'Artifact:Script[1]', to: 'Producer:TestProducer' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {
          'Artifact:Script[0]': fanInDescriptor,
          'Artifact:Script[1]': fanInDescriptor,
        },
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      expect(node.context!.fanIn).toBeDefined();
      expect(Object.keys(node.context!.fanIn ?? {})).toContain('Artifact:Script[0]');
    });
  });

  describe('selection and config inputs', () => {
    it('includes synthetic inputs from selectionInputKeys', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer'], {
        selectionInputKeys: ['provider', 'model'],
      });
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      expect(node.inputs).toContain('Input:TestProducer.provider');
      expect(node.inputs).toContain('Input:TestProducer.model');
    });

    it('includes synthetic inputs from configInputPaths', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer'], {
        configInputPaths: ['temperature', 'maxTokens'],
      });
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      expect(node.inputs).toContain('Input:TestProducer.temperature');
      expect(node.inputs).toContain('Input:TestProducer.maxTokens');
    });
  });

  describe('condition-referenced artifacts', () => {
    it('keeps numeric condition index matches exact and does not match sibling indices', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:ScriptProducer',
            type: 'Producer',
            producerAlias: 'ScriptProducer',
            namespacePath: [],
            name: 'ScriptProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Producer:ImageProducer',
            type: 'Producer',
            producerAlias: 'ImageProducer',
            namespacePath: [],
            name: 'ImageProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Input:ImageProducer.Prompt',
            type: 'Input',
            producerAlias: 'ImageProducer',
            namespacePath: [],
            name: 'Prompt',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:ScriptProducer.Output.Items[0].Enabled',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['ScriptProducer', 'Output'],
            name: 'Items[0].Enabled',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:ScriptProducer.Output.Items[1].Enabled',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['ScriptProducer', 'Output'],
            name: 'Items[1].Enabled',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          { from: 'Producer:ScriptProducer', to: 'Artifact:ScriptProducer.Output.Items[0].Enabled' },
          { from: 'Producer:ScriptProducer', to: 'Artifact:ScriptProducer.Output.Items[1].Enabled' },
          {
            from: 'Input:ImageProducer.Prompt',
            to: 'Producer:ImageProducer',
            conditions: {
              when: 'Artifact:ScriptProducer.Output.Items[0].Enabled',
              is: true,
            },
            indices: {},
          },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['ScriptProducer', 'ImageProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const scriptNode = result.nodes.find((node) => node.jobId === 'Producer:ScriptProducer');
      expect(scriptNode).toBeDefined();
      expect(scriptNode!.produces).toContain('Artifact:ScriptProducer.Output.Items[0].Enabled');
      expect(scriptNode!.produces).not.toContain('Artifact:ScriptProducer.Output.Items[1].Enabled');
    });

    it('treats symbolic condition indices as wildcards across concrete artifact indices', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:ScriptProducer',
            type: 'Producer',
            producerAlias: 'ScriptProducer',
            namespacePath: [],
            name: 'ScriptProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Producer:ImageProducer',
            type: 'Producer',
            producerAlias: 'ImageProducer',
            namespacePath: [],
            name: 'ImageProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Input:ImageProducer.Prompt',
            type: 'Input',
            producerAlias: 'ImageProducer',
            namespacePath: [],
            name: 'Prompt',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:ScriptProducer.Output.Items[0].Enabled',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['ScriptProducer', 'Output'],
            name: 'Items[0].Enabled',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:ScriptProducer.Output.Items[1].Enabled',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['ScriptProducer', 'Output'],
            name: 'Items[1].Enabled',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          { from: 'Producer:ScriptProducer', to: 'Artifact:ScriptProducer.Output.Items[0].Enabled' },
          { from: 'Producer:ScriptProducer', to: 'Artifact:ScriptProducer.Output.Items[1].Enabled' },
          {
            from: 'Input:ImageProducer.Prompt',
            to: 'Producer:ImageProducer',
            conditions: {
              when: 'Artifact:ScriptProducer.Output.Items[item].Enabled',
              is: true,
            },
            indices: {},
          },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['ScriptProducer', 'ImageProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const scriptNode = result.nodes.find((node) => node.jobId === 'Producer:ScriptProducer');
      expect(scriptNode).toBeDefined();
      expect(scriptNode!.produces).toContain('Artifact:ScriptProducer.Output.Items[0].Enabled');
      expect(scriptNode!.produces).toContain('Artifact:ScriptProducer.Output.Items[1].Enabled');
    });
  });

  describe('input conditions', () => {
    it('collects input conditions from edges targeting the producer', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer[0]',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: { segment_sym: 0 },
            dimensions: ['segment'],
          },
          {
            id: 'Input:TestProducer.Prompt[0]',
            type: 'Input',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'Prompt',
            indices: { segment_sym: 0 },
            dimensions: ['segment'],
          },
        ],
        edges: [
          {
            from: 'Input:TestProducer.Prompt[0]',
            to: 'Producer:TestProducer[0]',
            conditions: {
              when: 'Artifact:SomeArtifact[0]',
              is: true,
            },
            indices: { segment_sym: 0 },
          },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      expect(node.context!.inputConditions).toBeDefined();
      expect(node.context!.inputConditions?.['Input:TestProducer.Prompt[0]']).toEqual({
        condition: {
          when: 'Artifact:SomeArtifact[0]',
          is: true,
        },
        indices: { segment_sym: 0 },
      });
    });

    it('collects input conditions from edges targeting indexed InputSource members', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer[0]',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: { segment_sym: 0 },
            dimensions: ['segment'],
          },
          {
            id: 'InputSource:TestProducer.ReferenceImages[0]',
            type: 'InputSource',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'ReferenceImages[0]',
            indices: { segment_sym: 0 },
            dimensions: ['segment'],
          },
        ],
        edges: [
          {
            from: 'Artifact:CharacterImage.GeneratedImage[0]',
            to: 'InputSource:TestProducer.ReferenceImages[0]',
            conditions: {
              when: 'Artifact:StoryPlan.Segments[0].UseReference',
              is: true,
            },
            indices: { segment_sym: 0 },
          },
        ],
        inputBindings: {
          'Producer:TestProducer[0]': {
            'ReferenceImages[0]': 'Artifact:CharacterImage.GeneratedImage[0]',
          },
        },
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      expect(node.context!.inputConditions).toBeDefined();
      expect(
        node.context!.inputConditions?.[
          'Artifact:CharacterImage.GeneratedImage[0]'
        ]
      ).toEqual({
        condition: {
          when: 'Artifact:StoryPlan.Segments[0].UseReference',
          is: true,
        },
        indices: { segment_sym: 0 },
      });
    });
  });

  describe('resolved condition projection', () => {
    it('projects root-input activation metadata from resolved producer activations', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          {
            from: 'Input:Prompt',
            to: 'Producer:TestProducer',
            conditions: {
              when: 'Input:LegacyGate',
              is: true,
            },
            indices: {},
          },
        ],
        inputBindings: {
          'Producer:TestProducer': {
            Prompt: 'Input:Prompt',
          },
        },
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
        resolvedProducerActivations: {
          'Producer:TestProducer': {
            condition: {
              when: 'Input:UsePreview',
              is: true,
            },
            indices: {},
            inheritedFrom: [
              {
                namespacePath: ['PreviewProducer'],
                importName: 'PreviewProducer',
                parentNamespacePath: [],
                sourcePath: '/test/preview.yaml',
                condition: {
                  when: 'Input:UsePreview',
                  is: true,
                },
              },
            ],
          },
        },
        resolvedScalarBindings: {
          'Producer:TestProducer': [],
        },
        resolvedFanInDescriptors: {},
        resolvedOutputRoutes: [],
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.nodes[0]?.context?.activation).toEqual({
        condition: {
          when: 'Input:UsePreview',
          is: true,
        },
        indices: {},
        inheritedFrom: [
          {
            namespacePath: ['PreviewProducer'],
            importName: 'PreviewProducer',
            parentNamespacePath: [],
            sourcePath: '/test/preview.yaml',
            condition: {
              when: 'Input:UsePreview',
              is: true,
            },
          },
        ],
      });
      expect(result.nodes[0]?.context?.inputConditions).toEqual({
        'Input:Prompt': {
          condition: {
            when: 'Input:LegacyGate',
            is: true,
          },
          indices: {},
        },
      });
    });

    it('projects generated-artifact activation metadata through output source resolution', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:ScriptProducer',
            type: 'Producer',
            producerAlias: 'ScriptProducer',
            namespacePath: [],
            name: 'ScriptProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:ScriptProducer.Decision',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['ScriptProducer'],
            name: 'Decision',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          {
            from: 'Producer:ScriptProducer',
            to: 'Artifact:ScriptProducer.Decision',
          },
        ],
        inputBindings: {},
        outputSources: {
          'Output:ScriptProducer.Decision': 'Artifact:ScriptProducer.Decision',
        },
        outputSourceBindings: [],
        fanIn: {},
        resolvedProducerActivations: {
          'Producer:ScriptProducer': {
            indices: {},
            inheritedFrom: [],
          },
          'Producer:TestProducer': {
            condition: {
              when: 'Output:ScriptProducer.Decision',
              is: true,
            },
            indices: {},
            inheritedFrom: [
              {
                namespacePath: ['TestProducer'],
                importName: 'TestProducer',
                parentNamespacePath: [],
                sourcePath: '/test/test-producer.yaml',
                condition: {
                  when: 'Output:ScriptProducer.Decision',
                  is: true,
                },
              },
            ],
          },
        },
        resolvedScalarBindings: {
          'Producer:ScriptProducer': [],
          'Producer:TestProducer': [],
        },
        resolvedFanInDescriptors: {},
        resolvedOutputRoutes: [],
      };

      const options = createDefaultOptions(['ScriptProducer', 'TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);
      const testNode = result.nodes.find(
        (node) => node.jobId === 'Producer:TestProducer'
      );

      expect(testNode?.context?.activation).toMatchObject({
        condition: {
          when: 'Artifact:ScriptProducer.Decision',
          is: true,
        },
        indices: {},
      });
    });

    it('projects loop-indexed activation metadata without deriving it from input conditions', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer[1]',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: { 'Loop::segment': 1 },
            dimensions: ['Loop::segment'],
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
        resolvedProducerActivations: {
          'Producer:TestProducer[1]': {
            condition: {
              when: 'Input:UseSegment[segment]',
              is: true,
            },
            indices: { 'Loop::segment': 1 },
            inheritedFrom: [
              {
                namespacePath: ['SegmentProducer'],
                importName: 'SegmentProducer',
                parentNamespacePath: [],
                sourcePath: '/test/segment-producer.yaml',
                condition: {
                  when: 'Input:UseSegment[segment]',
                  is: true,
                },
              },
            ],
          },
        },
        resolvedScalarBindings: {
          'Producer:TestProducer[1]': [],
        },
        resolvedFanInDescriptors: {},
        resolvedOutputRoutes: [],
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.nodes[0]?.context?.activation).toEqual({
        condition: {
          when: 'Input:UseSegment[segment]',
          is: true,
        },
        indices: { 'Loop::segment': 1 },
        inheritedFrom: [
          {
            namespacePath: ['SegmentProducer'],
            importName: 'SegmentProducer',
            parentNamespacePath: [],
            sourcePath: '/test/segment-producer.yaml',
            condition: {
              when: 'Input:UseSegment[segment]',
              is: true,
            },
          },
        ],
      });
      expect(result.nodes[0]?.context?.inputConditions).toBeUndefined();
    });

    it('reads scalar and fan-in conditions from resolved structures before legacy edge conditions', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          {
            from: 'Input:Prompt',
            to: 'Producer:TestProducer',
            conditions: {
              when: 'Artifact:LegacyScalarGate',
              is: true,
            },
            indices: {},
          },
          {
            from: 'Artifact:Clip',
            to: 'Producer:TestProducer',
            conditions: {
              when: 'Artifact:LegacyFanInGate',
              is: true,
            },
            indices: {},
          },
        ],
        inputBindings: {
          'Producer:TestProducer': {
            Prompt: 'Input:Prompt',
          },
        },
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
        resolvedProducerActivations: {
          'Producer:TestProducer': {
            indices: {},
            inheritedFrom: [],
          },
        },
        resolvedScalarBindings: {
          'Producer:TestProducer': [
            {
              inputId: 'Prompt',
              sourceId: 'Input:Prompt',
              optionalCondition: {
                condition: {
                  when: 'Artifact:ResolvedScalarGate',
                  is: true,
                },
                indices: {},
              },
            },
          ],
        },
        resolvedFanInDescriptors: {
          'Artifact:Clip': {
            groupBy: 'singleton',
            members: [
              {
                id: 'Artifact:Clip',
                group: 0,
                order: 0,
                condition: {
                  condition: {
                    when: 'Artifact:ResolvedFanInGate',
                    is: true,
                  },
                  indices: {},
                },
              },
            ],
          },
        },
        resolvedOutputRoutes: [],
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      expect(node.context!.inputConditions).toEqual({
        'Input:Prompt': {
          condition: {
            when: 'Artifact:ResolvedScalarGate',
            is: true,
          },
          indices: {},
        },
        'Artifact:Clip': {
          condition: {
            when: 'Artifact:ResolvedFanInGate',
            is: true,
          },
          indices: {},
        },
      });
    });

    it('keeps artifacts connected through resolved output routes', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:FinalVideo',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['TestProducer'],
            name: 'FinalVideo',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          { from: 'Producer:TestProducer', to: 'Artifact:FinalVideo' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
        resolvedProducerActivations: {
          'Producer:TestProducer': {
            indices: {},
            inheritedFrom: [],
          },
        },
        resolvedScalarBindings: {
          'Producer:TestProducer': [],
        },
        resolvedFanInDescriptors: {},
        resolvedOutputRoutes: [
          {
            outputId: 'Output:FinalVideo',
            sourceId: 'Artifact:FinalVideo',
          },
        ],
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.nodes[0]?.produces).toContain('Artifact:FinalVideo');
    });
  });

  describe('namespaced producers', () => {
    it('handles producers with namespace paths', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:Namespace.NestedProducer',
            type: 'Producer',
            producerAlias: 'Namespace.NestedProducer',
            namespacePath: ['Namespace'],
            name: 'NestedProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['Namespace.NestedProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.nodes).toHaveLength(1);
      const node = result.nodes[0]!;
      expect(node.jobId).toBe('Producer:Namespace.NestedProducer');
      expect(node.producer).toBe('Namespace.NestedProducer');
      expect(node.context!.namespacePath).toEqual(['Namespace']);
    });

    it('formats producer-scoped inputs with namespace', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:Namespace.NestedProducer',
            type: 'Producer',
            producerAlias: 'Namespace.NestedProducer',
            namespacePath: ['Namespace'],
            name: 'NestedProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['Namespace.NestedProducer'], {
        selectionInputKeys: ['provider'],
      });
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      expect(node.inputs).toContain('Input:Namespace.NestedProducer.provider');
    });
  });

  describe('error handling', () => {
    it('throws when catalog entry is missing for a producer', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:UnknownProducer',
            type: 'Producer',
            producerAlias: 'UnknownProducer',
            namespacePath: [],
            name: 'UnknownProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['UnknownProducer']);

      expect(() => createProducerGraph(canonical, defaultCatalog, options)).toThrow(
        'Missing producer catalog entry for UnknownProducer',
      );
    });

    it('throws when options are missing for a producer', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = new Map<string, Record<string, unknown>>();

      expect(() => createProducerGraph(canonical, defaultCatalog, options)).toThrow(
        'Missing producer option for TestProducer',
      );
    });
  });

  describe('output schemas', () => {
    it('includes input and output schemas in context extras', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:TestProducer',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'TestProducer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer'], {
        inputSchema: '{"type": "object"}',
        outputSchema: '{"type": "string"}',
      });
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const node = result.nodes[0]!;
      const extras = node.context!.extras as { schema?: { input?: string; output?: string } };
      expect(extras?.schema?.input).toBe('{"type": "object"}');
      expect(extras?.schema?.output).toBe('{"type": "string"}');
    });
  });

  describe('artifact filtering', () => {
    it('excludes producer artifacts that have no downstream connections', () => {
      // Producer declares 3 artifacts but only 1 is connected downstream
      // Producer artifacts have non-empty namespace paths (e.g., ['VideoProducer'])
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:VideoProducer',
            type: 'Producer',
            producerAlias: 'VideoProducer',
            namespacePath: [],
            name: 'VideoProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:VideoProducer.GeneratedVideo',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['VideoProducer'],
            name: 'GeneratedVideo',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:VideoProducer.FirstFrame',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['VideoProducer'],
            name: 'FirstFrame',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:VideoProducer.LastFrame',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['VideoProducer'],
            name: 'LastFrame',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Producer:TimelineComposer',
            type: 'Producer',
            producerAlias: 'TimelineComposer',
            namespacePath: [],
            name: 'TimelineComposer',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          // Producer produces all 3 artifacts
          { from: 'Producer:VideoProducer', to: 'Artifact:VideoProducer.GeneratedVideo' },
          { from: 'Producer:VideoProducer', to: 'Artifact:VideoProducer.FirstFrame' },
          { from: 'Producer:VideoProducer', to: 'Artifact:VideoProducer.LastFrame' },
          // But only GeneratedVideo is connected downstream
          { from: 'Artifact:VideoProducer.GeneratedVideo', to: 'Producer:TimelineComposer' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const videoCatalog: ProducerCatalog = {
        'VideoProducer': {
          provider: 'fal-ai',
          providerModel: 'video',
          rateKey: 'fal-video',
        },
        'TimelineComposer': {
          provider: 'local',
          providerModel: 'timeline',
          rateKey: 'local-timeline',
        },
      };

      const options = createDefaultOptions(['VideoProducer', 'TimelineComposer']);
      const result = createProducerGraph(canonical, videoCatalog, options);

      const videoProducer = result.nodes.find((n) => n.jobId === 'Producer:VideoProducer')!;
      // Only GeneratedVideo should be in produces (connected downstream)
      expect(videoProducer.produces).toContain('Artifact:VideoProducer.GeneratedVideo');
      // FirstFrame and LastFrame are NOT connected downstream, so excluded
      expect(videoProducer.produces).not.toContain('Artifact:VideoProducer.FirstFrame');
      expect(videoProducer.produces).not.toContain('Artifact:VideoProducer.LastFrame');
    });

    it('keeps base JSON artifacts when a whole-object output connector feeds another producer', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:SourceDirector',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'SourceDirector',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:SourceDirector.AssetPlan',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['SourceDirector'],
            name: 'AssetPlan',
            indices: {},
            dimensions: [],
            artifact: {
              name: 'AssetPlan',
              type: 'json',
              arrays: [{ path: 'Segments', countInput: 'NumOfSegments' }],
            },
          },
          {
            id: 'Output:SourceDirector.AssetPlan',
            type: 'Output',
            producerAlias: '',
            namespacePath: ['SourceDirector'],
            name: 'AssetPlan',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Producer:DownstreamDirector',
            type: 'Producer',
            producerAlias: 'ScriptProducer',
            namespacePath: [],
            name: 'DownstreamDirector',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          { from: 'Producer:SourceDirector', to: 'Artifact:SourceDirector.AssetPlan' },
          { from: 'Output:SourceDirector.AssetPlan', to: 'Producer:DownstreamDirector' },
        ],
        inputBindings: {
          'Producer:DownstreamDirector': {
            AssetPlan: 'Artifact:SourceDirector.AssetPlan',
          },
        },
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer', 'ScriptProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const sourceProducer = result.nodes.find(
        (node) => node.jobId === 'Producer:SourceDirector'
      )!;
      const downstreamProducer = result.nodes.find(
        (node) => node.jobId === 'Producer:DownstreamDirector'
      )!;
      const extras = sourceProducer.context!.extras as {
        outputDefinitions?: Record<
          string,
          { arrays?: Array<{ path: string; countInput: string }> }
        >;
      };

      expect(sourceProducer.produces).toContain('Artifact:SourceDirector.AssetPlan');
      expect(extras.outputDefinitions?.AssetPlan?.arrays).toEqual([
        { path: 'Segments', countInput: 'NumOfSegments' },
      ]);
      expect(downstreamProducer.context?.inputBindings).toEqual({
        AssetPlan: 'Artifact:SourceDirector.AssetPlan',
      });
    });

    it('includes artifacts connected via chain to another producer', () => {
      // VideoProducer[0] -> LastFrame[0] -> VideoProducer[1]
      // Producer artifacts have non-empty namespace paths
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:VideoProducer[0]',
            type: 'Producer',
            producerAlias: 'VideoProducer',
            namespacePath: [],
            name: 'VideoProducer',
            indices: { segment: 0 },
            dimensions: ['segment'],
          },
          {
            id: 'Producer:VideoProducer[1]',
            type: 'Producer',
            producerAlias: 'VideoProducer',
            namespacePath: [],
            name: 'VideoProducer',
            indices: { segment: 1 },
            dimensions: ['segment'],
          },
          {
            id: 'Artifact:VideoProducer.GeneratedVideo[0]',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['VideoProducer'],
            name: 'GeneratedVideo',
            indices: { segment: 0 },
            dimensions: ['segment'],
          },
          {
            id: 'Artifact:VideoProducer.LastFrame[0]',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['VideoProducer'],
            name: 'LastFrame',
            indices: { segment: 0 },
            dimensions: ['segment'],
          },
          {
            id: 'Artifact:VideoProducer.AudioTrack[0]',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['VideoProducer'],
            name: 'AudioTrack',
            indices: { segment: 0 },
            dimensions: ['segment'],
          },
        ],
        edges: [
          // VideoProducer[0] produces 3 artifacts
          { from: 'Producer:VideoProducer[0]', to: 'Artifact:VideoProducer.GeneratedVideo[0]' },
          { from: 'Producer:VideoProducer[0]', to: 'Artifact:VideoProducer.LastFrame[0]' },
          { from: 'Producer:VideoProducer[0]', to: 'Artifact:VideoProducer.AudioTrack[0]' },
          // LastFrame[0] is used by VideoProducer[1]
          { from: 'Artifact:VideoProducer.LastFrame[0]', to: 'Producer:VideoProducer[1]' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const videoCatalog: ProducerCatalog = {
        'VideoProducer': {
          provider: 'fal-ai',
          providerModel: 'video',
          rateKey: 'fal-video',
        },
      };

      const options = createDefaultOptions(['VideoProducer']);
      const result = createProducerGraph(canonical, videoCatalog, options);

      const videoProducer0 = result.nodes.find((n) => n.jobId === 'Producer:VideoProducer[0]')!;
      // LastFrame[0] IS connected downstream (to VideoProducer[1])
      expect(videoProducer0.produces).toContain('Artifact:VideoProducer.LastFrame[0]');
      // GeneratedVideo[0] and AudioTrack[0] are NOT connected downstream
      expect(videoProducer0.produces).not.toContain('Artifact:VideoProducer.GeneratedVideo[0]');
      expect(videoProducer0.produces).not.toContain('Artifact:VideoProducer.AudioTrack[0]');
    });

    it('includes artifacts that chain to blueprint-level artifacts', () => {
      // VideoProducer -> GeneratedVideo -> SegmentVideo (blueprint artifact)
      // Producer artifacts have non-empty namespace, blueprint artifacts have empty namespace
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:VideoProducer',
            type: 'Producer',
            producerAlias: 'VideoProducer',
            namespacePath: [],
            name: 'VideoProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:VideoProducer.GeneratedVideo',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['VideoProducer'],
            name: 'GeneratedVideo',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:VideoProducer.FirstFrame',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['VideoProducer'],
            name: 'FirstFrame',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:SegmentVideo',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'SegmentVideo',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          // Producer produces 2 artifacts (namespaced under VideoProducer)
          { from: 'Producer:VideoProducer', to: 'Artifact:VideoProducer.GeneratedVideo' },
          { from: 'Producer:VideoProducer', to: 'Artifact:VideoProducer.FirstFrame' },
          // GeneratedVideo chains to blueprint artifact SegmentVideo
          { from: 'Artifact:VideoProducer.GeneratedVideo', to: 'Artifact:SegmentVideo' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const videoCatalog: ProducerCatalog = {
        'VideoProducer': {
          provider: 'fal-ai',
          providerModel: 'video',
          rateKey: 'fal-video',
        },
      };

      const options = createDefaultOptions(['VideoProducer']);
      const result = createProducerGraph(canonical, videoCatalog, options);

      const videoProducer = result.nodes.find((n) => n.jobId === 'Producer:VideoProducer')!;
      // GeneratedVideo is connected (chains to SegmentVideo)
      expect(videoProducer.produces).toContain('Artifact:VideoProducer.GeneratedVideo');
      // Only the real runtime artifact stays on the job contract.
      expect(videoProducer.context?.produces).toEqual([
        'Artifact:VideoProducer.GeneratedVideo',
      ]);
      // FirstFrame has no downstream connection
      expect(videoProducer.produces).not.toContain('Artifact:VideoProducer.FirstFrame');
    });

    it('does not treat imported producer-local output connectors as downstream usage', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:CartoonDirector',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'CartoonDirector',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Producer:StoryboardImageProducer',
            type: 'Producer',
            producerAlias: 'ImageProducer',
            namespacePath: [],
            name: 'StoryboardImageProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:CartoonDirector.Episode.Characters[0].Name',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['CartoonDirector', 'Episode', 'Characters'],
            name: 'Name',
            indices: { character: 0 },
            dimensions: ['character'],
          },
          {
            id: 'Artifact:CartoonDirector.Episode.Characters[0].ImagePrompt',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['CartoonDirector', 'Episode', 'Characters'],
            name: 'ImagePrompt',
            indices: { character: 0 },
            dimensions: ['character'],
          },
        ],
        edges: [
          {
            from: 'Producer:CartoonDirector',
            to: 'Artifact:CartoonDirector.Episode.Characters[0].Name',
          },
          {
            from: 'Producer:CartoonDirector',
            to: 'Artifact:CartoonDirector.Episode.Characters[0].ImagePrompt',
          },
          {
            from: 'Artifact:CartoonDirector.Episode.Characters[0].ImagePrompt',
            to: 'Producer:StoryboardImageProducer',
          },
        ],
        inputBindings: {},
        outputSources: {
          'Output:CartoonDirector.Episode.Characters[0].Name':
            'Artifact:CartoonDirector.Episode.Characters[0].Name',
          'Output:CartoonDirector.Episode.Characters[0].ImagePrompt':
            'Artifact:CartoonDirector.Episode.Characters[0].ImagePrompt',
        },
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer', 'ImageProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const director = result.nodes.find(
        (node) => node.jobId === 'Producer:CartoonDirector'
      )!;
      expect(director.produces).toContain(
        'Artifact:CartoonDirector.Episode.Characters[0].ImagePrompt'
      );
      expect(director.produces).not.toContain(
        'Artifact:CartoonDirector.Episode.Characters[0].Name'
      );
    });

    it('treats top-level blueprint outputs as downstream usage', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:AudioProducer[0]',
            type: 'Producer',
            producerAlias: 'TestProducer',
            namespacePath: [],
            name: 'AudioProducer',
            indices: { segment: 0 },
            dimensions: ['segment'],
          },
          {
            id: 'Artifact:AudioProducer.GeneratedAudio[0]',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: ['AudioProducer'],
            name: 'GeneratedAudio',
            indices: { segment: 0 },
            dimensions: ['segment'],
          },
        ],
        edges: [
          {
            from: 'Producer:AudioProducer[0]',
            to: 'Artifact:AudioProducer.GeneratedAudio[0]',
          },
        ],
        inputBindings: {},
        outputSources: {
          'Output:SegmentAudio[0]': 'Artifact:AudioProducer.GeneratedAudio[0]',
        },
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['TestProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      const audioProducer = result.nodes.find(
        (node) => node.jobId === 'Producer:AudioProducer[0]'
      )!;
      expect(audioProducer.produces).toContain(
        'Artifact:AudioProducer.GeneratedAudio[0]'
      );
    });

    it('includes root-level artifacts even without downstream connections', () => {
      // Simple case: producer output IS the blueprint artifact (no chaining needed)
      // Root-level artifacts (empty namespace) are always included as they're final outputs
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:SimpleProducer',
            type: 'Producer',
            producerAlias: 'SimpleProducer',
            namespacePath: [],
            name: 'SimpleProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:Output',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'Output',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          // Producer outputs directly to blueprint artifact
          { from: 'Producer:SimpleProducer', to: 'Artifact:Output' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const simpleCatalog: ProducerCatalog = {
        'SimpleProducer': {
          provider: 'openai',
          providerModel: 'gpt-4',
          rateKey: 'openai-gpt4',
        },
      };

      const options = createDefaultOptions(['SimpleProducer']);
      const result = createProducerGraph(canonical, simpleCatalog, options);

      const producer = result.nodes.find((n) => n.jobId === 'Producer:SimpleProducer')!;
      // Root-level artifact is always included (it's a final blueprint output)
      expect(producer.produces).toContain('Artifact:Output');
    });
  });

  describe('edge deduplication', () => {
    it('does not create duplicate edges between the same producers', () => {
      const canonical: CanonicalBlueprint = {
        nodes: [
          {
            id: 'Producer:ScriptProducer',
            type: 'Producer',
            producerAlias: 'ScriptProducer',
            namespacePath: [],
            name: 'ScriptProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Producer:ImageProducer',
            type: 'Producer',
            producerAlias: 'ImageProducer',
            namespacePath: [],
            name: 'ImageProducer',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:Script1',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'Script1',
            indices: {},
            dimensions: [],
          },
          {
            id: 'Artifact:Script2',
            type: 'Artifact',
            producerAlias: '',
            namespacePath: [],
            name: 'Script2',
            indices: {},
            dimensions: [],
          },
        ],
        edges: [
          { from: 'Producer:ScriptProducer', to: 'Artifact:Script1' },
          { from: 'Producer:ScriptProducer', to: 'Artifact:Script2' },
          { from: 'Artifact:Script1', to: 'Producer:ImageProducer' },
          { from: 'Artifact:Script2', to: 'Producer:ImageProducer' },
        ],
        inputBindings: {},
        outputSources: {},
        outputSourceBindings: [],
        fanIn: {},
      };

      const options = createDefaultOptions(['ScriptProducer', 'ImageProducer']);
      const result = createProducerGraph(canonical, defaultCatalog, options);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        from: 'Producer:ScriptProducer',
        to: 'Producer:ImageProducer',
      });
    });
  });
});
