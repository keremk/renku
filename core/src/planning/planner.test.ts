import { describe, expect, it } from 'vitest';
import { createPlanner, computeArtifactRegenerationJobs, computeMultipleArtifactRegenerationJobs } from './planner.js';
import { createEventLog } from '../event-log.js';
import { createStorageContext, initializeMovieStorage } from '../storage.js';
import { createManifestService, ManifestNotFoundError } from '../manifest.js';
import { hashArtefactOutput, hashPayload } from '../hashing.js';
import { nextRevisionId } from '../revisions.js';
import { computeTopologyLayers } from '../topology/index.js';
import type {
  InputEvent,
  Manifest,
  ProducerGraph,
  ProducerGraphNode,
  ProducerGraphEdge,
  RevisionId,
} from '../types.js';

function memoryContext(basePath = 'builds') {
  return createStorageContext({ kind: 'memory', basePath });
}

function buildProducerGraph(): ProducerGraph {
  const nodes: ProducerGraphNode[] = [
    {
      jobId: 'Producer:ScriptProducer',
      producer: 'ScriptProducer',
      inputs: ['Input:InquiryPrompt'],
      produces: ['Artifact:NarrationScript[0]', 'Artifact:NarrationScript[1]'],
      provider: 'openai',
      providerModel: 'openai/GPT-5',
      rateKey: 'llm:script',
      context: { namespacePath: [], indices: {}, producerAlias: 'ScriptProducer', inputs: [], produces: [] },
    },
    {
      jobId: 'Producer:AudioProducer[0]',
      producer: 'AudioProducer',
      inputs: ['Artifact:NarrationScript[0]'],
      produces: ['Artifact:SegmentAudio[0]'],
      provider: 'replicate',
      providerModel: 'elevenlabs/turbo-v2.5',
      rateKey: 'audio:elevenlabs-turbo',
      context: { namespacePath: [], indices: {}, producerAlias: 'AudioProducer', inputs: [], produces: [] },
    },
    {
      jobId: 'Producer:AudioProducer[1]',
      producer: 'AudioProducer',
      inputs: ['Artifact:NarrationScript[1]'],
      produces: ['Artifact:SegmentAudio[1]'],
      provider: 'replicate',
      providerModel: 'elevenlabs/turbo-v2.5',
      rateKey: 'audio:elevenlabs-turbo',
      context: { namespacePath: [], indices: {}, producerAlias: 'AudioProducer', inputs: [], produces: [] },
    },
    {
      jobId: 'Producer:TimelineAssembler',
      producer: 'TimelineAssembler',
      inputs: ['Artifact:SegmentAudio[0]', 'Artifact:SegmentAudio[1]'],
      produces: ['Artifact:FinalVideo'],
      provider: 'internal',
      providerModel: 'workflow/timeline-assembler',
      rateKey: 'internal:timeline',
      context: { namespacePath: [], indices: {}, producerAlias: 'TimelineAssembler', inputs: [], produces: [] },
    },
  ];

  const edges: ProducerGraphEdge[] = [
    { from: 'Producer:ScriptProducer', to: 'Producer:AudioProducer[0]' },
    { from: 'Producer:ScriptProducer', to: 'Producer:AudioProducer[1]' },
    { from: 'Producer:AudioProducer[0]', to: 'Producer:TimelineAssembler' },
    { from: 'Producer:AudioProducer[1]', to: 'Producer:TimelineAssembler' },
  ];

  return { nodes, edges };
}

async function loadManifest(ctx: ReturnType<typeof memoryContext>): Promise<Manifest> {
  const svc = createManifestService(ctx);
  try {
    const { manifest } = await svc.loadCurrent('demo');
    return manifest;
  } catch (error) {
    if (error instanceof ManifestNotFoundError) {
      return {
        revision: 'rev-0000',
        baseRevision: null,
        createdAt: new Date().toISOString(),
        inputs: {},
        artefacts: {},
        timeline: {},
      };
    }
    throw error;
  }
}

function assertTopological(plan: ExecutionPlanLike, graph: ProducerGraph) {
  const order = new Map<string, number>();
  plan.layers.forEach((layer, index) => {
    for (const job of layer) {
      order.set(job.jobId, index);
    }
  });
  for (const edge of graph.edges) {
    if (!order.has(edge.from) || !order.has(edge.to)) {
      continue;
    }
    const fromOrder = order.get(edge.from)!;
    const toOrder = order.get(edge.to)!;
    expect(fromOrder).toBeLessThan(toOrder);
  }
}

type ExecutionPlanLike = Awaited<ReturnType<ReturnType<typeof createPlanner>['computePlan']>>;

function createInputEvents(values: Record<string, unknown>, revision: RevisionId): InputEvent[] {
  const now = new Date().toISOString();
  return Object.entries(values).map(([id, payload]) => {
    const { hash } = hashPayload(payload);
    return {
      id,
      revision,
      payload,
      hash,
      editedBy: 'user',
      createdAt: now,
    } satisfies InputEvent;
  });
}

/**
 * Creates a manifest with all artifacts in succeeded status.
 * Useful for testing scenarios where a full run has completed.
 */
function createSucceededManifest(
  baseline: InputEvent[],
  options?: {
    revision?: RevisionId;
    artefacts?: Record<string, { hash: string; producedBy: string }>;
  }
): Manifest {
  const revision = options?.revision ?? 'rev-0001';
  const artefactCreatedAt = new Date().toISOString();

  // Default artifacts for the standard test graph
  const defaultArtefacts: Record<string, { hash: string; producedBy: string }> = {
    'Artifact:NarrationScript[0]': { hash: 'h0', producedBy: 'Producer:ScriptProducer' },
    'Artifact:NarrationScript[1]': { hash: 'h1', producedBy: 'Producer:ScriptProducer' },
    'Artifact:SegmentAudio[0]': { hash: 'h2', producedBy: 'Producer:AudioProducer[0]' },
    'Artifact:SegmentAudio[1]': { hash: 'h3', producedBy: 'Producer:AudioProducer[1]' },
    'Artifact:FinalVideo': { hash: 'h4', producedBy: 'Producer:TimelineAssembler' },
  };

  const artefactDefs = options?.artefacts ?? defaultArtefacts;
  const artefacts: Manifest['artefacts'] = {};
  for (const [id, def] of Object.entries(artefactDefs)) {
    artefacts[id] = {
      hash: def.hash,
      producedBy: def.producedBy,
      status: 'succeeded',
      createdAt: artefactCreatedAt,
    };
  }

  return {
    revision,
    baseRevision: null,
    createdAt: artefactCreatedAt,
    inputs: Object.fromEntries(
      baseline.map((event) => [
        event.id,
        {
          hash: event.hash,
          payloadDigest: hashPayload(event.payload).canonical,
          createdAt: event.createdAt,
        },
      ]),
    ),
    artefacts,
    timeline: {},
  };
}

describe('planner', () => {
  it('produces layered plan for initial run', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildProducerGraph();
    const planner = createPlanner();
    const manifest = await loadManifest(ctx);

    const plan = await planner.computePlan({
      movieId: 'demo',
      manifest,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0001',
      pendingEdits: [],
    });

    expect(plan.layers.length).toBeGreaterThan(0);
    assertTopological(plan, graph);
  });

  it('returns empty plan when inputs unchanged', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildProducerGraph();
    const planner = createPlanner();

    const baseline = createInputEvents({ InquiryPrompt: 'Tell me a story' }, 'rev-0001');
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const artefactCreatedAt = new Date().toISOString();
    const manifest: Manifest = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: artefactCreatedAt,
      inputs: Object.fromEntries(
        baseline.map((event) => [
          event.id,
          {
            hash: event.hash,
            payloadDigest: hashPayload(event.payload).canonical,
            createdAt: event.createdAt,
          },
        ]),
      ),
      artefacts: {
        'Artifact:NarrationScript[0]': {
          hash: 'hash-script-0',
          producedBy: 'Producer:ScriptProducer',
          status: 'succeeded',
          createdAt: artefactCreatedAt,
        },
        'Artifact:NarrationScript[1]': {
          hash: 'hash-script-1',
          producedBy: 'Producer:ScriptProducer',
          status: 'succeeded',
          createdAt: artefactCreatedAt,
        },
        'Artifact:SegmentAudio[0]': {
          hash: 'hash-audio-0',
          producedBy: 'Producer:AudioProducer[0]',
          status: 'succeeded',
          createdAt: artefactCreatedAt,
        },
        'Artifact:SegmentAudio[1]': {
          hash: 'hash-audio-1',
          producedBy: 'Producer:AudioProducer[1]',
          status: 'succeeded',
          createdAt: artefactCreatedAt,
        },
        'Artifact:FinalVideo': {
          hash: 'hash-final-video',
          producedBy: 'Producer:TimelineAssembler',
          status: 'succeeded',
          createdAt: artefactCreatedAt,
        },
      },
      timeline: {},
    };

    const plan = await planner.computePlan({
      movieId: 'demo',
      manifest,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0002',
      pendingEdits: [],
    });

    expect(plan.layers.flat()).toHaveLength(0);
    expect(plan.layers.every((layer) => layer.length === 0)).toBe(true);
  });

  it('propagates dirtiness downstream when inputs change', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildProducerGraph();
    const planner = createPlanner();

    const baseRevision = 'rev-0001';
    const baseline = createInputEvents({ InquiryPrompt: 'Tell me a story' }, baseRevision);
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const manifest: Manifest = {
      revision: baseRevision,
      baseRevision: null,
      createdAt: new Date().toISOString(),
      inputs: Object.fromEntries(
        baseline.map((event) => [
          event.id,
          {
            hash: event.hash,
            payloadDigest: hashPayload(event.payload).canonical,
            createdAt: event.createdAt,
          },
        ]),
      ),
      artefacts: {},
      timeline: {},
    };

    const nextRevision = nextRevisionId(baseRevision);
    const pending = createInputEvents({ InquiryPrompt: 'An epic voyage' }, nextRevision);

    const plan = await planner.computePlan({
      movieId: 'demo',
      manifest,
      eventLog,
      blueprint: graph,
      targetRevision: nextRevision,
      pendingEdits: pending,
    });

    const jobs = plan.layers.flat();
    expect(jobs.some((job) => job.jobId.includes('Producer:ScriptProducer'))).toBe(true);
    expect(jobs.some((job) => job.jobId.includes('Producer:TimelineAssembler'))).toBe(true);
  });

  it('marks artefact consumers dirty when artefact output changes without input edits', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildProducerGraph();
    const planner = createPlanner();

    const baseRevision = 'rev-0001';
    const baseline = createInputEvents({ InquiryPrompt: 'Tell me a story' }, baseRevision);
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const scriptArtefactId = 'Artifact:NarrationScript[0]';
    const originalScript = 'Segment 0: original narration';
    const originalHash = hashArtefactOutput({
      blob: { hash: 'script-0-hash', size: originalScript.length, mimeType: 'text/plain' },
    });
    const originalScriptOne = 'Segment 1: original narration';
    const originalScriptOneHash = hashArtefactOutput({
      blob: { hash: 'script-1-hash', size: originalScriptOne.length, mimeType: 'text/plain' },
    });
    const baselineArtefactTimestamp = new Date().toISOString();

    const manifest: Manifest = {
      revision: baseRevision,
      baseRevision: null,
      createdAt: baselineArtefactTimestamp,
      inputs: Object.fromEntries(
        baseline.map((event) => [
          event.id,
          {
            hash: event.hash,
            payloadDigest: hashPayload(event.payload).canonical,
            createdAt: event.createdAt,
          },
        ]),
      ),
      artefacts: {
        [scriptArtefactId]: {
          hash: originalHash,
          producedBy: 'Producer:ScriptProducer',
          status: 'succeeded',
          createdAt: baselineArtefactTimestamp,
        },
        'Artifact:NarrationScript[1]': {
          hash: originalScriptOneHash,
          producedBy: 'Producer:ScriptProducer',
          status: 'succeeded',
          createdAt: baselineArtefactTimestamp,
        },
        'Artifact:SegmentAudio[0]': {
          hash: 'hash-audio-0',
          producedBy: 'Producer:AudioProducer[0]',
          status: 'succeeded',
          createdAt: baselineArtefactTimestamp,
        },
        'Artifact:SegmentAudio[1]': {
          hash: 'hash-audio-1',
          producedBy: 'Producer:AudioProducer[1]',
          status: 'succeeded',
          createdAt: baselineArtefactTimestamp,
        },
        'Artifact:FinalVideo': {
          hash: 'hash-final-video',
          producedBy: 'Producer:TimelineAssembler',
          status: 'succeeded',
          createdAt: baselineArtefactTimestamp,
        },
      },
      timeline: {},
    };

    await eventLog.appendArtefact('demo', {
      artefactId: scriptArtefactId,
      revision: 'rev-manual',
      inputsHash: 'manual',
      output: {
        blob: {
          hash: 'edited-script-0-hash',
          size: 'Segment 0: edited narration'.length,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'manual-edit',
      createdAt: new Date().toISOString(),
    });

    const plan = await planner.computePlan({
      movieId: 'demo',
      manifest,
      eventLog,
      blueprint: graph,
      targetRevision: nextRevisionId(baseRevision),
      pendingEdits: [],
    });

    const jobs = plan.layers.flat();
    expect(jobs.some((job) => job.producer === 'AudioProducer')).toBe(true);
    expect(jobs.some((job) => job.producer === 'TimelineAssembler')).toBe(true);
    expect(jobs.some((job) => job.producer === 'ScriptProducer')).toBe(false);
  });

  it('marks producer and downstream jobs dirty when model selection input changes', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const planner = createPlanner();

    const graph: ProducerGraph = {
      nodes: [
        {
          jobId: 'Producer:A',
          producer: 'ProducerA',
          inputs: ['Input:Prompt', 'Input:ProducerA.model'],
          produces: ['Artifact:A'],
          provider: 'provider-a',
          providerModel: 'model-a',
          rateKey: 'rk:a',
          context: { namespacePath: [], indices: {}, producerAlias: 'ProducerA', inputs: [], produces: [] },
        },
        {
          jobId: 'Producer:B',
          producer: 'ProducerB',
          inputs: ['Artifact:A', 'Input:ProducerB.volume'],
          produces: ['Artifact:B'],
          provider: 'provider-b',
          providerModel: 'model-b',
          rateKey: 'rk:b',
          context: { namespacePath: [], indices: {}, producerAlias: 'ProducerB', inputs: [], produces: [] },
        },
      ],
      edges: [
        { from: 'Producer:A', to: 'Producer:B' },
      ],
    };

    const baselineInputs = createInputEvents(
      {
        'Input:Prompt': 'hello',
        'Input:ProducerA.model': 'model-a',
        'Input:ProducerB.volume': 0.5,
      },
      'rev-0001',
    );
    for (const event of baselineInputs) {
      await eventLog.appendInput('demo', event);
    }
    const artefactCreatedAt = new Date().toISOString();
    await eventLog.appendArtefact('demo', {
      artefactId: 'Artifact:A',
      revision: 'rev-0001',
      inputsHash: 'hash-a',
      output: { blob: { hash: 'blob-a', size: 1, mimeType: 'text/plain' } },
      status: 'succeeded',
      producedBy: 'Producer:A',
      createdAt: artefactCreatedAt,
    });
    await eventLog.appendArtefact('demo', {
      artefactId: 'Artifact:B',
      revision: 'rev-0001',
      inputsHash: 'hash-b',
      output: { blob: { hash: 'blob-b', size: 1, mimeType: 'text/plain' } },
      status: 'succeeded',
      producedBy: 'Producer:B',
      createdAt: artefactCreatedAt,
    });

    const manifest: Manifest = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: artefactCreatedAt,
      inputs: Object.fromEntries(
        baselineInputs.map((event) => [
          event.id,
          {
            hash: event.hash,
            payloadDigest: hashPayload(event.payload).canonical,
            createdAt: event.createdAt,
          },
        ]),
      ),
      artefacts: {
        'Artifact:A': {
          hash: 'blob-a',
          producedBy: 'Producer:A',
          status: 'succeeded',
          createdAt: artefactCreatedAt,
        },
        'Artifact:B': {
          hash: 'blob-b',
          producedBy: 'Producer:B',
          status: 'succeeded',
          createdAt: artefactCreatedAt,
        },
      },
      timeline: {},
    };

    const pending = createInputEvents(
      { 'Input:ProducerA.model': 'model-a-v2' },
      'rev-0002' as RevisionId,
    );

    const plan = await planner.computePlan({
      movieId: 'demo',
      manifest,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0002' as RevisionId,
      pendingEdits: pending,
    });

    const allJobs = plan.layers.flat().map((job) => job.jobId);
    expect(allJobs).toContain('Producer:A');
    expect(allJobs).toContain('Producer:B');
    expect(allJobs.length).toBe(2);
    assertTopological(plan, graph);
  });

  it('marks only the dependent producer dirty when a config input changes', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const planner = createPlanner();

    const graph: ProducerGraph = {
      nodes: [
        {
          jobId: 'Producer:A',
          producer: 'ProducerA',
          inputs: ['Input:Prompt'],
          produces: ['Artifact:A'],
          provider: 'provider-a',
          providerModel: 'model-a',
          rateKey: 'rk:a',
          context: { namespacePath: [], indices: {}, producerAlias: 'ProducerA', inputs: [], produces: [] },
        },
        {
          jobId: 'Producer:B',
          producer: 'ProducerB',
          inputs: ['Artifact:A', 'Input:ProducerB.volume'],
          produces: ['Artifact:B'],
          provider: 'provider-b',
          providerModel: 'model-b',
          rateKey: 'rk:b',
          context: { namespacePath: [], indices: {}, producerAlias: 'ProducerB', inputs: [], produces: [] },
        },
      ],
      edges: [
        { from: 'Producer:A', to: 'Producer:B' },
      ],
    };

    const baselineInputs = createInputEvents(
      {
        'Input:Prompt': 'hello',
        'Input:ProducerB.volume': 0.5,
      },
      'rev-0001',
    );
    for (const event of baselineInputs) {
      await eventLog.appendInput('demo', event);
    }
    const artefactCreatedAt = new Date().toISOString();
    await eventLog.appendArtefact('demo', {
      artefactId: 'Artifact:A',
      revision: 'rev-0001',
      inputsHash: 'hash-a',
      output: { blob: { hash: 'blob-a', size: 1, mimeType: 'text/plain' } },
      status: 'succeeded',
      producedBy: 'Producer:A',
      createdAt: artefactCreatedAt,
    });
    await eventLog.appendArtefact('demo', {
      artefactId: 'Artifact:B',
      revision: 'rev-0001',
      inputsHash: 'hash-b',
      output: { blob: { hash: 'blob-b', size: 1, mimeType: 'text/plain' } },
      status: 'succeeded',
      producedBy: 'Producer:B',
      createdAt: artefactCreatedAt,
    });

    const manifest: Manifest = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: artefactCreatedAt,
      inputs: Object.fromEntries(
        baselineInputs.map((event) => [
          event.id,
          {
            hash: event.hash,
            payloadDigest: hashPayload(event.payload).canonical,
            createdAt: event.createdAt,
          },
        ]),
      ),
      artefacts: {
        'Artifact:A': {
          hash: 'blob-a',
          producedBy: 'Producer:A',
          status: 'succeeded',
          createdAt: artefactCreatedAt,
        },
        'Artifact:B': {
          hash: 'blob-b',
          producedBy: 'Producer:B',
          status: 'succeeded',
          createdAt: artefactCreatedAt,
        },
      },
      timeline: {},
    };

    const pending = createInputEvents(
      { 'Input:ProducerB.volume': 0.7 },
      'rev-0002' as RevisionId,
    );

    const plan = await planner.computePlan({
      movieId: 'demo',
      manifest,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0002' as RevisionId,
      pendingEdits: pending,
    });

    const allJobs = plan.layers.flat().map((job) => job.jobId);
    expect(allJobs).toContain('Producer:B');
    expect(allJobs).not.toContain('Producer:A');
    expect(allJobs.length).toBe(1);
    assertTopological(plan, graph);
  });

  it('throws when the graph contains a cycle', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const planner = createPlanner();
    const manifest = await loadManifest(ctx);

    const cyclicGraph: ProducerGraph = {
      nodes: [
        {
          jobId: 'Producer:A',
          producer: 'ProducerA',
          inputs: [],
          produces: ['Artifact:alpha'],
          provider: 'internal',
          providerModel: 'mock/ProducerA',
          rateKey: 'internal:a',
          context: { namespacePath: [], indices: {}, producerAlias: 'Producer:A', inputs: [], produces: [] },
        },
        {
          jobId: 'Producer:B',
          producer: 'ProducerB',
          inputs: ['Artifact:alpha'],
          produces: ['Artifact:beta'],
          provider: 'internal',
          providerModel: 'mock/ProducerB',
          rateKey: 'internal:b',
          context: { namespacePath: [], indices: {}, producerAlias: 'Producer:B', inputs: [], produces: [] },
        },
      ],
      edges: [
        { from: 'Producer:A', to: 'Producer:B' },
        { from: 'Producer:B', to: 'Producer:A' },
      ],
    };

    await expect(
      planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: cyclicGraph,
        targetRevision: 'rev-0001',
        pendingEdits: [],
      }),
    ).rejects.toThrow(/cycle/i);
  });

  describe('reRunFrom', () => {
    it('forces jobs at reRunFrom layer and above into plan even when artifacts exist', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      // Set up baseline with all artifacts existing (nothing dirty)
      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const artefactCreatedAt = new Date().toISOString();
      const manifest: Manifest = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artefactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((event) => [
            event.id,
            {
              hash: event.hash,
              payloadDigest: hashPayload(event.payload).canonical,
              createdAt: event.createdAt,
            },
          ]),
        ),
        artefacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'hash-script-0',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artefactCreatedAt,
          },
          'Artifact:NarrationScript[1]': {
            hash: 'hash-script-1',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artefactCreatedAt,
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'hash-audio-0',
            producedBy: 'Producer:AudioProducer[0]',
            status: 'succeeded',
            createdAt: artefactCreatedAt,
          },
          'Artifact:SegmentAudio[1]': {
            hash: 'hash-audio-1',
            producedBy: 'Producer:AudioProducer[1]',
            status: 'succeeded',
            createdAt: artefactCreatedAt,
          },
          'Artifact:FinalVideo': {
            hash: 'hash-final-video',
            producedBy: 'Producer:TimelineAssembler',
            status: 'succeeded',
            createdAt: artefactCreatedAt,
          },
        },
        timeline: {},
      };

      // Without reRunFrom, plan should be empty (nothing dirty)
      const planWithoutRerun = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
      });
      expect(planWithoutRerun.layers.flat()).toHaveLength(0);

      // With reRunFrom=1, should include AudioProducer jobs (layer 1) and TimelineAssembler (layer 2)
      const planWithRerun = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0003',
        pendingEdits: [],
        reRunFrom: 1,
      });

      const jobsInPlan = planWithRerun.layers.flat();
      // Layer 0 is ScriptProducer - should NOT be included
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')).toBe(false);
      // Layer 1 is AudioProducer[0] and AudioProducer[1] - SHOULD be included
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')).toBe(true);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')).toBe(true);
      // Layer 2 is TimelineAssembler - SHOULD be included
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')).toBe(true);

      // Verify layer structure
      expect(planWithRerun.layers[0]).toHaveLength(0); // Layer 0 empty
      expect(planWithRerun.layers[1]).toHaveLength(2); // Layer 1 has 2 audio jobs
      expect(planWithRerun.layers[2]).toHaveLength(1); // Layer 2 has timeline assembler
    });

    it('reRunFrom=0 includes all jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        reRunFrom: 0,
      });

      const jobsInPlan = plan.layers.flat();
      expect(jobsInPlan).toHaveLength(4); // All 4 jobs
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')).toBe(true);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')).toBe(true);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')).toBe(true);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')).toBe(true);
    });

    it('reRunFrom at last layer includes only that layer', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      // Layer 2 is the last layer (TimelineAssembler)
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        reRunFrom: 2,
      });

      const jobsInPlan = plan.layers.flat();
      expect(jobsInPlan).toHaveLength(1);
      expect(jobsInPlan[0]?.jobId).toBe('Producer:TimelineAssembler');
    });
  });

  describe('computeArtifactRegenerationJobs', () => {
    it('includes only source job when it has no downstream dependencies', () => {
      const graph: ProducerGraph = {
        nodes: [
          {
            jobId: 'Producer:A',
            producer: 'ProducerA',
            inputs: ['Input:Prompt'],
            produces: ['Artifact:A'],
            provider: 'provider-a',
            providerModel: 'model-a',
            rateKey: 'rk:a',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerA', inputs: [], produces: [] },
          },
        ],
        edges: [],
      };

      const jobs = computeArtifactRegenerationJobs('Producer:A', graph);

      expect(jobs.size).toBe(1);
      expect(jobs.has('Producer:A')).toBe(true);
    });

    it('includes source job and downstream dependencies', () => {
      const graph = buildProducerGraph();

      // Target AudioProducer[0] - should include it and TimelineAssembler
      const jobs = computeArtifactRegenerationJobs('Producer:AudioProducer[0]', graph);

      expect(jobs.size).toBe(2);
      expect(jobs.has('Producer:AudioProducer[0]')).toBe(true);
      expect(jobs.has('Producer:TimelineAssembler')).toBe(true);
      // Should NOT include siblings
      expect(jobs.has('Producer:AudioProducer[1]')).toBe(false);
      expect(jobs.has('Producer:ScriptProducer')).toBe(false);
    });

    it('excludes sibling jobs at same layer (key differentiation from --from)', () => {
      const graph = buildProducerGraph();

      // Target ScriptProducer - should include all downstream but nothing upstream
      const jobs = computeArtifactRegenerationJobs('Producer:ScriptProducer', graph);

      expect(jobs.size).toBe(4); // ScriptProducer + 2 AudioProducers + TimelineAssembler
      expect(jobs.has('Producer:ScriptProducer')).toBe(true);
      expect(jobs.has('Producer:AudioProducer[0]')).toBe(true);
      expect(jobs.has('Producer:AudioProducer[1]')).toBe(true);
      expect(jobs.has('Producer:TimelineAssembler')).toBe(true);
    });

    it('propagates through multi-level downstream chain', () => {
      const graph: ProducerGraph = {
        nodes: [
          {
            jobId: 'Producer:A',
            producer: 'ProducerA',
            inputs: [],
            produces: ['Artifact:A'],
            provider: 'p-a',
            providerModel: 'm-a',
            rateKey: 'rk:a',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerA', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: ['Artifact:A'],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerB', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:C',
            producer: 'ProducerC',
            inputs: ['Artifact:B'],
            produces: ['Artifact:C'],
            provider: 'p-c',
            providerModel: 'm-c',
            rateKey: 'rk:c',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerC', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:D',
            producer: 'ProducerD',
            inputs: ['Artifact:C'],
            produces: ['Artifact:D'],
            provider: 'p-d',
            providerModel: 'm-d',
            rateKey: 'rk:d',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerD', inputs: [], produces: [] },
          },
        ],
        edges: [
          { from: 'Producer:A', to: 'Producer:B' },
          { from: 'Producer:B', to: 'Producer:C' },
          { from: 'Producer:C', to: 'Producer:D' },
        ],
      };

      // Target middle of chain (B) - should include B, C, D but not A
      const jobs = computeArtifactRegenerationJobs('Producer:B', graph);

      expect(jobs.size).toBe(3);
      expect(jobs.has('Producer:B')).toBe(true);
      expect(jobs.has('Producer:C')).toBe(true);
      expect(jobs.has('Producer:D')).toBe(true);
      expect(jobs.has('Producer:A')).toBe(false);
    });

    it('handles diamond dependencies correctly', () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      const graph: ProducerGraph = {
        nodes: [
          {
            jobId: 'Producer:A',
            producer: 'ProducerA',
            inputs: [],
            produces: ['Artifact:A'],
            provider: 'p-a',
            providerModel: 'm-a',
            rateKey: 'rk:a',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerA', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: ['Artifact:A'],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerB', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:C',
            producer: 'ProducerC',
            inputs: ['Artifact:A'],
            produces: ['Artifact:C'],
            provider: 'p-c',
            providerModel: 'm-c',
            rateKey: 'rk:c',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerC', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:D',
            producer: 'ProducerD',
            inputs: ['Artifact:B', 'Artifact:C'],
            produces: ['Artifact:D'],
            provider: 'p-d',
            providerModel: 'm-d',
            rateKey: 'rk:d',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerD', inputs: [], produces: [] },
          },
        ],
        edges: [
          { from: 'Producer:A', to: 'Producer:B' },
          { from: 'Producer:A', to: 'Producer:C' },
          { from: 'Producer:B', to: 'Producer:D' },
          { from: 'Producer:C', to: 'Producer:D' },
        ],
      };

      // Target B - should include B and D, but not C (sibling) or A (upstream)
      const jobs = computeArtifactRegenerationJobs('Producer:B', graph);

      expect(jobs.size).toBe(2);
      expect(jobs.has('Producer:B')).toBe(true);
      expect(jobs.has('Producer:D')).toBe(true);
      expect(jobs.has('Producer:A')).toBe(false);
      expect(jobs.has('Producer:C')).toBe(false);
    });
  });

  describe('artifactRegenerations in computePlan', () => {
    it('includes only source job and downstream when artifactRegenerations is provided (single artifact)', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      // Surgical regeneration of AudioProducer[0]
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [{
          targetArtifactId: 'Artifact:SegmentAudio[0]',
          sourceJobId: 'Producer:AudioProducer[0]',
        }],
      });

      const jobsInPlan = plan.layers.flat();

      // Should include AudioProducer[0] and TimelineAssembler
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')).toBe(true);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')).toBe(true);

      // Should NOT include siblings or upstream
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')).toBe(false);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')).toBe(false);

      expect(jobsInPlan.length).toBe(2);
    });

    it('includes union of jobs when multiple artifacts are targeted', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      // Surgical regeneration of BOTH AudioProducer[0] and AudioProducer[1]
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [
          {
            targetArtifactId: 'Artifact:SegmentAudio[0]',
            sourceJobId: 'Producer:AudioProducer[0]',
          },
          {
            targetArtifactId: 'Artifact:SegmentAudio[1]',
            sourceJobId: 'Producer:AudioProducer[1]',
          },
        ],
      });

      const jobsInPlan = plan.layers.flat();

      // Should include BOTH AudioProducers and TimelineAssembler
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')).toBe(true);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')).toBe(true);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')).toBe(true);

      // Should NOT include upstream ScriptProducer
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')).toBe(false);

      // Total: 3 jobs (2 audio + 1 timeline)
      expect(jobsInPlan.length).toBe(3);
    });

    it('surgical regeneration ignores reRunFrom parameter', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      // Surgical regeneration of TimelineAssembler with reRunFrom=0 (should be ignored)
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        reRunFrom: 0, // This would normally include ALL jobs
        artifactRegenerations: [{
          targetArtifactId: 'Artifact:FinalVideo',
          sourceJobId: 'Producer:TimelineAssembler',
        }],
      });

      const jobsInPlan = plan.layers.flat();

      // Should only include TimelineAssembler (no downstream)
      expect(jobsInPlan.length).toBe(1);
      expect(jobsInPlan[0]?.jobId).toBe('Producer:TimelineAssembler');
    });

    it('surgical mode also includes jobs with missing artifacts', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      // Create a manifest where AudioProducer[1] artifact is MISSING (simulating a failed run).
      // Only AudioProducer[0]'s artifact and ScriptProducer's artifacts exist.
      const artefactCreatedAt = new Date().toISOString();
      const manifest: Manifest = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artefactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((event) => [
            event.id,
            {
              hash: event.hash,
              payloadDigest: hashPayload(event.payload).canonical,
              createdAt: event.createdAt,
            },
          ]),
        ),
        artefacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'h0',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artefactCreatedAt,
          },
          'Artifact:NarrationScript[1]': {
            hash: 'h1',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artefactCreatedAt,
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'h2',
            producedBy: 'Producer:AudioProducer[0]',
            status: 'succeeded',
            createdAt: artefactCreatedAt,
          },
          // Artifact:SegmentAudio[1] is MISSING (AudioProducer[1] failed)
          // Artifact:FinalVideo is MISSING (TimelineAssembler failed due to missing input)
        },
        timeline: {},
      };

      // Surgical regeneration targets AudioProducer[0] (e.g., user wants to regenerate SegmentAudio[0])
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [{
          targetArtifactId: 'Artifact:SegmentAudio[0]',
          sourceJobId: 'Producer:AudioProducer[0]',
        }],
      });

      const jobIds = plan.layers.flat().map((job) => job.jobId);

      // Surgical targets: AudioProducer[0] + downstream TimelineAssembler
      expect(jobIds).toContain('Producer:AudioProducer[0]');
      expect(jobIds).toContain('Producer:TimelineAssembler');

      // Dirty detection should also pick up AudioProducer[1] because SegmentAudio[1] is missing
      expect(jobIds).toContain('Producer:AudioProducer[1]');

      // ScriptProducer should NOT be included (its artifacts all exist)
      expect(jobIds).not.toContain('Producer:ScriptProducer');

      // Total: AudioProducer[0] (surgical) + AudioProducer[1] (missing) + TimelineAssembler (downstream of both)
      expect(jobIds.length).toBe(3);

      assertTopological(plan, graph);
    });
  });

  describe('upToLayer', () => {
    it('filters plan to include only jobs up to specified layer', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      // reRunFrom=0 would normally include all jobs, but upToLayer=1 should exclude layer 2
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        reRunFrom: 0,
        upToLayer: 1, // Only layers 0 and 1
      });

      const jobsInPlan = plan.layers.flat();

      // Layer 0 (ScriptProducer) should be included
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')).toBe(true);
      // Layer 1 (AudioProducers) should be included
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')).toBe(true);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')).toBe(true);
      // Layer 2 (TimelineAssembler) should be EXCLUDED
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')).toBe(false);

      expect(jobsInPlan.length).toBe(3);
    });

    it('upToLayer=0 returns only layer 0 jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        reRunFrom: 0,
        upToLayer: 0, // Only layer 0
      });

      const jobsInPlan = plan.layers.flat();

      // Only ScriptProducer (layer 0) should be included
      expect(jobsInPlan.length).toBe(1);
      expect(jobsInPlan[0]?.jobId).toBe('Producer:ScriptProducer');
    });

    it('surgical mode + upToLayer filters surgical jobs by layer', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      // Surgical regeneration of ScriptProducer would normally include all downstream
      // But upToLayer=0 should limit to only layer 0
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [{
          targetArtifactId: 'Artifact:NarrationScript[0]',
          sourceJobId: 'Producer:ScriptProducer',
        }],
        upToLayer: 0, // Only layer 0
      });

      const jobsInPlan = plan.layers.flat();

      // ScriptProducer is at layer 0 - should be included
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')).toBe(true);
      // AudioProducers are at layer 1 - should be EXCLUDED
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')).toBe(false);
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')).toBe(false);
      // TimelineAssembler is at layer 2 - should be EXCLUDED
      expect(jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')).toBe(false);

      expect(jobsInPlan.length).toBe(1);
    });

    it('upToLayer beyond max layer includes all jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      // upToLayer=10 is beyond max layer (2), so all jobs should be included
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        reRunFrom: 0,
        upToLayer: 10,
      });

      const jobsInPlan = plan.layers.flat();
      expect(jobsInPlan.length).toBe(4); // All 4 jobs
    });
  });

  describe('computeMultipleArtifactRegenerationJobs', () => {
    it('returns single source job set when given one source', () => {
      const graph = buildProducerGraph();

      // Single source - should behave same as computeArtifactRegenerationJobs
      const jobs = computeMultipleArtifactRegenerationJobs(['Producer:AudioProducer[0]'], graph);

      expect(jobs.size).toBe(2);
      expect(jobs.has('Producer:AudioProducer[0]')).toBe(true);
      expect(jobs.has('Producer:TimelineAssembler')).toBe(true);
    });

    it('returns union of non-overlapping source job sets', () => {
      // Two separate branches that don't share downstream
      const graph: ProducerGraph = {
        nodes: [
          {
            jobId: 'Producer:A',
            producer: 'ProducerA',
            inputs: [],
            produces: ['Artifact:A'],
            provider: 'p-a',
            providerModel: 'm-a',
            rateKey: 'rk:a',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerA', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: [],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerB', inputs: [], produces: [] },
          },
        ],
        edges: [],
      };

      const jobs = computeMultipleArtifactRegenerationJobs(['Producer:A', 'Producer:B'], graph);

      expect(jobs.size).toBe(2);
      expect(jobs.has('Producer:A')).toBe(true);
      expect(jobs.has('Producer:B')).toBe(true);
    });

    it('deduplicates jobs when sources share downstream dependencies', () => {
      const graph = buildProducerGraph();

      // Both AudioProducers share TimelineAssembler as downstream
      const jobs = computeMultipleArtifactRegenerationJobs(
        ['Producer:AudioProducer[0]', 'Producer:AudioProducer[1]'],
        graph
      );

      // Should include both audio producers + TimelineAssembler (deduplicated)
      expect(jobs.size).toBe(3);
      expect(jobs.has('Producer:AudioProducer[0]')).toBe(true);
      expect(jobs.has('Producer:AudioProducer[1]')).toBe(true);
      expect(jobs.has('Producer:TimelineAssembler')).toBe(true);

      // Should NOT include upstream ScriptProducer
      expect(jobs.has('Producer:ScriptProducer')).toBe(false);
    });

    it('returns empty set for empty input', () => {
      const graph = buildProducerGraph();

      const jobs = computeMultipleArtifactRegenerationJobs([], graph);

      expect(jobs.size).toBe(0);
    });

    it('handles diamond dependencies correctly with multiple sources', () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      const graph: ProducerGraph = {
        nodes: [
          {
            jobId: 'Producer:A',
            producer: 'ProducerA',
            inputs: [],
            produces: ['Artifact:A'],
            provider: 'p-a',
            providerModel: 'm-a',
            rateKey: 'rk:a',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerA', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: ['Artifact:A'],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerB', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:C',
            producer: 'ProducerC',
            inputs: ['Artifact:A'],
            produces: ['Artifact:C'],
            provider: 'p-c',
            providerModel: 'm-c',
            rateKey: 'rk:c',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerC', inputs: [], produces: [] },
          },
          {
            jobId: 'Producer:D',
            producer: 'ProducerD',
            inputs: ['Artifact:B', 'Artifact:C'],
            produces: ['Artifact:D'],
            provider: 'p-d',
            providerModel: 'm-d',
            rateKey: 'rk:d',
            context: { namespacePath: [], indices: {}, producerAlias: 'ProducerD', inputs: [], produces: [] },
          },
        ],
        edges: [
          { from: 'Producer:A', to: 'Producer:B' },
          { from: 'Producer:A', to: 'Producer:C' },
          { from: 'Producer:B', to: 'Producer:D' },
          { from: 'Producer:C', to: 'Producer:D' },
        ],
      };

      // Target both B and C - should include B, C, D (deduplicated) but not A
      const jobs = computeMultipleArtifactRegenerationJobs(['Producer:B', 'Producer:C'], graph);

      expect(jobs.size).toBe(3);
      expect(jobs.has('Producer:B')).toBe(true);
      expect(jobs.has('Producer:C')).toBe(true);
      expect(jobs.has('Producer:D')).toBe(true);
      expect(jobs.has('Producer:A')).toBe(false);
    });
  });

  describe('blueprintLayerCount', () => {
    it('returns full blueprint layer count regardless of upToLayer filtering', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph(); // 3 layers: ScriptProducer, AudioProducers, TimelineAssembler
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const artefactCreatedAt = new Date().toISOString();
      const manifest: Manifest = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artefactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((event) => [
            event.id,
            { hash: event.hash, payloadDigest: hashPayload(event.payload).canonical, createdAt: event.createdAt },
          ]),
        ),
        artefacts: {},
        timeline: {},
      };

      // Plan with upToLayer=0, so only layer 0 is scheduled
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        upToLayer: 0,
      });

      // layers.length should be 1 (only layer 0)
      expect(plan.layers.length).toBe(1);
      // blueprintLayerCount should be 3 (full topology)
      expect(plan.blueprintLayerCount).toBe(3);
    });

    it('returns correct blueprintLayerCount for NOOP plan', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents({ InquiryPrompt: 'Tell me a story' }, 'rev-0001');
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline);

      // All artifacts succeeded, nothing dirty -> NOOP plan
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
      });

      // layers should be empty (no trailing empty arrays)
      expect(plan.layers.flat()).toHaveLength(0);
      expect(plan.layers.length).toBe(0);
      // blueprintLayerCount should still be 3
      expect(plan.blueprintLayerCount).toBe(3);
    });
  });

  describe('empty trailing layers trimmed', () => {
    it('trims empty trailing layers when upToLayer filters jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents({ 'Input:InquiryPrompt': 'Tell me a story' }, baseRevision);
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline, { revision: baseRevision });

      // reRunFrom=0 forces all jobs, but upToLayer=0 limits to only layer 0
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        reRunFrom: 0,
        upToLayer: 0,
      });

      // Should only have 1 layer with ScriptProducer
      expect(plan.layers.length).toBe(1);
      expect(plan.layers[0].length).toBe(1);
      expect(plan.layers[0][0]?.jobId).toBe('Producer:ScriptProducer');
      // No trailing empty layers
      expect(plan.layers.every(layer => layer.length > 0)).toBe(true);
    });

    it('removes all layers when plan is completely empty', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents({ InquiryPrompt: 'Tell me a story' }, 'rev-0001');
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const manifest = createSucceededManifest(baseline);

      // Nothing dirty, no reRunFrom, no surgical -> empty plan
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
      });

      // layers array should be completely empty (no empty arrays inside)
      expect(plan.layers.length).toBe(0);
      expect(plan.layers.flat().length).toBe(0);
    });
  });

  describe('topology service consistency', () => {
    it('blueprintLayerCount matches topology service computation', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();
      const manifest = await loadManifest(ctx);

      // Compute topology directly using the service
      const nodes = graph.nodes.map((n) => ({ id: n.jobId }));
      const topologyResult = computeTopologyLayers(nodes, graph.edges);

      // Compute plan
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0001',
        pendingEdits: [],
      });

      // Verify consistency
      expect(plan.blueprintLayerCount).toBe(topologyResult.layerCount);
    });

    it('layer assignments match topology service for all jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();
      const manifest = await loadManifest(ctx);

      // Compute topology directly
      const nodes = graph.nodes.map((n) => ({ id: n.jobId }));
      const topologyResult = computeTopologyLayers(nodes, graph.edges);

      // Compute plan with all jobs (initial run)
      const plan = await planner.computePlan({
        movieId: 'demo',
        manifest,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0001',
        pendingEdits: [],
      });

      // Verify each job is placed in its correct layer
      for (let layerIndex = 0; layerIndex < plan.layers.length; layerIndex++) {
        for (const job of plan.layers[layerIndex]) {
          const expectedLayer = topologyResult.layerAssignments.get(job.jobId);
          expect(expectedLayer).toBe(layerIndex);
        }
      }
    });
  });
});
