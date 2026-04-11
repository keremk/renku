import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TEST_FIXTURES_ROOT } from '../../tests/catalog-paths.js';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/yaml-parser.js';
import {
  expandBlueprintResolutionContext,
  normalizeBlueprintResolutionInputs,
  prepareBlueprintResolutionContext,
} from './blueprint-resolution-context.js';

const DOCUMENTARY_BLUEPRINT_PATH = resolve(
  TEST_FIXTURES_ROOT,
  '_shared',
  'documentary',
  'documentary.yaml'
);

const DOCUMENTARY_OUTPUT_SCHEMA_PATH = resolve(
  TEST_FIXTURES_ROOT,
  '_shared',
  'documentary',
  'documentary-output.json'
);

const SCRIPT_BLUEPRINT_PATH = resolve(
  TEST_FIXTURES_ROOT,
  '_shared',
  'script',
  'script.yaml'
);

describe('blueprint resolution context', () => {
  it('prepares a cloned metadata-backed tree without mutating the raw blueprint', async () => {
    const { root } = await loadYamlBlueprintTree(DOCUMENTARY_BLUEPRINT_PATH);

    expect(root.document.artefacts[0]?.schema).toBeUndefined();
    expect(
      root.document.edges.some(
        (edge) =>
          edge.to === 'VideoScript.Segments[segment].NarrationType'
      )
    ).toBe(false);

    const context = await prepareBlueprintResolutionContext({
      root,
      schemaSource: { kind: 'producer-metadata' },
    });

    expect(context.root).not.toBe(root);
    expect(context.root.document.artefacts[0]?.schema).toBeDefined();
    expect(
      context.root.document.edges.some(
        (edge) =>
          edge.to === 'VideoScript.Segments[segment].NarrationType'
      )
    ).toBe(true);
    expect(root.document.artefacts[0]?.schema).toBeUndefined();
    expect(
      root.document.edges.some(
        (edge) =>
          edge.to === 'VideoScript.Segments[segment].NarrationType'
      )
    ).toBe(false);
  });

  it('builds the same graph shape from producer metadata and provider options', async () => {
    const metadataTree = await loadYamlBlueprintTree(DOCUMENTARY_BLUEPRINT_PATH);
    const providerOptionsTree = await loadYamlBlueprintTree(
      DOCUMENTARY_BLUEPRINT_PATH
    );
    const outputSchema = await readFile(DOCUMENTARY_OUTPUT_SCHEMA_PATH, 'utf8');

    const metadataContext = await prepareBlueprintResolutionContext({
      root: metadataTree.root,
      schemaSource: { kind: 'producer-metadata' },
    });
    const providerOptionsContext = await prepareBlueprintResolutionContext({
      root: providerOptionsTree.root,
      schemaSource: {
        kind: 'provider-options',
        providerOptions: new Map([
          [
            'DocumentaryPromptProducer',
            {
              outputSchema,
            },
          ],
        ]),
      },
    });

    expect(
      metadataContext.graph.nodes.map((node) => node.id).sort()
    ).toEqual(providerOptionsContext.graph.nodes.map((node) => node.id).sort());
    expect(
      metadataContext.graph.edges
        .map((edge) => `${edge.from.nodeId}->${edge.to.nodeId}`)
        .sort()
    ).toEqual(
      providerOptionsContext.graph.edges
        .map((edge) => `${edge.from.nodeId}->${edge.to.nodeId}`)
        .sort()
    );
  });

  it('normalizes authored input keys and expands against canonical ids', async () => {
    const { root } = await loadYamlBlueprintTree(SCRIPT_BLUEPRINT_PATH);
    const context = await prepareBlueprintResolutionContext({
      root,
      schemaSource: { kind: 'producer-metadata' },
    });

    const normalizedInputs = normalizeBlueprintResolutionInputs(context, {
      InquiryPrompt: 'Industrial history',
      Duration: 60,
      NumOfSegments: 2,
      Audience: 'general',
      Language: 'en',
    });
    const expanded = expandBlueprintResolutionContext(context, normalizedInputs);

    expect(normalizedInputs).toMatchObject({
      'Input:InquiryPrompt': 'Industrial history',
      'Input:Duration': 60,
      'Input:NumOfSegments': 2,
      'Input:Audience': 'general',
      'Input:Language': 'en',
    });
    expect(
      expanded.canonical.nodes.some(
        (node) => node.id === 'Artifact:NarrationScript[0]'
      )
    ).toBe(true);
    expect(
      expanded.canonical.nodes.some(
        (node) => node.id === 'Artifact:NarrationScript[1]'
      )
    ).toBe(true);
  });
});
