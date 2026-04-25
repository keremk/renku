import { describe, expect, it } from 'vitest';
import {
  buildBlueprintValidationCases,
  deriveConditionalUpToLayer,
  parseBlueprintValidationScenario,
  runBlueprintDryRunValidation,
  type BlueprintValidationScenarioCase,
} from './blueprint-dry-run-validator.js';
import type { ConditionAnalysis } from '../analysis/condition-analyzer.js';

describe('blueprint dry-run validator', () => {
  it('treats activation-gated jobs as conditional dry-run layers', () => {
    const upToLayer = deriveConditionalUpToLayer({
      revision: 'rev-test',
      baselineHash: 'baseline',
      createdAt: '2026-04-25T00:00:00.000Z',
      blueprintLayerCount: 2,
      layers: [
        [
          {
            jobId: 'Producer:SetupProducer',
            producer: 'SetupProducer',
            inputs: [],
            produces: [],
            provider: 'openai',
            providerModel: 'gpt-4o',
            rateKey: 'openai-gpt4o',
          },
        ],
        [
          {
            jobId: 'Producer:PreviewProducer',
            producer: 'PreviewProducer',
            inputs: [],
            produces: [],
            provider: 'openai',
            providerModel: 'gpt-4o',
            rateKey: 'openai-gpt4o',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'PreviewProducer',
              producerId: 'Producer:PreviewProducer',
              inputs: [],
              produces: [],
              activation: {
                condition: {
                  when: 'Input:UsePreview',
                  is: true,
                },
                indices: {},
                inheritedFrom: [],
              },
            },
          },
        ],
      ],
    });

    expect(upToLayer).toBe(1);
  });

  it('parses YAML scenario documents', () => {
    const parsed = parseBlueprintValidationScenario(
      `version: 1
blueprint: ./scene-character-presence.yaml
inputs: ./input-template.yaml
cases:
  - id: case-1
    conditionHints:
      mode: alternating
      varyingFields:
        - artifactId: Artifact:StoryProducer.Storyboard.Scenes[scene].CharacterPresent[character]
          values: [true, false]
          dimension: scene
`,
      '/tmp/validation-scenarios.yaml'
    );

    expect(parsed.version).toBe(1);
    expect(parsed.blueprint).toBe('./scene-character-presence.yaml');
    expect(parsed.inputs).toBe('./input-template.yaml');
    expect(parsed.cases).toHaveLength(1);
    expect(parsed.cases?.[0]?.conditionHints?.mode).toBe('alternating');
  });

  it('builds deterministic generated cases from varying hints', () => {
    const cases = buildBlueprintValidationCases({
      baseVaryingHints: [
        {
          artifactId:
            'Artifact:StoryProducer.Storyboard.Scenes[scene].CharacterPresent[character]',
          values: [true, false],
          dimension: 'scene',
        },
      ],
      requestedCases: 3,
      requestedSeed: 1,
    });

    expect(cases).toHaveLength(3);
    expect(cases[0]?.conditionHints?.varyingFields[0]?.values).toEqual([
      false,
      true,
    ]);
    expect(cases[1]?.conditionHints?.varyingFields[0]?.values).toEqual([
      true,
      false,
    ]);
    expect(cases[2]?.conditionHints?.varyingFields[0]?.values).toEqual([
      false,
      true,
    ]);
  });

  it('evaluates dual-outcome and dimension variation coverage', async () => {
    const analysis: ConditionAnalysis = {
      conditionFields: [
        {
          artifactId:
            'Artifact:StoryProducer.Storyboard.Scenes[scene].CharacterPresent[character]',
          artifactPath: 'StoryProducer.Storyboard',
          fieldPath: ['Scenes', '[scene]', 'CharacterPresent', '[character]'],
          expectedValues: [true],
          operator: 'is',
          dimensions: ['scene', 'character'],
        },
      ],
      conditionalProducers: ['SceneVideoProducer'],
      namedConditions: [],
    };

    const cases: BlueprintValidationScenarioCase[] = [
      { id: 'case-1' },
      { id: 'case-2' },
    ];

    const scenarioValues: Array<Record<string, string>> = [
      {
        'Artifact:StoryProducer.Storyboard.Scenes[0].CharacterPresent[0]':
          'true',
        'Artifact:StoryProducer.Storyboard.Scenes[0].CharacterPresent[1]':
          'false',
        'Artifact:StoryProducer.Storyboard.Scenes[1].CharacterPresent[0]':
          'false',
        'Artifact:StoryProducer.Storyboard.Scenes[1].CharacterPresent[1]':
          'true',
      },
      {
        'Artifact:StoryProducer.Storyboard.Scenes[0].CharacterPresent[0]':
          'false',
        'Artifact:StoryProducer.Storyboard.Scenes[0].CharacterPresent[1]':
          'true',
        'Artifact:StoryProducer.Storyboard.Scenes[1].CharacterPresent[0]':
          'true',
        'Artifact:StoryProducer.Storyboard.Scenes[1].CharacterPresent[1]':
          'false',
      },
    ];

    const validation = await runBlueprintDryRunValidation({
      conditionAnalysis: analysis,
      cases,
      executeCase: async ({ caseIndex }) => {
        const values = scenarioValues[caseIndex]!;
        return {
          movieId: `movie-${caseIndex + 1}`,
          failedJobs: [],
          artifactIds: Object.keys(values),
          readArtifactText: async (artifactId) => {
            const value = values[artifactId];
            if (value === undefined) {
              throw new Error(`Unknown artifact: ${artifactId}`);
            }
            return value;
          },
        };
      },
    });

    expect(validation.failures).toHaveLength(0);
    expect(validation.passedCases).toBe(2);
    expect(validation.failedCases).toBe(0);
    expect(validation.fieldCoverage).toHaveLength(1);
    expect(validation.fieldCoverage[0]?.trueOutcomeObserved).toBe(true);
    expect(validation.fieldCoverage[0]?.falseOutcomeObserved).toBe(true);
    expect(validation.fieldCoverage[0]?.dimensionVariation).toEqual([
      true,
      true,
    ]);
    expect(validation.producedPaths).toHaveLength(8);
    expect(validation.caseResults[0]?.producedPaths[0]).toEqual(
      expect.objectContaining({
        caseId: 'case-1',
        artifactId:
          'Artifact:StoryProducer.Storyboard.Scenes[0].CharacterPresent[0]',
        path:
          'Artifact:StoryProducer.Storyboard.Scenes[scene].CharacterPresent[character]',
        value: true,
        coordinates: [0, 0],
      })
    );
  });
});
