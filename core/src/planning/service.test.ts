import { beforeEach, describe, expect, it } from 'vitest';
import {
  createPlanningService,
  type PendingArtifactDraft,
  type ProviderOptionEntry,
} from '../orchestration/planning-service.js';
import { createStorageContext, initializeMovieStorage, planStore } from '../storage.js';
import { createBuildStateService } from '../build-state.js';
import { createEventLog } from '../event-log.js';
import type { BlueprintTreeNode, ProducerCatalog } from '../types.js';

function buildTestBlueprint(): BlueprintTreeNode {
  return {
    id: 'root',
    namespacePath: [],
    document: {
      meta: {
        id: 'ScriptProducer',
        name: 'Test Blueprint',
        kind: 'producer',
      },
      inputs: [
        { name: 'InquiryPrompt', type: 'string', required: true },
        { name: 'NumOfSegments', type: 'int', required: true },
      ],
      outputs: [
        { name: 'NarrationScript', type: 'string', required: true },
      ],
      producers: [
        { name: 'ScriptProducer', provider: 'openai', model: 'gpt-4o-mini' },
      ],
      imports: [],
      edges: [],
    },
    children: new Map(),
    sourcePath: '/test/mock-blueprint.yaml',
  };
}

function buildCatalog(): ProducerCatalog {
  const catalog: ProducerCatalog = {
    ScriptProducer: {
      provider: 'openai',
      providerModel: 'gpt-4o-mini',
      rateKey: 'openai:gpt-4o-mini',
    },
  };
  return catalog;
}

function buildProviderOptions(): Map<string, ProviderOptionEntry> {
  const entry: ProviderOptionEntry = {
    sdkMapping: {
      InquiryPrompt: { field: 'prompt' },
      NumOfSegments: { field: 'segments' },
    },
    outputs: {
      NarrationScript: { type: 'text/plain', mimeType: 'text/plain' },
    },
    inputSchema: 'schema://inputs',
    config: {},
    selectionInputKeys: ['provider', 'model'],
    configInputPaths: [],
  };
  return new Map([['ScriptProducer', entry]]);
}

describe('planning service', () => {
  const movieId = 'movie-demo';
  let storage = createStorageContext({ kind: 'memory' });
  let blueprint = buildTestBlueprint();
  let catalog = buildCatalog();

  beforeEach(async () => {
    storage = createStorageContext({ kind: 'memory' });
    blueprint = buildTestBlueprint();
    catalog = buildCatalog();
    await initializeMovieStorage(storage, movieId);
  });

  it('generates a plan and persists it to storage', async () => {
    const buildStateService = createBuildStateService(storage);
    const eventLog = createEventLog(storage);
    const planningService = createPlanningService();

    const result = await planningService.generatePlan({
      movieId,
      blueprintTree: blueprint,
      inputValues: {
        'Input:InquiryPrompt': 'Tell me a story',
        'Input:NumOfSegments': 1,
      },
      providerCatalog: catalog,
      providerOptions: buildProviderOptions(),
      storage,
      buildStateService,
      eventLog,
    });

    expect(result.plan.layers.length).toBeGreaterThan(0);
    expect(result.planPath).toBe(
      storage.resolve(movieId, 'runs', `${result.targetRevision}-plan.json`),
    );
    expect(result.resolvedInputs['Input:InquiryPrompt']).toBe('Tell me a story');
    expect(result.buildState.revision).toBe('rev-0000');

    const stored = await planStore.load(movieId, result.targetRevision, storage);
    expect(stored).not.toBeNull();
  });

  it('records pending artifact drafts in the event log', async () => {
    const buildStateService = createBuildStateService(storage);
    const eventLog = createEventLog(storage);
    const planningService = createPlanningService();

    const pending: PendingArtifactDraft[] = [
      {
        artifactId: 'Artifact:NarrationScript',
        producedBy: 'manual-edit',
        output: {
          blob: {
            hash: 'patched-value-hash',
            size: 'patched value'.length,
            mimeType: 'text/plain',
          },
        },
        diagnostics: { source: 'test' },
      },
    ];

    await planningService.generatePlan({
      movieId,
      blueprintTree: blueprint,
      inputValues: {
        'Input:InquiryPrompt': 'Hello',
        'Input:NumOfSegments': 1,
      },
      providerCatalog: catalog,
      providerOptions: buildProviderOptions(),
      storage,
      buildStateService,
      eventLog,
      pendingArtifacts: pending,
    });

    const artifactEvents = [];
    for await (const event of eventLog.streamArtifacts(movieId)) {
      artifactEvents.push(event);
    }
    expect(artifactEvents).toHaveLength(1);
    expect(artifactEvents[0]?.artifactId).toBe('Artifact:NarrationScript');
    expect(artifactEvents[0]?.producedBy).toBe('manual-edit');
  });

});
