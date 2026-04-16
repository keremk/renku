import { describe, expect, it } from 'vitest';
import {
	buildProducerOptionsFromBlueprint,
	collectVariants,
	type BlueprintTreeNode,
	type ProducerConfig,
	type ModelSelection,
} from '@gorenku/core';

// Helper to create a minimal blueprint tree node
function createBlueprintNode(
	id: string,
	producers: ProducerConfig[],
	namespacePath: string[] = []
): BlueprintTreeNode {
	return {
		id,
		namespacePath,
		document: {
			meta: { id, name: id },
			inputs: [],
			artifacts: [],
			producers,
			producerImports: [],
			edges: [],
		},
		children: new Map(),
		sourcePath: '/test/mock-blueprint.yaml',
	};
}

describe('collectVariants', () => {
	it('returns empty array for producer declarations', () => {
		const producer: ProducerConfig = {
			name: 'ImageProducer',
		};

		const variants = collectVariants(producer);

		expect(variants).toEqual([]);
	});
});

describe('buildProducerOptionsFromBlueprint', () => {
	it('builds options from model selections (SDK mappings from producer YAML)', async () => {
		const blueprint = createBlueprintNode('TestBlueprint', [
			{ name: 'ImageProducer' },
		]);

		// Note: 'inputs' field was removed from ModelSelection - SDK mappings now come from producer YAML
		const selections: ModelSelection[] = [
			{
				producerId: 'ImageProducer',
				provider: 'fal-ai',
				model: 'bytedance/seedream',
				// SDK mappings now come from producer YAML mappings section, not from selection
			},
		];

		const optionsMap = await buildProducerOptionsFromBlueprint(
			blueprint,
			selections,
			true
		);

		const options = optionsMap.get('ImageProducer');
		expect(options).toBeDefined();
		expect(options).toHaveLength(1);
		expect(options![0].provider).toBe('fal-ai');
		expect(options![0].model).toBe('bytedance/seedream');
		// sdkMapping is undefined because the test blueprint doesn't have a mappings section
		// In production, SDK mappings come from producer YAML's mappings section
		expect(options![0].sdkMapping).toBeUndefined();
	});

	it('builds options for LLM producer with inline config (no file loading)', async () => {
		const blueprint = createBlueprintNode('TestBlueprint', [
			{ name: 'ScriptProducer' },
		]);

		// When no baseDir is provided, promptFile/outputSchema paths are stored but not loaded
		// systemPrompt is now folded into config (no longer a top-level ModelSelection field)
		const selections: ModelSelection[] = [
			{
				producerId: 'ScriptProducer',
				provider: 'openai',
				model: 'gpt-5-mini',
				config: {
					systemPrompt: 'You are a script writer.',
				},
			},
		];

		const optionsMap = await buildProducerOptionsFromBlueprint(
			blueprint,
			selections,
			true
		);

		const options = optionsMap.get('ScriptProducer');
		expect(options).toBeDefined();
		expect(options![0].provider).toBe('openai');
		expect(options![0].model).toBe('gpt-5-mini');
		expect(options![0].config).toMatchObject({
			systemPrompt: 'You are a script writer.',
		});
	});

	it('builds options for producer with inline LLM config from selection', async () => {
		const blueprint = createBlueprintNode('TestBlueprint', [
			{ name: 'ChatProducer' },
		]);

		// systemPrompt, userPrompt, variables are now folded into config
		const selections: ModelSelection[] = [
			{
				producerId: 'ChatProducer',
				provider: 'openai',
				model: 'gpt-4o',
				config: {
					systemPrompt: 'You are a helpful assistant.',
					userPrompt: 'Answer: {{question}}',
					variables: ['question'],
				},
			},
		];

		const optionsMap = await buildProducerOptionsFromBlueprint(
			blueprint,
			selections,
			true
		);

		const options = optionsMap.get('ChatProducer');
		expect(options).toBeDefined();
		expect(options![0].config).toMatchObject({
			systemPrompt: 'You are a helpful assistant.',
			userPrompt: 'Answer: {{question}}',
			variables: ['question'],
		});
	});

	it('throws error for producer without selection', async () => {
		const blueprint = createBlueprintNode('TestBlueprint', [
			{ name: 'ImageProducer' },
		]);

		await expect(
			buildProducerOptionsFromBlueprint(blueprint, [], false)
		).rejects.toThrow(/has no model configuration/);
	});

	it('keeps selection config for producer options', async () => {
		const blueprint = createBlueprintNode('TestBlueprint', [
			{ name: 'ConfigProducer' },
		]);

		const selections: ModelSelection[] = [
			{
				producerId: 'ConfigProducer',
				provider: 'openai',
				model: 'gpt-4o',
				config: { temperature: 0.5, max_tokens: 1000 },
			},
		];

		const optionsMap = await buildProducerOptionsFromBlueprint(
			blueprint,
			selections,
			true
		);

		const options = optionsMap.get('ConfigProducer');
		expect(options).toBeDefined();
		expect(options![0].config).toMatchObject({
			temperature: 0.5,
			max_tokens: 1000,
		});
	});
});
