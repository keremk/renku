import { describe, expect, it } from 'vitest';
import { createPlanner } from './planner.js';
import { createEventLog } from '../event-log.js';
import { createStorageContext, initializeMovieStorage } from '../storage.js';
import { createManifestService, ManifestNotFoundError } from '../manifest.js';
import { hashArtefactOutput, hashPayload } from '../hashing.js';
import { nextRevisionId } from '../revisions.js';
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
});
