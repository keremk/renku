import { describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { FileStorage } from '@flystorage/file-storage';
import { LocalStorageAdapter } from '@flystorage/local-fs';
import {
  createFlyStorageBlueprintReader,
  loadYamlBlueprintTree,
  parseYamlBlueprintFile,
} from './yaml-parser.js';
import { getBundledBlueprintsRoot, getBundledCatalogRoot } from '../../../../cli/src/lib/config-assets.js';

const catalogRoot = getBundledCatalogRoot();
const yamlRoot = getBundledBlueprintsRoot();

describe('parseYamlBlueprintFile', () => {
  it('parses module producers and loads prompt/schema files', async () => {
    const modulePath = resolve(catalogRoot, 'producers/script/script.yaml');
    const document = await parseYamlBlueprintFile(modulePath);
    expect(document.meta.id).toBe('ScriptProducer');
    expect(document.producers).toHaveLength(1);
    const producer = document.producers[0];
    expect(producer.model).toBe('gpt-5-mini');
    // LLM producers use outputSchema for structured output, not inputSchema
    expect(producer.models?.[0]?.outputSchema).toContain('"properties"');
    expect(producer.models?.[0]?.variables).toEqual(
      expect.arrayContaining(['InquiryPrompt', 'Duration', 'NumOfSegments', 'Audience', 'Language']),
    );
  });

  it('parses countInputOffset for array artefacts', async () => {
    const modulePath = resolve(catalogRoot, 'producers/flow-video-prompt/flow-video-prompt.yaml');
    const document = await parseYamlBlueprintFile(modulePath);
    const imagePrompts = document.artefacts.find((artefact) => artefact.name === 'ImagePrompts');
    expect(imagePrompts?.countInput).toBe('NumOfSegments');
    expect(imagePrompts?.countInputOffset).toBe(1);
  });

  it('normalizes collector references into canonical edge notation', async () => {
    const blueprintPath = resolve(yamlRoot, 'image-only', 'image-only.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);
    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'ImageProducer[segment][image].SegmentImage',
          to: 'SegmentImage[segment][image]',
        }),
        expect.objectContaining({
          from: 'ScriptProducer.NarrationScript[segment]',
          to: 'ImagePromptProducer[segment].NarrativeText',
        }),
      ]),
    );
    expect(document.producerImports.map((entry) => entry.name)).toEqual([
      'ScriptProducer',
      'ImagePromptProducer',
      'ImageProducer',
    ]);
  });

  it('accepts dimension selectors with offsets', async () => {
    const blueprintPath = resolve(yamlRoot, 'image-to-video', 'image-to-video.yaml');
    const document = await parseYamlBlueprintFile(blueprintPath);
    expect(document.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'ImageProducer[image+1].SegmentImage',
          to: 'ImageToVideoProducer[segment].InputImage2',
        }),
      ]),
    );
  });
});

describe('loadYamlBlueprintTree', () => {
  it('loads entire blueprint hierarchy using FlyStorage reader', async () => {
    const storage = new FileStorage(new LocalStorageAdapter(catalogRoot));
    const reader = createFlyStorageBlueprintReader(storage, catalogRoot);
    const entry = resolve(yamlRoot, 'audio-only', 'audio-only.yaml');
    const { root } = await loadYamlBlueprintTree(entry, { reader });
    expect(root.id).toBe('audio');
    expect([...root.children.keys()]).toEqual(['ScriptProducer', 'AudioProducer']);
    const scriptNode = root.children.get('ScriptProducer');
    expect(scriptNode?.document.producers[0]?.models?.[0]?.model).toBe('gpt-5-mini');
  });
});
