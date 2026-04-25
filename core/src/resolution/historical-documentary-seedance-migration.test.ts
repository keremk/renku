import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBuildStateService } from '../build-state.js';
import { createEventLog } from '../event-log.js';
import {
  createPlanningService,
  type GeneratePlanResult,
  type ProviderOptionEntry,
} from '../orchestration/planning-service.js';
import { loadYamlBlueprintTree } from '../parsing/blueprint-loader/yaml-parser.js';
import {
  createStorageContext,
  initializeMovieStorage,
} from '../storage.js';
import type { ProducerCatalog } from '../types.js';
import { validatePreparedBlueprintTree } from '../validation/prepared-blueprint-validator.js';
import { CATALOG_ROOT } from '../../tests/catalog-paths.js';
import {
  expandBlueprintResolutionContext,
  loadBlueprintResolutionContext,
  normalizeBlueprintResolutionInputs,
} from './blueprint-resolution-context.js';

const HISTORICAL_SEEDANCE_BLUEPRINT_PATH = join(
  CATALOG_ROOT,
  'blueprints',
  'historical-documentary-assets-seedance',
  'historical-documentary-assets-seedance.yaml'
);

describe('Historical documentary Seedance condition migration', () => {
  it('passes strict activation validation', async () => {
    const { root } = await loadYamlBlueprintTree(
      HISTORICAL_SEEDANCE_BLUEPRINT_PATH,
      { catalogRoot: CATALOG_ROOT }
    );

    const result = await validatePreparedBlueprintTree({
      root,
      schemaSource: { kind: 'producer-metadata' },
      options: {
        errorsOnly: true,
        strictResolvedConditions: true,
        resolvedInputValues: historicalSeedanceInputs(),
      },
    });

    expect(result.validation.valid).toBe(true);
    expect(result.validation.errors).toHaveLength(0);
  });

  it('plans optional branches as activation-gated jobs without conditional required scalar bindings', async () => {
    const { result } = await createHistoricalSeedancePlan();
    const aliases = scheduledProducerAliases(result);

    expect(aliases).toEqual(
      expect.arrayContaining([
        'SegmentPlainImageProducer',
        'HistoricalReferenceStillPromptProducer',
        'SegmentReferenceImageProducer',
        'MapImageProducer',
        'ExpertTalkingHeadAudioProducer',
        'ExpertTalkingHeadVideoProducer',
      ])
    );
    expect(aliases.some((alias) => alias.endsWith('TextPromptCompiler'))).toBe(
      true
    );
    expect(
      aliases.some((alias) => alias.endsWith('ReferencePromptCompiler'))
    ).toBe(true);
    expect(
      aliases.some((alias) => alias.endsWith('StartEndPromptCompiler'))
    ).toBe(true);
    expect(
      aliases.some((alias) => alias.endsWith('MultiShotPromptCompiler'))
    ).toBe(true);

    expectActivatedJob(result, 'SegmentPlainImageProducer');
    expectActivatedJob(result, 'HistoricalReferenceStillPromptProducer');
    expectActivatedJob(result, 'SegmentReferenceImageProducer');
    expectActivatedJob(result, 'MapImageProducer');
    expectActivatedJob(result, 'ExpertTalkingHeadAudioProducer');
    expectActivatedJob(result, 'ExpertTalkingHeadVideoProducer');
    expectActivatedJobWithPrefix(result, 'SeedanceVideoGenerator.');
    expectScheduledJobsDoNotUseConditionalInputBindings(result);
  });

  it('allows stage-limited planning before activation-gated later jobs', async () => {
    const { result } = await createHistoricalSeedancePlan({ upToLayer: 0 });
    const aliases = scheduledProducerAliases(result);

    expect(aliases).toEqual([
      'ExpertCastingDirector',
      'HistoricalCharacterDirector',
    ]);
  });

  it('uses motionEnabled as the Seedance wrapper import activation', async () => {
    const { root } = await loadYamlBlueprintTree(
      HISTORICAL_SEEDANCE_BLUEPRINT_PATH,
      { catalogRoot: CATALOG_ROOT }
    );
    const seedanceImport = root.document.imports.find(
      (entry) => entry.name === 'SeedanceVideoGenerator'
    );

    expect(seedanceImport?.if).toBe('motionEnabled');
  });

  it('uses the plain-anchor StartEnd condition for Seedance anchor inputs', async () => {
    const { root } = await loadYamlBlueprintTree(
      HISTORICAL_SEEDANCE_BLUEPRINT_PATH,
      { catalogRoot: CATALOG_ROOT }
    );
    const startImageEdge = root.document.edges.find(
      (edge) => edge.to === 'SeedanceVideoGenerator[segment].StartImage'
    );
    const endImageEdge = root.document.edges.find(
      (edge) => edge.to === 'SeedanceVideoGenerator[segment].EndImage'
    );

    expect(startImageEdge?.if).toBe('motionIsStartEndWithPlainAnchors');
    expect(endImageEdge?.if).toBe('motionIsStartEndWithPlainAnchors');
  });
});

async function createHistoricalSeedancePlan(args: { upToLayer?: number } = {}) {
  const context = await loadBlueprintResolutionContext({
    blueprintPath: HISTORICAL_SEEDANCE_BLUEPRINT_PATH,
    catalogRoot: CATALOG_ROOT,
    schemaSource: { kind: 'producer-metadata' },
  });
  const inputValues = historicalSeedanceInputs();
  const canonicalInputs = normalizeBlueprintResolutionInputs(
    context,
    inputValues,
    { requireCanonicalIds: true }
  );
  const canonical = expandBlueprintResolutionContext(
    context,
    canonicalInputs
  ).canonical;
  const providerOptions = createHistoricalProviderOptions(canonical);
  const providerCatalog = createHistoricalProviderCatalog(canonical);
  const storage = createStorageContext({ kind: 'memory' });
  const movieId = 'historical-seedance-migration';
  await initializeMovieStorage(storage, movieId);

  const service = createPlanningService();
  const result = await service.generatePlan({
    movieId,
    blueprintTree: context.root,
    inputValues,
    providerCatalog,
    providerOptions,
    resolutionContext: context,
    storage,
    buildStateService: createBuildStateService(storage),
    eventLog: createEventLog(storage),
    ...(args.upToLayer === undefined
      ? {}
      : {
          userControls: {
            scope: {
              upToLayer: args.upToLayer,
            },
          },
        }),
  });

  return { canonical, result };
}

function historicalSeedanceInputs(): Record<string, unknown> {
  return {
    'Input:InquiryPrompt':
      'How did artisans and engineers shape public life in ancient cities?',
    'Input:Duration': 20,
    'Input:NumOfSegments': 2,
    'Input:NumOfImagesPerSegment': 2,
    'Input:NumOfExperts': 1,
    'Input:NumOfHistoricalCharacters': 1,
    'Input:Style':
      'Measured historical documentary with cinematic but realistic visuals.',
    'Input:Audience': 'Curious adults who enjoy context-rich history.',
    'Input:LanguageCode': 'en',
    'Input:Resolution': { width: 1280, height: 720 },
    'Input:ExpertEnvironment':
      'A quiet archive reading room with maps, documents, and warm practical lighting.',
  };
}

function scheduledProducerAliases(result: GeneratePlanResult): string[] {
  return result.plan.layers
    .flat()
    .map((job) => job.producer)
    .sort();
}

function expectActivatedJob(
  result: GeneratePlanResult,
  producerAlias: string
): void {
  const job = result.plan.layers
    .flat()
    .find((candidate) => candidate.producer === producerAlias);
  expect(job?.context?.activation?.condition).toBeDefined();
}

function expectActivatedJobWithPrefix(
  result: GeneratePlanResult,
  producerAliasPrefix: string
): void {
  const job = result.plan.layers
    .flat()
    .find((candidate) => candidate.producer.startsWith(producerAliasPrefix));
  expect(job?.context?.activation?.condition).toBeDefined();
}

function expectScheduledJobsDoNotUseConditionalInputBindings(
  result: GeneratePlanResult
): void {
  for (const job of result.plan.layers.flat()) {
    expect(job.context?.conditionalInputBindings).toBeUndefined();
  }
}

function createHistoricalProviderOptions(
  canonical: ReturnType<typeof expandBlueprintResolutionContext>['canonical']
): Map<string, ProviderOptionEntry> {
  return new Map(
    canonical.nodes
      .filter((node) => node.type === 'Producer')
      .map((node) => [
        node.producerAlias,
        {
          sdkMapping: node.producer?.sdkMapping as
            | ProviderOptionEntry['sdkMapping']
            | undefined,
          outputs: node.producer?.outputs as
            | ProviderOptionEntry['outputs']
            | undefined,
          selectionInputKeys: [],
          configInputPaths: [],
        },
      ])
  );
}

function createHistoricalProviderCatalog(
  canonical: ReturnType<typeof expandBlueprintResolutionContext>['canonical']
): ProducerCatalog {
  return Object.fromEntries(
    canonical.nodes
      .filter((node) => node.type === 'Producer')
      .map((node) => [
        node.producerAlias,
        {
          provider: 'fal-ai',
          providerModel: 'historical-seedance-migration-test',
          rateKey: `historical-seedance:${node.producerAlias}`,
        },
      ])
  );
}
