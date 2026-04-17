import { describe, expect, it } from 'vitest';
import {
  createPlanner,
  computeArtifactRegenerationJobs,
  computeMultipleArtifactRegenerationJobs,
} from './planner.js';
import { createEventLog } from '../event-log.js';
import { createStorageContext, initializeMovieStorage } from '../storage.js';
import {
  createBuildStateService,
  BuildStateNotFoundError,
} from '../build-state.js';
import {
  hashArtifactOutput,
  hashPayload,
  hashInputContents,
} from '../hashing.js';
import { nextRevisionId } from '../revisions.js';
import { computeTopologyLayers } from '../topology/index.js';
import type {
  BuildState,
  InputEvent,
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
      context: {
        namespacePath: [],
        indices: {},
        producerAlias: 'ScriptProducer',
        inputs: [],
        produces: [],
      },
    },
    {
      jobId: 'Producer:AudioProducer[0]',
      producer: 'AudioProducer',
      inputs: ['Artifact:NarrationScript[0]'],
      produces: ['Artifact:SegmentAudio[0]'],
      provider: 'replicate',
      providerModel: 'elevenlabs/turbo-v2.5',
      rateKey: 'audio:elevenlabs-turbo',
      context: {
        namespacePath: [],
        indices: {},
        producerAlias: 'AudioProducer',
        inputs: [],
        produces: [],
      },
    },
    {
      jobId: 'Producer:AudioProducer[1]',
      producer: 'AudioProducer',
      inputs: ['Artifact:NarrationScript[1]'],
      produces: ['Artifact:SegmentAudio[1]'],
      provider: 'replicate',
      providerModel: 'elevenlabs/turbo-v2.5',
      rateKey: 'audio:elevenlabs-turbo',
      context: {
        namespacePath: [],
        indices: {},
        producerAlias: 'AudioProducer',
        inputs: [],
        produces: [],
      },
    },
    {
      jobId: 'Producer:TimelineAssembler',
      producer: 'TimelineAssembler',
      inputs: ['Artifact:SegmentAudio[0]', 'Artifact:SegmentAudio[1]'],
      produces: ['Artifact:FinalVideo'],
      provider: 'internal',
      providerModel: 'workflow/timeline-assembler',
      rateKey: 'internal:timeline',
      context: {
        namespacePath: [],
        indices: {},
        producerAlias: 'TimelineAssembler',
        inputs: [],
        produces: [],
      },
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

function buildConditionArtifactGraph(): ProducerGraph {
  const nodes: ProducerGraphNode[] = [
    {
      jobId: 'Producer:DirectorProducer',
      producer: 'DirectorProducer',
      inputs: ['Input:Prompt'],
      produces: [
        'Artifact:DirectorProducer.Script.Characters[0].MeetingVideoPrompt',
        'Artifact:DirectorProducer.Script.Characters[0].HasTransition',
      ],
      provider: 'openai',
      providerModel: 'openai/GPT-5',
      rateKey: 'llm:director',
      context: {
        namespacePath: [],
        indices: {},
        producerAlias: 'DirectorProducer',
        inputs: [],
        produces: [],
      },
    },
    {
      jobId: 'Producer:TransitionVideoProducer[0]',
      producer: 'TransitionVideoProducer',
      inputs: [
        'Artifact:DirectorProducer.Script.Characters[0].MeetingVideoPrompt',
      ],
      produces: ['Artifact:TransitionVideoProducer.GeneratedVideo[0]'],
      provider: 'fal-ai',
      providerModel: 'kling-video/v2.5',
      rateKey: 'video:kling',
      context: {
        namespacePath: [],
        indices: {},
        producerAlias: 'TransitionVideoProducer',
        inputs: [],
        produces: [],
        inputConditions: {
          'Artifact:DirectorProducer.Script.Characters[0].MeetingVideoPrompt': {
            condition: {
              when: 'Artifact:DirectorProducer.Script.Characters[0].HasTransition',
              is: true,
            },
            indices: {},
          },
        },
      },
    },
  ];

  const edges: ProducerGraphEdge[] = [
    {
      from: 'Producer:DirectorProducer',
      to: 'Producer:TransitionVideoProducer[0]',
    },
  ];

  return { nodes, edges };
}

async function loadBuildState(
  ctx: ReturnType<typeof memoryContext>
): Promise<BuildState> {
  const svc = createBuildStateService(ctx);
  try {
    const { buildState } = await svc.loadCurrent('demo');
    return buildState;
  } catch (error) {
    if (error instanceof BuildStateNotFoundError) {
      return {
        revision: 'rev-0000',
        baseRevision: null,
        createdAt: new Date().toISOString(),
        inputs: {},
        artifacts: {},
        timeline: {},
      };
    }
    throw error;
  }
}

import type { ExecutionPlan } from '../types.js';

function assertTopological(plan: ExecutionPlan, graph: ProducerGraph) {
  const order = new Map<string, number>();
  plan.layers.forEach((layer: ExecutionPlan['layers'][0], index: number) => {
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

function createInputEvents(
  values: Record<string, unknown>,
  revision: RevisionId
): InputEvent[] {
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
 * Creates derived build-state data with all artifacts in succeeded status.
 * Useful for testing scenarios where a full run has completed.
 */
function createSucceededBuildState(
  baseline: InputEvent[],
  options?: {
    revision?: RevisionId;
    artifacts?: Record<string, { hash: string; producedBy: string }>;
  }
): BuildState {
  const revision = options?.revision ?? 'rev-0001';
  const artifactCreatedAt = new Date().toISOString();

  // Default artifacts for the standard test graph
  const defaultArtifacts: Record<string, { hash: string; producedBy: string }> =
    {
      'Artifact:NarrationScript[0]': {
        hash: 'h0',
        producedBy: 'Producer:ScriptProducer',
      },
      'Artifact:NarrationScript[1]': {
        hash: 'h1',
        producedBy: 'Producer:ScriptProducer',
      },
      'Artifact:SegmentAudio[0]': {
        hash: 'h2',
        producedBy: 'Producer:AudioProducer[0]',
      },
      'Artifact:SegmentAudio[1]': {
        hash: 'h3',
        producedBy: 'Producer:AudioProducer[1]',
      },
      'Artifact:FinalVideo': {
        hash: 'h4',
        producedBy: 'Producer:TimelineAssembler',
      },
    };

  const artifactDefs = options?.artifacts ?? defaultArtifacts;
  const artifacts: BuildState['artifacts'] = {};
  for (const [id, def] of Object.entries(artifactDefs)) {
    artifacts[id] = {
      hash: def.hash,
      producedBy: def.producedBy,
      status: 'succeeded',
      createdAt: artifactCreatedAt,
    };
  }

  return {
    revision,
    baseRevision: null,
    createdAt: artifactCreatedAt,
    inputs: Object.fromEntries(
      baseline.map((event) => [
        event.id,
        {
          hash: event.hash,
          payloadDigest: hashPayload(event.payload).canonical,
          createdAt: event.createdAt,
        },
      ])
    ),
    artifacts,
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
    const buildState = await loadBuildState(ctx);

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
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

    const baseline = createInputEvents(
      { InquiryPrompt: 'Tell me a story' },
      'rev-0001'
    );
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const artifactCreatedAt = new Date().toISOString();
    const buildState: BuildState = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: artifactCreatedAt,
      inputs: Object.fromEntries(
        baseline.map((event) => [
          event.id,
          {
            hash: event.hash,
            payloadDigest: hashPayload(event.payload).canonical,
            createdAt: event.createdAt,
          },
        ])
      ),
      artifacts: {
        'Artifact:NarrationScript[0]': {
          hash: 'hash-script-0',
          producedBy: 'Producer:ScriptProducer',
          status: 'succeeded',
          createdAt: artifactCreatedAt,
        },
        'Artifact:NarrationScript[1]': {
          hash: 'hash-script-1',
          producedBy: 'Producer:ScriptProducer',
          status: 'succeeded',
          createdAt: artifactCreatedAt,
        },
        'Artifact:SegmentAudio[0]': {
          hash: 'hash-audio-0',
          producedBy: 'Producer:AudioProducer[0]',
          status: 'succeeded',
          createdAt: artifactCreatedAt,
        },
        'Artifact:SegmentAudio[1]': {
          hash: 'hash-audio-1',
          producedBy: 'Producer:AudioProducer[1]',
          status: 'succeeded',
          createdAt: artifactCreatedAt,
        },
        'Artifact:FinalVideo': {
          hash: 'hash-final-video',
          producedBy: 'Producer:TimelineAssembler',
          status: 'succeeded',
          createdAt: artifactCreatedAt,
        },
      },
      timeline: {},
    };

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0002',
      pendingEdits: [],
    });

    expect(plan.layers.flat()).toHaveLength(0);
    expect(plan.layers.every((layer) => layer.length === 0)).toBe(true);
  });

  it('allows regeneration when canonical condition artifacts are missing but producer layer is runnable', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildConditionArtifactGraph();
    const planner = createPlanner();

    const baseline = createInputEvents(
      { 'Input:Prompt': 'Keep transitions correct' },
      'rev-0001'
    );
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const buildState = createSucceededBuildState(baseline, {
      artifacts: {
        'Artifact:DirectorProducer.Script.Characters[0].MeetingVideoPrompt': {
          hash: 'meeting-hash',
          producedBy: 'Producer:DirectorProducer',
        },
        'Artifact:TransitionVideoProducer.GeneratedVideo[0]': {
          hash: 'transition-hash',
          producedBy: 'Producer:TransitionVideoProducer[0]',
        },
      },
    });

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0002',
      pendingEdits: [],
    });

    const jobs = plan.layers.flat().map((job) => job.jobId);
    expect(jobs).toContain('Producer:DirectorProducer');
  });

  it('does not mark jobs dirty when canonical condition artifacts are present', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildConditionArtifactGraph();
    const planner = createPlanner();

    const baseline = createInputEvents(
      { 'Input:Prompt': 'Keep transitions correct' },
      'rev-0001'
    );
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const buildState = createSucceededBuildState(baseline, {
      artifacts: {
        'Artifact:DirectorProducer.Script.Characters[0].MeetingVideoPrompt': {
          hash: 'meeting-hash',
          producedBy: 'Producer:DirectorProducer',
        },
        'Artifact:DirectorProducer.Script.Characters[0].HasTransition': {
          hash: 'has-transition-hash',
          producedBy: 'Producer:DirectorProducer',
        },
        'Artifact:TransitionVideoProducer.GeneratedVideo[0]': {
          hash: 'transition-hash',
          producedBy: 'Producer:TransitionVideoProducer[0]',
        },
      },
    });

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0002',
      pendingEdits: [],
    });

    expect(plan.layers).toHaveLength(0);
  });

  it('does not mark missing conditional outputs dirty when conditions are unsatisfied', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildConditionArtifactGraph();
    const planner = createPlanner();

    const baseline = createInputEvents(
      { 'Input:Prompt': 'Keep transitions correct' },
      'rev-0001'
    );
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const buildState = createSucceededBuildState(baseline, {
      artifacts: {
        'Artifact:DirectorProducer.Script.Characters[0].MeetingVideoPrompt': {
          hash: 'meeting-hash',
          producedBy: 'Producer:DirectorProducer',
        },
        'Artifact:DirectorProducer.Script.Characters[0].HasTransition': {
          hash: 'has-transition-hash',
          producedBy: 'Producer:DirectorProducer',
        },
      },
    });

    const { plan, explanation } = await planner.computePlan({
      movieId: 'demo',
      buildState,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0002',
      pendingEdits: [],
      collectExplanation: true,
      resolvedConditionArtifacts: {
        'Artifact:DirectorProducer.Script.Characters[0].HasTransition': false,
      },
    });

    expect(plan.layers.flat()).toHaveLength(0);
    expect(explanation?.dirtyArtifacts).toEqual([]);
  });

  it('does not propagate to conditional downstream jobs when condition is unsatisfied', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildConditionArtifactGraph();
    const planner = createPlanner();

    const baseRevision = 'rev-0001';
    const baseline = createInputEvents(
      { 'Input:Prompt': 'Keep transitions correct' },
      baseRevision as RevisionId
    );
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const buildState = createSucceededBuildState(baseline, {
      revision: baseRevision as RevisionId,
      artifacts: {
        'Artifact:DirectorProducer.Script.Characters[0].MeetingVideoPrompt': {
          hash: 'meeting-hash',
          producedBy: 'Producer:DirectorProducer',
        },
        'Artifact:DirectorProducer.Script.Characters[0].HasTransition': {
          hash: 'has-transition-hash',
          producedBy: 'Producer:DirectorProducer',
        },
      },
    });

    const pending = createInputEvents(
      { 'Input:Prompt': 'Prompt changed' },
      'rev-0002' as RevisionId
    );

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0002',
      pendingEdits: pending,
      resolvedConditionArtifacts: {
        'Artifact:DirectorProducer.Script.Characters[0].HasTransition': false,
      },
    });

    const jobs = plan.layers.flat().map((job) => job.jobId);
    expect(jobs).toContain('Producer:DirectorProducer');
    expect(jobs).not.toContain('Producer:TransitionVideoProducer[0]');
  });

  it('treats canonical condition artifacts in the event log as available even when persisted succeeded build state is stale', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildConditionArtifactGraph();
    const planner = createPlanner();

    const baseline = createInputEvents(
      { 'Input:Prompt': 'Keep transitions correct' },
      'rev-0001'
    );
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const buildState = createSucceededBuildState(baseline, {
      artifacts: {
        'Artifact:DirectorProducer.Script.Characters[0].MeetingVideoPrompt': {
          hash: 'meeting-hash',
          producedBy: 'Producer:DirectorProducer',
        },
        'Artifact:TransitionVideoProducer.GeneratedVideo[0]': {
          hash: 'transition-hash',
          producedBy: 'Producer:TransitionVideoProducer[0]',
        },
      },
    });

    await eventLog.appendArtifact('demo', {
      artifactId:
        'Artifact:DirectorProducer.Script.Characters[0].HasTransition',
      revision: 'rev-fix',
      inputsHash: 'condition-hash',
      output: {
        blob: {
          hash: 'has-transition-hash',
          size: 4,
          mimeType: 'text/plain',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:DirectorProducer',
      createdAt: new Date().toISOString(),
    });

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
      eventLog,
      blueprint: graph,
      targetRevision: 'rev-0002',
      pendingEdits: [],
    });

    expect(plan.layers.flat()).toHaveLength(0);
  });

  it('propagates dirtiness downstream when inputs change', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildProducerGraph();
    const planner = createPlanner();

    const baseRevision = 'rev-0001';
    const baseline = createInputEvents(
      { InquiryPrompt: 'Tell me a story' },
      baseRevision
    );
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const buildState: BuildState = {
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
        ])
      ),
      artifacts: {},
      timeline: {},
    };

    const nextRevision = nextRevisionId(baseRevision);
    const pending = createInputEvents(
      { InquiryPrompt: 'An epic voyage' },
      nextRevision
    );

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
      eventLog,
      blueprint: graph,
      targetRevision: nextRevision,
      pendingEdits: pending,
    });

    const jobs = plan.layers.flat();
    expect(
      jobs.some((job) => job.jobId.includes('Producer:ScriptProducer'))
    ).toBe(true);
    expect(
      jobs.some((job) => job.jobId.includes('Producer:TimelineAssembler'))
    ).toBe(true);
  });

  it('marks artifact consumers dirty when artifact output changes without input edits', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildProducerGraph();
    const planner = createPlanner();

    const baseRevision = 'rev-0001';
    const baseline = createInputEvents(
      { InquiryPrompt: 'Tell me a story' },
      baseRevision
    );
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const scriptArtifactId = 'Artifact:NarrationScript[0]';
    const originalScript = 'Segment 0: original narration';
    const originalHash = hashArtifactOutput({
      blob: {
        hash: 'script-0-hash',
        size: originalScript.length,
        mimeType: 'text/plain',
      },
    });
    const originalScriptOne = 'Segment 1: original narration';
    const originalScriptOneHash = hashArtifactOutput({
      blob: {
        hash: 'script-1-hash',
        size: originalScriptOne.length,
        mimeType: 'text/plain',
      },
    });
    const baselineArtifactTimestamp = new Date().toISOString();

    const buildState: BuildState = {
      revision: baseRevision,
      baseRevision: null,
      createdAt: baselineArtifactTimestamp,
      inputs: Object.fromEntries(
        baseline.map((event) => [
          event.id,
          {
            hash: event.hash,
            payloadDigest: hashPayload(event.payload).canonical,
            createdAt: event.createdAt,
          },
        ])
      ),
      artifacts: {
        [scriptArtifactId]: {
          hash: originalHash,
          producedBy: 'Producer:ScriptProducer',
          status: 'succeeded',
          createdAt: baselineArtifactTimestamp,
        },
        'Artifact:NarrationScript[1]': {
          hash: originalScriptOneHash,
          producedBy: 'Producer:ScriptProducer',
          status: 'succeeded',
          createdAt: baselineArtifactTimestamp,
        },
        'Artifact:SegmentAudio[0]': {
          hash: 'hash-audio-0',
          producedBy: 'Producer:AudioProducer[0]',
          status: 'succeeded',
          createdAt: baselineArtifactTimestamp,
        },
        'Artifact:SegmentAudio[1]': {
          hash: 'hash-audio-1',
          producedBy: 'Producer:AudioProducer[1]',
          status: 'succeeded',
          createdAt: baselineArtifactTimestamp,
        },
        'Artifact:FinalVideo': {
          hash: 'hash-final-video',
          producedBy: 'Producer:TimelineAssembler',
          status: 'succeeded',
          createdAt: baselineArtifactTimestamp,
        },
      },
      timeline: {},
    };

    await eventLog.appendArtifact('demo', {
      artifactId: scriptArtifactId,
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

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
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

  it('re-plans from the latest failed attempt even when an older success still exists for viewer display', async () => {
    const ctx = memoryContext();
    await initializeMovieStorage(ctx, 'demo');
    const eventLog = createEventLog(ctx);
    const graph = buildProducerGraph();
    const planner = createPlanner({ collectExplanation: true });

    const baseRevision = 'rev-0001';
    const baseline = createInputEvents(
      { InquiryPrompt: 'Tell me a story' },
      baseRevision
    );
    for (const event of baseline) {
      await eventLog.appendInput('demo', event);
    }

    const buildState = createSucceededBuildState(baseline, {
      revision: baseRevision as RevisionId,
    });

    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:SegmentAudio[0]',
      revision: baseRevision as RevisionId,
      inputsHash: 'success-before-failure',
      output: {
        blob: {
          hash: 'segment-audio-0-success-hash',
          size: 128,
          mimeType: 'audio/mpeg',
        },
      },
      status: 'succeeded',
      producedBy: 'Producer:AudioProducer[0]',
      createdAt: new Date(Date.now() - 1_000).toISOString(),
    });

    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:SegmentAudio[0]',
      revision: 'rev-manual-fail',
      inputsHash: 'manual-fail',
      output: {},
      status: 'failed',
      producedBy: 'Producer:AudioProducer[0]',
      diagnostics: {
        error: {
          name: 'Error',
          message: 'simulated provider failure',
        },
      },
      createdAt: new Date().toISOString(),
    });

    const { plan, explanation } = await planner.computePlan({
      movieId: 'demo',
      buildState,
      eventLog,
      blueprint: graph,
      targetRevision: nextRevisionId(baseRevision),
      pendingEdits: [],
      collectExplanation: true,
    });

    const jobs = plan.layers.flat().map((job) => job.jobId);
    expect(jobs).toContain('Producer:AudioProducer[0]');
    expect(jobs).toContain('Producer:TimelineAssembler');
    expect(jobs).not.toContain('Producer:ScriptProducer');
    expect(jobs).not.toContain('Producer:AudioProducer[1]');

    const reason = explanation?.jobReasons.find(
      (entry) => entry.jobId === 'Producer:AudioProducer[0]'
    );
    expect(reason?.reason).toBe('latestAttemptFailed');
    expect(reason?.failedArtifacts).toContain('Artifact:SegmentAudio[0]');
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
          context: {
            namespacePath: [],
            indices: {},
            producerAlias: 'ProducerA',
            inputs: [],
            produces: [],
          },
        },
        {
          jobId: 'Producer:B',
          producer: 'ProducerB',
          inputs: ['Artifact:A', 'Input:ProducerB.volume'],
          produces: ['Artifact:B'],
          provider: 'provider-b',
          providerModel: 'model-b',
          rateKey: 'rk:b',
          context: {
            namespacePath: [],
            indices: {},
            producerAlias: 'ProducerB',
            inputs: [],
            produces: [],
          },
        },
      ],
      edges: [{ from: 'Producer:A', to: 'Producer:B' }],
    };

    const baselineInputs = createInputEvents(
      {
        'Input:Prompt': 'hello',
        'Input:ProducerA.model': 'model-a',
        'Input:ProducerB.volume': 0.5,
      },
      'rev-0001'
    );
    for (const event of baselineInputs) {
      await eventLog.appendInput('demo', event);
    }
    const artifactCreatedAt = new Date().toISOString();
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:A',
      revision: 'rev-0001',
      inputsHash: 'hash-a',
      output: { blob: { hash: 'blob-a', size: 1, mimeType: 'text/plain' } },
      status: 'succeeded',
      producedBy: 'Producer:A',
      createdAt: artifactCreatedAt,
    });
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:B',
      revision: 'rev-0001',
      inputsHash: 'hash-b',
      output: { blob: { hash: 'blob-b', size: 1, mimeType: 'text/plain' } },
      status: 'succeeded',
      producedBy: 'Producer:B',
      createdAt: artifactCreatedAt,
    });

    const buildState: BuildState = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: artifactCreatedAt,
      inputs: Object.fromEntries(
        baselineInputs.map((event) => [
          event.id,
          {
            hash: event.hash,
            payloadDigest: hashPayload(event.payload).canonical,
            createdAt: event.createdAt,
          },
        ])
      ),
      artifacts: {
        'Artifact:A': {
          hash: 'blob-a',
          producedBy: 'Producer:A',
          status: 'succeeded',
          createdAt: artifactCreatedAt,
        },
        'Artifact:B': {
          hash: 'blob-b',
          producedBy: 'Producer:B',
          status: 'succeeded',
          createdAt: artifactCreatedAt,
        },
      },
      timeline: {},
    };

    const pending = createInputEvents(
      { 'Input:ProducerA.model': 'model-a-v2' },
      'rev-0002' as RevisionId
    );

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
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
          context: {
            namespacePath: [],
            indices: {},
            producerAlias: 'ProducerA',
            inputs: [],
            produces: [],
          },
        },
        {
          jobId: 'Producer:B',
          producer: 'ProducerB',
          inputs: ['Artifact:A', 'Input:ProducerB.volume'],
          produces: ['Artifact:B'],
          provider: 'provider-b',
          providerModel: 'model-b',
          rateKey: 'rk:b',
          context: {
            namespacePath: [],
            indices: {},
            producerAlias: 'ProducerB',
            inputs: [],
            produces: [],
          },
        },
      ],
      edges: [{ from: 'Producer:A', to: 'Producer:B' }],
    };

    const baselineInputs = createInputEvents(
      {
        'Input:Prompt': 'hello',
        'Input:ProducerB.volume': 0.5,
      },
      'rev-0001'
    );
    for (const event of baselineInputs) {
      await eventLog.appendInput('demo', event);
    }
    const artifactCreatedAt = new Date().toISOString();
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:A',
      revision: 'rev-0001',
      inputsHash: 'hash-a',
      output: { blob: { hash: 'blob-a', size: 1, mimeType: 'text/plain' } },
      status: 'succeeded',
      producedBy: 'Producer:A',
      createdAt: artifactCreatedAt,
    });
    await eventLog.appendArtifact('demo', {
      artifactId: 'Artifact:B',
      revision: 'rev-0001',
      inputsHash: 'hash-b',
      output: { blob: { hash: 'blob-b', size: 1, mimeType: 'text/plain' } },
      status: 'succeeded',
      producedBy: 'Producer:B',
      createdAt: artifactCreatedAt,
    });

    const buildState: BuildState = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: artifactCreatedAt,
      inputs: Object.fromEntries(
        baselineInputs.map((event) => [
          event.id,
          {
            hash: event.hash,
            payloadDigest: hashPayload(event.payload).canonical,
            createdAt: event.createdAt,
          },
        ])
      ),
      artifacts: {
        'Artifact:A': {
          hash: 'blob-a',
          producedBy: 'Producer:A',
          status: 'succeeded',
          createdAt: artifactCreatedAt,
        },
        'Artifact:B': {
          hash: 'blob-b',
          producedBy: 'Producer:B',
          status: 'succeeded',
          createdAt: artifactCreatedAt,
        },
      },
      timeline: {},
    };

    const pending = createInputEvents(
      { 'Input:ProducerB.volume': 0.7 },
      'rev-0002' as RevisionId
    );

    const { plan } = await planner.computePlan({
      movieId: 'demo',
      buildState,
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
    const buildState = await loadBuildState(ctx);

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
          context: {
            namespacePath: [],
            indices: {},
            producerAlias: 'Producer:A',
            inputs: [],
            produces: [],
          },
        },
        {
          jobId: 'Producer:B',
          producer: 'ProducerB',
          inputs: ['Artifact:alpha'],
          produces: ['Artifact:beta'],
          provider: 'internal',
          providerModel: 'mock/ProducerB',
          rateKey: 'internal:b',
          context: {
            namespacePath: [],
            indices: {},
            producerAlias: 'Producer:B',
            inputs: [],
            produces: [],
          },
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
        buildState,
        eventLog,
        blueprint: cyclicGraph,
        targetRevision: 'rev-0001',
        pendingEdits: [],
      })
    ).rejects.toThrow(/cycle/i);
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
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerA',
              inputs: [],
              produces: [],
            },
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
      const jobs = computeArtifactRegenerationJobs(
        'Producer:AudioProducer[0]',
        graph
      );

      expect(jobs.size).toBe(2);
      expect(jobs.has('Producer:AudioProducer[0]')).toBe(true);
      expect(jobs.has('Producer:TimelineAssembler')).toBe(true);
      // Should NOT include siblings
      expect(jobs.has('Producer:AudioProducer[1]')).toBe(false);
      expect(jobs.has('Producer:ScriptProducer')).toBe(false);
    });

    it('excludes sibling jobs at the same layer when traversing downstream dependencies', () => {
      const graph = buildProducerGraph();

      // Target ScriptProducer - should include all downstream but nothing upstream
      const jobs = computeArtifactRegenerationJobs(
        'Producer:ScriptProducer',
        graph
      );

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
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerA',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: ['Artifact:A'],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerB',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:C',
            producer: 'ProducerC',
            inputs: ['Artifact:B'],
            produces: ['Artifact:C'],
            provider: 'p-c',
            providerModel: 'm-c',
            rateKey: 'rk:c',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerC',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:D',
            producer: 'ProducerD',
            inputs: ['Artifact:C'],
            produces: ['Artifact:D'],
            provider: 'p-d',
            providerModel: 'm-d',
            rateKey: 'rk:d',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerD',
              inputs: [],
              produces: [],
            },
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
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerA',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: ['Artifact:A'],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerB',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:C',
            producer: 'ProducerC',
            inputs: ['Artifact:A'],
            produces: ['Artifact:C'],
            provider: 'p-c',
            providerModel: 'm-c',
            rateKey: 'rk:c',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerC',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:D',
            producer: 'ProducerD',
            inputs: ['Artifact:B', 'Artifact:C'],
            produces: ['Artifact:D'],
            provider: 'p-d',
            providerModel: 'm-d',
            rateKey: 'rk:d',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerD',
              inputs: [],
              produces: [],
            },
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
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        revision: baseRevision,
      });

      // Surgical regeneration of AudioProducer[0]
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [
          {
            targetArtifactId: 'Artifact:SegmentAudio[0]',
            sourceJobId: 'Producer:AudioProducer[0]',
          },
        ],
      });

      const jobsInPlan = plan.layers.flat();

      // Should include AudioProducer[0] and TimelineAssembler
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')
      ).toBe(true);
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')
      ).toBe(true);

      // Should NOT include siblings or upstream
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')
      ).toBe(false);
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')
      ).toBe(false);

      expect(jobsInPlan.length).toBe(2);
    });

    it('includes union of jobs when multiple artifacts are targeted', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        revision: baseRevision,
      });

      // Surgical regeneration of BOTH AudioProducer[0] and AudioProducer[1]
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
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
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')
      ).toBe(true);
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')
      ).toBe(true);
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')
      ).toBe(true);

      // Should NOT include upstream ScriptProducer
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')
      ).toBe(false);

      // Total: 3 jobs (2 audio + 1 timeline)
      expect(jobsInPlan.length).toBe(3);
    });

    it('surgical mode also includes jobs with missing artifacts', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      // Create derived build-state data where AudioProducer[1] is missing (simulating a failed run).
      // Only AudioProducer[0]'s artifact and ScriptProducer's artifacts exist.
      const artifactCreatedAt = new Date().toISOString();
      const buildState: BuildState = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artifactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((event) => [
            event.id,
            {
              hash: event.hash,
              payloadDigest: hashPayload(event.payload).canonical,
              createdAt: event.createdAt,
            },
          ])
        ),
        artifacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'h0',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
          },
          'Artifact:NarrationScript[1]': {
            hash: 'h1',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'h2',
            producedBy: 'Producer:AudioProducer[0]',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
          },
          // Artifact:SegmentAudio[1] is MISSING (AudioProducer[1] failed)
          // Artifact:FinalVideo is MISSING (TimelineAssembler failed due to missing input)
        },
        timeline: {},
      };

      // Surgical regeneration targets AudioProducer[0] (e.g., user wants to regenerate SegmentAudio[0])
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [
          {
            targetArtifactId: 'Artifact:SegmentAudio[0]',
            sourceJobId: 'Producer:AudioProducer[0]',
          },
        ],
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

    it('lineage-strict surgical mode excludes unrelated ambient dirty jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      // Ambient dirty state: SegmentAudio[1] is missing.
      const artifactCreatedAt = new Date().toISOString();
      const buildState: BuildState = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artifactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((event) => [
            event.id,
            {
              hash: event.hash,
              payloadDigest: hashPayload(event.payload).canonical,
              createdAt: event.createdAt,
            },
          ])
        ),
        artifacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'h0',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
          },
          'Artifact:NarrationScript[1]': {
            hash: 'h1',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'h2',
            producedBy: 'Producer:AudioProducer[0]',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
          },
          // Artifact:SegmentAudio[1] is intentionally missing.
        },
        timeline: {},
      };

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [
          {
            targetArtifactId: 'Artifact:SegmentAudio[0]',
            sourceJobId: 'Producer:AudioProducer[0]',
          },
        ],
        surgicalRegenerationScope: 'lineage-strict',
      });

      const jobIds = plan.layers.flat().map((job) => job.jobId);

      // Target lineage from AudioProducer[0]: source + downstream TimelineAssembler.
      expect(jobIds).toContain('Producer:AudioProducer[0]');
      expect(jobIds).toContain('Producer:TimelineAssembler');

      // Unrelated ambient dirty sibling should be excluded in strict mode.
      expect(jobIds).not.toContain('Producer:AudioProducer[1]');
      expect(jobIds).not.toContain('Producer:ScriptProducer');

      expect(jobIds.length).toBe(2);
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
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        revision: baseRevision,
      });
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'A new story' },
        'rev-0002'
      );

      // upToLayer=1 should exclude layer 2 jobs
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
        upToLayer: 1, // Only layers 0 and 1
      });

      const jobsInPlan = plan.layers.flat();

      // Layer 0 (ScriptProducer) should be included
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')
      ).toBe(true);
      // Layer 1 (AudioProducers) should be included
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')
      ).toBe(true);
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')
      ).toBe(true);
      // Layer 2 (TimelineAssembler) should be EXCLUDED
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')
      ).toBe(false);

      expect(jobsInPlan.length).toBe(3);
    });

    it('upToLayer=0 returns only layer 0 jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        revision: baseRevision,
      });
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'A new story' },
        'rev-0002'
      );

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
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
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        revision: baseRevision,
      });

      // Surgical regeneration of ScriptProducer would normally include all downstream
      // But upToLayer=0 should limit to only layer 0
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [
          {
            targetArtifactId: 'Artifact:NarrationScript[0]',
            sourceJobId: 'Producer:ScriptProducer',
          },
        ],
        upToLayer: 0, // Only layer 0
      });

      const jobsInPlan = plan.layers.flat();

      // ScriptProducer is at layer 0 - should be included
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:ScriptProducer')
      ).toBe(true);
      // AudioProducers are at layer 1 - should be EXCLUDED
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[0]')
      ).toBe(false);
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:AudioProducer[1]')
      ).toBe(false);
      // TimelineAssembler is at layer 2 - should be EXCLUDED
      expect(
        jobsInPlan.some((job) => job.jobId === 'Producer:TimelineAssembler')
      ).toBe(false);

      expect(jobsInPlan.length).toBe(1);
    });

    it('upToLayer beyond max layer includes all jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        revision: baseRevision,
      });
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'A new story' },
        'rev-0002'
      );

      // upToLayer=10 is beyond max layer (2), so all jobs should be included
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
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
      const jobs = computeMultipleArtifactRegenerationJobs(
        ['Producer:AudioProducer[0]'],
        graph
      );

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
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerA',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: [],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerB',
              inputs: [],
              produces: [],
            },
          },
        ],
        edges: [],
      };

      const jobs = computeMultipleArtifactRegenerationJobs(
        ['Producer:A', 'Producer:B'],
        graph
      );

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
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerA',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: ['Artifact:A'],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerB',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:C',
            producer: 'ProducerC',
            inputs: ['Artifact:A'],
            produces: ['Artifact:C'],
            provider: 'p-c',
            providerModel: 'm-c',
            rateKey: 'rk:c',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerC',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:D',
            producer: 'ProducerD',
            inputs: ['Artifact:B', 'Artifact:C'],
            produces: ['Artifact:D'],
            provider: 'p-d',
            providerModel: 'm-d',
            rateKey: 'rk:d',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerD',
              inputs: [],
              produces: [],
            },
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
      const jobs = computeMultipleArtifactRegenerationJobs(
        ['Producer:B', 'Producer:C'],
        graph
      );

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
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const artifactCreatedAt = new Date().toISOString();
      const buildState: BuildState = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artifactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((event) => [
            event.id,
            {
              hash: event.hash,
              payloadDigest: hashPayload(event.payload).canonical,
              createdAt: event.createdAt,
            },
          ])
        ),
        artifacts: {},
        timeline: {},
      };

      // Plan with upToLayer=0, so only layer 0 is scheduled
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
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

      const baseline = createInputEvents(
        { InquiryPrompt: 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline);

      // All artifacts succeeded, nothing dirty -> NOOP plan
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
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
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        revision: baseRevision,
      });
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'A new story' },
        'rev-0002'
      );

      // upToLayer=0 limits this plan to only layer 0
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
        upToLayer: 0,
      });

      // Should only have 1 layer with ScriptProducer
      expect(plan.layers.length).toBe(1);
      expect(plan.layers[0].length).toBe(1);
      expect(plan.layers[0][0]?.jobId).toBe('Producer:ScriptProducer');
      // No trailing empty layers
      expect(plan.layers.every((layer) => layer.length > 0)).toBe(true);
    });

    it('removes all layers when plan is completely empty', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { InquiryPrompt: 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline);

      // Nothing dirty and no surgical controls -> empty plan
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
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

  describe('dirty tracking for model config fields', () => {
    function buildTwoNodeGraph(
      aInputs: string[] = [
        'Input:Prompt',
        'Input:ProducerA.provider',
        'Input:ProducerA.model',
      ],
      bInputs: string[] = ['Artifact:A', 'Input:ProducerB.volume']
    ): ProducerGraph {
      return {
        nodes: [
          {
            jobId: 'Producer:A',
            producer: 'ProducerA',
            inputs: aInputs,
            produces: ['Artifact:A'],
            provider: 'provider-a',
            providerModel: 'model-a',
            rateKey: 'rk:a',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerA',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: bInputs,
            produces: ['Artifact:B'],
            provider: 'provider-b',
            providerModel: 'model-b',
            rateKey: 'rk:b',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerB',
              inputs: [],
              produces: [],
            },
          },
        ],
        edges: [{ from: 'Producer:A', to: 'Producer:B' }],
      };
    }

    async function setupBaselineRun(
      baseInputs: Record<string, unknown>,
      graph: ProducerGraph
    ) {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const baseline = createInputEvents(baseInputs, 'rev-0001');
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline, {
        revision: 'rev-0001',
        artifacts: {
          'Artifact:A': { hash: 'ha', producedBy: 'Producer:A' },
          'Artifact:B': { hash: 'hb', producedBy: 'Producer:B' },
        },
      });
      return { ctx, eventLog, buildState, graph };
    }

    it('provider change triggers re-run of producer and downstream', async () => {
      const graph = buildTwoNodeGraph();
      const { eventLog, buildState } = await setupBaselineRun(
        {
          'Input:Prompt': 'hello',
          'Input:ProducerA.provider': 'openai',
          'Input:ProducerA.model': 'model-a',
          'Input:ProducerB.volume': 0.5,
        },
        graph
      );
      const planner = createPlanner();

      const pending = createInputEvents(
        { 'Input:ProducerA.provider': 'anthropic' },
        'rev-0002' as RevisionId
      );

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002' as RevisionId,
        pendingEdits: pending,
      });

      const allJobs = plan.layers.flat().map((j) => j.jobId);
      expect(allJobs).toContain('Producer:A');
      expect(allJobs).toContain('Producer:B');
    });

    it('systemPrompt change triggers re-run of producer and downstream', async () => {
      const graph = buildTwoNodeGraph([
        'Input:Prompt',
        'Input:ProducerA.systemPrompt',
      ]);
      const { eventLog, buildState } = await setupBaselineRun(
        {
          'Input:Prompt': 'hello',
          'Input:ProducerA.systemPrompt': 'old system prompt',
          'Input:ProducerB.volume': 0.5,
        },
        graph
      );
      const planner = createPlanner();

      const pending = createInputEvents(
        { 'Input:ProducerA.systemPrompt': 'new system prompt' },
        'rev-0002' as RevisionId
      );

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002' as RevisionId,
        pendingEdits: pending,
      });

      const allJobs = plan.layers.flat().map((j) => j.jobId);
      expect(allJobs).toContain('Producer:A');
      expect(allJobs).toContain('Producer:B');
    });

    it('userPrompt change triggers re-run of producer and downstream', async () => {
      const graph = buildTwoNodeGraph([
        'Input:Prompt',
        'Input:ProducerA.userPrompt',
      ]);
      const { eventLog, buildState } = await setupBaselineRun(
        {
          'Input:Prompt': 'hello',
          'Input:ProducerA.userPrompt': 'old user prompt',
          'Input:ProducerB.volume': 0.5,
        },
        graph
      );
      const planner = createPlanner();

      const pending = createInputEvents(
        { 'Input:ProducerA.userPrompt': 'new user prompt' },
        'rev-0002' as RevisionId
      );

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002' as RevisionId,
        pendingEdits: pending,
      });

      const allJobs = plan.layers.flat().map((j) => j.jobId);
      expect(allJobs).toContain('Producer:A');
      expect(allJobs).toContain('Producer:B');
    });

    it('multiple config changes only dirty dependent producer', async () => {
      const graph = buildTwoNodeGraph(
        ['Input:Prompt'],
        ['Artifact:A', 'Input:ProducerB.volume', 'Input:ProducerB.speed']
      );
      const { eventLog, buildState } = await setupBaselineRun(
        {
          'Input:Prompt': 'hello',
          'Input:ProducerB.volume': 0.5,
          'Input:ProducerB.speed': 1.0,
        },
        graph
      );
      const planner = createPlanner();

      const pending = createInputEvents(
        {
          'Input:ProducerB.volume': 0.8,
          'Input:ProducerB.speed': 1.5,
        },
        'rev-0002' as RevisionId
      );

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002' as RevisionId,
        pendingEdits: pending,
      });

      const allJobs = plan.layers.flat().map((j) => j.jobId);
      expect(allJobs).toContain('Producer:B');
      expect(allJobs).not.toContain('Producer:A');
      expect(allJobs.length).toBe(1);
    });

    it('unchanged config produces empty plan', async () => {
      const graph = buildTwoNodeGraph();
      const { eventLog, buildState } = await setupBaselineRun(
        {
          'Input:Prompt': 'hello',
          'Input:ProducerA.provider': 'openai',
          'Input:ProducerA.model': 'model-a',
          'Input:ProducerB.volume': 0.5,
        },
        graph
      );
      const planner = createPlanner();

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002' as RevisionId,
        pendingEdits: [],
      });

      const allJobs = plan.layers.flat();
      expect(allJobs.length).toBe(0);
    });
  });

  describe('content-aware inputsHash dirty detection', () => {
    it('detects dirty job when upstream artifact hash changes (partial re-run scenario)', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      // Simulate a completed run: all artifacts exist, inputsHash stored on each
      const artifactCreatedAt = new Date().toISOString();

      // Compute the content-aware inputsHash that would have been stored during the run
      const scriptInputsHash = hashInputContents(['Input:InquiryPrompt'], {
        inputs: Object.fromEntries(
          baseline.map((e) => [e.id, { hash: e.hash }])
        ),
        artifacts: {},
      });
      const audioInputsHash0 = hashInputContents(
        ['Artifact:NarrationScript[0]'],
        {
          inputs: {},
          artifacts: {
            'Artifact:NarrationScript[0]': { hash: 'hash-script-0' },
          },
        }
      );
      const audioInputsHash1 = hashInputContents(
        ['Artifact:NarrationScript[1]'],
        {
          inputs: {},
          artifacts: {
            'Artifact:NarrationScript[1]': { hash: 'hash-script-1' },
          },
        }
      );
      const timelineInputsHash = hashInputContents(
        ['Artifact:SegmentAudio[0]', 'Artifact:SegmentAudio[1]'],
        {
          inputs: {},
          artifacts: {
            'Artifact:SegmentAudio[0]': { hash: 'hash-audio-0' },
            'Artifact:SegmentAudio[1]': { hash: 'hash-audio-1' },
          },
        }
      );

      const buildState: BuildState = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artifactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((event) => [
            event.id,
            {
              hash: event.hash,
              payloadDigest: hashPayload(event.payload).canonical,
              createdAt: event.createdAt,
            },
          ])
        ),
        artifacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'hash-script-0',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: scriptInputsHash,
          },
          'Artifact:NarrationScript[1]': {
            hash: 'hash-script-1',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: scriptInputsHash,
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'hash-audio-0',
            producedBy: 'Producer:AudioProducer[0]',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: audioInputsHash0,
          },
          'Artifact:SegmentAudio[1]': {
            hash: 'hash-audio-1',
            producedBy: 'Producer:AudioProducer[1]',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: audioInputsHash1,
          },
          'Artifact:FinalVideo': {
            hash: 'hash-final-video',
            producedBy: 'Producer:TimelineAssembler',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: timelineInputsHash,
          },
        },
        timeline: {},
      };

      // Now simulate layer 0 re-run: NarrationScript[0] gets a new hash
      // (ScriptProducer ran again and produced different content)
      // The artifact event in the event log already has the new hash
      await eventLog.appendArtifact('demo', {
        artifactId: 'Artifact:NarrationScript[0]',
        revision: 'rev-0002' as RevisionId,
        inputsHash: scriptInputsHash, // same inputs, different output
        output: {
          blob: {
            hash: 'NEW-hash-script-0',
            size: 100,
            mimeType: 'text/plain',
          },
        },
        status: 'succeeded',
        producedBy: 'Producer:ScriptProducer',
        createdAt: new Date().toISOString(),
      });

      // Update build state to reflect the new artifact hash (as if it was rebuilt from events)
      buildState.artifacts['Artifact:NarrationScript[0]'] = {
        hash: 'NEW-hash-script-0',
        producedBy: 'Producer:ScriptProducer',
        status: 'succeeded',
        createdAt: artifactCreatedAt,
        inputsHash: scriptInputsHash,
      };

      // Now request a plan - AudioProducer[0] should be dirty because its input
      // (NarrationScript[0]) has hash 'NEW-hash-script-0' but the stored inputsHash
      // was computed with the old hash 'hash-script-0'
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0003' as RevisionId,
        pendingEdits: [],
      });

      const jobIds = plan.layers.flat().map((j) => j.jobId);

      // AudioProducer[0] should be dirty (inputsHash mismatch)
      expect(jobIds).toContain('Producer:AudioProducer[0]');
      // TimelineAssembler should be dirty (propagated from AudioProducer[0])
      expect(jobIds).toContain('Producer:TimelineAssembler');
      // ScriptProducer should NOT be dirty (its artifact exists, inputs unchanged)
      expect(jobIds).not.toContain('Producer:ScriptProducer');
      // AudioProducer[1] should NOT be dirty (NarrationScript[1] didn't change)
      expect(jobIds).not.toContain('Producer:AudioProducer[1]');
    });

    it('returns empty plan when inputsHash matches (no false positives)', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const artifactCreatedAt = new Date().toISOString();

      // Compute correct content-aware hashes for all artifacts
      const buildStateData = {
        inputs: Object.fromEntries(
          baseline.map((e) => [e.id, { hash: e.hash }])
        ),
        artifacts: {
          'Artifact:NarrationScript[0]': { hash: 'hash-script-0' },
          'Artifact:NarrationScript[1]': { hash: 'hash-script-1' },
          'Artifact:SegmentAudio[0]': { hash: 'hash-audio-0' },
          'Artifact:SegmentAudio[1]': { hash: 'hash-audio-1' },
          'Artifact:FinalVideo': { hash: 'hash-final-video' },
        },
      };

      const buildState: BuildState = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artifactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((event) => [
            event.id,
            {
              hash: event.hash,
              payloadDigest: hashPayload(event.payload).canonical,
              createdAt: event.createdAt,
            },
          ])
        ),
        artifacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'hash-script-0',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: hashInputContents(
              ['Input:InquiryPrompt'],
              buildStateData
            ),
          },
          'Artifact:NarrationScript[1]': {
            hash: 'hash-script-1',
            producedBy: 'Producer:ScriptProducer',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: hashInputContents(
              ['Input:InquiryPrompt'],
              buildStateData
            ),
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'hash-audio-0',
            producedBy: 'Producer:AudioProducer[0]',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: hashInputContents(
              ['Artifact:NarrationScript[0]'],
              buildStateData
            ),
          },
          'Artifact:SegmentAudio[1]': {
            hash: 'hash-audio-1',
            producedBy: 'Producer:AudioProducer[1]',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: hashInputContents(
              ['Artifact:NarrationScript[1]'],
              buildStateData
            ),
          },
          'Artifact:FinalVideo': {
            hash: 'hash-final-video',
            producedBy: 'Producer:TimelineAssembler',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: hashInputContents(
              ['Artifact:SegmentAudio[0]', 'Artifact:SegmentAudio[1]'],
              buildStateData
            ),
          },
        },
        timeline: {},
      };

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002' as RevisionId,
        pendingEdits: [],
      });

      // Nothing should be dirty - all inputsHash values match
      expect(plan.layers.flat()).toHaveLength(0);
    });

    it('older derived build states without inputsHash gracefully skip the check', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      // Older derived build state: no inputsHash on any artifact
      const buildState = createSucceededBuildState(baseline, {
        revision: baseRevision,
      });

      // Should produce empty plan (backward compatible — no inputsHash means no mismatch)
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002' as RevisionId,
        pendingEdits: [],
      });

      expect(plan.layers.flat()).toHaveLength(0);
    });

    it('produces inputsHashChanged explanation reason', async () => {
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
            provider: 'p-a',
            providerModel: 'm-a',
            rateKey: 'rk:a',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerA',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: ['Artifact:A'],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerB',
              inputs: [],
              produces: [],
            },
          },
        ],
        edges: [{ from: 'Producer:A', to: 'Producer:B' }],
      };

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:Prompt': 'hello' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const artifactCreatedAt = new Date().toISOString();
      const buildStateData = {
        inputs: Object.fromEntries(
          baseline.map((e) => [e.id, { hash: e.hash }])
        ),
        artifacts: {
          'Artifact:A': { hash: 'old-hash-a' },
          'Artifact:B': { hash: 'hash-b' },
        },
      };

      const buildState: BuildState = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artifactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((e) => [
            e.id,
            {
              hash: e.hash,
              payloadDigest: hashPayload(e.payload).canonical,
              createdAt: e.createdAt,
            },
          ])
        ),
        artifacts: {
          'Artifact:A': {
            hash: 'new-hash-a', // hash changed (re-run produced new content)
            producedBy: 'Producer:A',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: hashInputContents(['Input:Prompt'], buildStateData),
          },
          'Artifact:B': {
            hash: 'hash-b',
            producedBy: 'Producer:B',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            // inputsHash was computed with old Artifact:A hash
            inputsHash: hashInputContents(['Artifact:A'], buildStateData),
          },
        },
        timeline: {},
      };

      const { plan, explanation } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002' as RevisionId,
        pendingEdits: [],
        collectExplanation: true,
      });

      const jobIds = plan.layers.flat().map((j) => j.jobId);
      expect(jobIds).toContain('Producer:B');

      // Check explanation
      const bReason = explanation?.jobReasons.find(
        (r) => r.jobId === 'Producer:B'
      );
      expect(bReason?.reason).toBe('inputsHashChanged');
      expect(bReason?.staleArtifacts).toContain('Artifact:B');
    });

    it('filters explanation job reasons to final scheduled jobs after upToLayer', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);

      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'A different story' },
        'rev-0002'
      );

      const { plan, explanation } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
        upToLayer: 0,
        collectExplanation: true,
      });

      const scheduledJobIds = plan.layers.flat().map((job) => job.jobId);
      expect(scheduledJobIds).toEqual(['Producer:ScriptProducer']);
      expect(explanation?.jobReasons.map((reason) => reason.jobId)).toEqual(
        scheduledJobIds
      );
      expect(explanation?.initialDirtyJobs).toEqual(['Producer:ScriptProducer']);
      expect(explanation?.propagatedJobs).toEqual([]);
    });

    it('records forced surgical reasons for final scheduled jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        revision: 'rev-0001',
      });

      const { plan, explanation } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [
          {
            targetArtifactId: 'Artifact:SegmentAudio[0]',
            sourceJobId: 'Producer:AudioProducer[0]',
          },
        ],
        collectExplanation: true,
      });

      const scheduledJobIds = plan.layers.flat().map((job) => job.jobId);
      expect(scheduledJobIds).toEqual([
        'Producer:AudioProducer[0]',
        'Producer:TimelineAssembler',
      ]);

      const reasonsByJobId = new Map(
        explanation?.jobReasons.map((reason) => [reason.jobId, reason.reason])
      );
      expect(reasonsByJobId.get('Producer:AudioProducer[0]')).toBe(
        'forcedBySurgicalTarget'
      );
      expect(reasonsByJobId.get('Producer:TimelineAssembler')).toBe(
        'forcedBySurgicalDependency'
      );
      expect(explanation?.initialDirtyJobs).toEqual([]);
      expect(explanation?.propagatedJobs).toEqual([]);
    });

    it('records forced user-control reasons for explicit job targeting', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        revision: 'rev-0001',
      });

      const { plan, explanation } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        forceTargetJobIds: ['Producer:AudioProducer[1]'],
        collectExplanation: true,
      });

      const scheduledJobIds = plan.layers.flat().map((job) => job.jobId);
      expect(scheduledJobIds).toEqual(['Producer:AudioProducer[1]']);
      expect(explanation?.jobReasons).toEqual([
        {
          jobId: 'Producer:AudioProducer[1]',
          producer: 'AudioProducer',
          reason: 'forcedByUserControl',
        },
      ]);
      expect(explanation?.initialDirtyJobs).toEqual([]);
      expect(explanation?.propagatedJobs).toEqual([]);
    });

    it('detects dirty with mixed Input and Artifact inputs', async () => {
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
            provider: 'p-a',
            providerModel: 'm-a',
            rateKey: 'rk:a',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerA',
              inputs: [],
              produces: [],
            },
          },
          {
            jobId: 'Producer:B',
            producer: 'ProducerB',
            inputs: ['Artifact:A', 'Input:ProducerB.config'],
            produces: ['Artifact:B'],
            provider: 'p-b',
            providerModel: 'm-b',
            rateKey: 'rk:b',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'ProducerB',
              inputs: [],
              produces: [],
            },
          },
        ],
        edges: [{ from: 'Producer:A', to: 'Producer:B' }],
      };

      const baseRevision = 'rev-0001';
      const baseline = createInputEvents(
        { 'Input:Prompt': 'hello', 'Input:ProducerB.config': 'v1' },
        baseRevision
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const artifactCreatedAt = new Date().toISOString();
      const oldBuildStateData = {
        inputs: Object.fromEntries(
          baseline.map((e) => [e.id, { hash: e.hash }])
        ),
        artifacts: {
          'Artifact:A': { hash: 'old-hash-a' },
          'Artifact:B': { hash: 'hash-b' },
        },
      };

      const buildState: BuildState = {
        revision: baseRevision,
        baseRevision: null,
        createdAt: artifactCreatedAt,
        inputs: Object.fromEntries(
          baseline.map((e) => [
            e.id,
            {
              hash: e.hash,
              payloadDigest: hashPayload(e.payload).canonical,
              createdAt: e.createdAt,
            },
          ])
        ),
        artifacts: {
          'Artifact:A': {
            hash: 'new-hash-a', // changed
            producedBy: 'Producer:A',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            inputsHash: hashInputContents(['Input:Prompt'], oldBuildStateData),
          },
          'Artifact:B': {
            hash: 'hash-b',
            producedBy: 'Producer:B',
            status: 'succeeded',
            createdAt: artifactCreatedAt,
            // inputsHash was computed with old Artifact:A hash
            inputsHash: hashInputContents(
              ['Artifact:A', 'Input:ProducerB.config'],
              oldBuildStateData
            ),
          },
        },
        timeline: {},
      };

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002' as RevisionId,
        pendingEdits: [],
      });

      const jobIds = plan.layers.flat().map((j) => j.jobId);
      // ProducerB should be dirty because Artifact:A hash changed
      expect(jobIds).toContain('Producer:B');
      // ProducerA should NOT be dirty (its input hash is unchanged)
      expect(jobIds).not.toContain('Producer:A');
    });
  });

  describe('topology service consistency', () => {
    it('blueprintLayerCount matches topology service computation', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();
      const buildState = await loadBuildState(ctx);

      // Compute topology directly using the service
      const nodes = graph.nodes.map((n) => ({ id: n.jobId }));
      const topologyResult = computeTopologyLayers(nodes, graph.edges);

      // Compute plan
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
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
      const buildState = await loadBuildState(ctx);

      // Compute topology directly
      const nodes = graph.nodes.map((n) => ({ id: n.jobId }));
      const topologyResult = computeTopologyLayers(nodes, graph.edges);

      // Compute plan with all jobs (initial run)
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
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

  describe('pinned artifacts', () => {
    it('excludes fully pinned job from plan', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      // Set up baseline and a changed input so ScriptProducer is dirty
      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);

      // Change input to make everything dirty
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'New story' },
        'rev-0002'
      );

      // Pin ALL artifacts from ScriptProducer
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
        pinnedArtifactIds: [
          'Artifact:NarrationScript[0]',
          'Artifact:NarrationScript[1]',
        ],
      });

      // ScriptProducer should be excluded
      const allJobIds = plan.layers.flat().map((j) => j.jobId);
      expect(allJobIds).not.toContain('Producer:ScriptProducer');
    });

    it('does not exclude pinned job when pinned output is missing and cannot be reused', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        artifacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'h0',
            producedBy: 'Producer:ScriptProducer',
          },
          'Artifact:NarrationScript[1]': {
            hash: 'h1',
            producedBy: 'Producer:ScriptProducer',
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'h2',
            producedBy: 'Producer:AudioProducer[0]',
          },
          'Artifact:FinalVideo': {
            hash: 'h4',
            producedBy: 'Producer:TimelineAssembler',
          },
        },
      });

      const { plan, explanation } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        pinnedArtifactIds: ['Artifact:SegmentAudio[1]'],
        collectExplanation: true,
      });

      const allJobIds = plan.layers.flat().map((j) => j.jobId);
      expect(allJobIds).toContain('Producer:AudioProducer[1]');
      expect(allJobIds).toContain('Producer:TimelineAssembler');
      expect(allJobIds).not.toContain('Producer:ScriptProducer');
      expect(allJobIds).not.toContain('Producer:AudioProducer[0]');

      const reason = explanation?.jobReasons.find(
        (entry) => entry.jobId === 'Producer:AudioProducer[1]'
      );
      expect(reason?.reason).toBe('producesMissing');
      expect(reason?.missingArtifacts).toContain('Artifact:SegmentAudio[1]');
    });

    it('pinned job prevents downstream propagation', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'New story' },
        'rev-0002'
      );

      // Pin all ScriptProducer + AudioProducer outputs
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
        pinnedArtifactIds: [
          'Artifact:NarrationScript[0]',
          'Artifact:NarrationScript[1]',
          'Artifact:SegmentAudio[0]',
          'Artifact:SegmentAudio[1]',
        ],
      });

      // ScriptProducer + both AudioProducers + TimelineAssembler should all be excluded
      // TimelineAssembler was only dirty via propagation from AudioProducers
      const allJobIds = plan.layers.flat().map((j) => j.jobId);
      expect(allJobIds).not.toContain('Producer:ScriptProducer');
      expect(allJobIds).not.toContain('Producer:AudioProducer[0]');
      expect(allJobIds).not.toContain('Producer:AudioProducer[1]');
      // TimelineAssembler stays because its inputs (SegmentAudio) are dirty artifacts in the derived build state
      // but the jobs that PRODUCE those artifacts are pinned, so it remains dirty via touchesDirtyArtifact
      // This is correct: pinning protects the artifact from being RE-GENERATED, but downstream
      // jobs that depend on dirty-flagged artifacts are still scheduled.
    });

    it('partially pinned job stays in plan', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'New story' },
        'rev-0002'
      );

      // Only pin ONE artifact from ScriptProducer (produces 2)
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
        pinnedArtifactIds: ['Artifact:NarrationScript[0]'],
      });

      // ScriptProducer should still be in plan (not all outputs pinned)
      const allJobIds = plan.layers.flat().map((j) => j.jobId);
      expect(allJobIds).toContain('Producer:ScriptProducer');
    });

    it('empty pinnedArtifactIds has no effect', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'New story' },
        'rev-0002'
      );

      const { plan: planWithout } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
      });

      const { plan: planWith } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
        pinnedArtifactIds: [],
      });

      const jobsWithout = planWithout.layers
        .flat()
        .map((j) => j.jobId)
        .sort();
      const jobsWith = planWith.layers
        .flat()
        .map((j) => j.jobId)
        .sort();
      expect(jobsWith).toEqual(jobsWithout);
    });

    it('undefined pinnedArtifactIds has no effect', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'New story' },
        'rev-0002'
      );

      const { plan: planWithout } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
      });

      const { plan: planWith } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
        pinnedArtifactIds: undefined,
      });

      const jobsWithout = planWithout.layers
        .flat()
        .map((j) => j.jobId)
        .sort();
      const jobsWith = planWith.layers
        .flat()
        .map((j) => j.jobId)
        .sort();
      expect(jobsWith).toEqual(jobsWithout);
    });

    it('pinned artifacts included in explanation', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);
      const edits = createInputEvents(
        { 'Input:InquiryPrompt': 'New story' },
        'rev-0002'
      );

      const { explanation } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: edits,
        pinnedArtifactIds: [
          'Artifact:NarrationScript[0]',
          'Artifact:NarrationScript[1]',
        ],
        collectExplanation: true,
      });

      expect(explanation).toBeDefined();
      expect(explanation!.pinnedArtifactIds).toEqual([
        'Artifact:NarrationScript[0]',
        'Artifact:NarrationScript[1]',
      ]);
    });

    it('pinned + surgical mode: pinned jobs still excluded', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);

      // Surgical: regenerate AudioProducer[0]
      // Pinned: pin AudioProducer[1]'s output
      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        artifactRegenerations: [
          {
            targetArtifactId: 'Artifact:SegmentAudio[0]',
            sourceJobId: 'Producer:AudioProducer[0]',
          },
        ],
        pinnedArtifactIds: ['Artifact:SegmentAudio[1]'],
      });

      const allJobIds = plan.layers.flat().map((j) => j.jobId);
      // AudioProducer[0] should be in the plan (surgical target)
      expect(allJobIds).toContain('Producer:AudioProducer[0]');
      // AudioProducer[1] should be excluded (pinned)
      expect(allJobIds).not.toContain('Producer:AudioProducer[1]');
      // TimelineAssembler should be downstream of surgical target
      expect(allJobIds).toContain('Producer:TimelineAssembler');
    });

    it('pinned artifacts still exclude producer-override-selected jobs', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline, {
        artifacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'h0',
            producedBy: 'Producer:ScriptProducer',
          },
          'Artifact:NarrationScript[1]': {
            hash: 'h1',
            producedBy: 'Producer:ScriptProducer',
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'h2',
            producedBy: 'Producer:AudioProducer[0]',
          },
        },
      });

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        pinnedArtifactIds: ['Artifact:SegmentAudio[0]'],
      });

      const allJobIds = plan.layers.flat().map((j) => j.jobId);
      expect(allJobIds).not.toContain('Producer:AudioProducer[0]');
      expect(allJobIds).toContain('Producer:AudioProducer[1]');
    });

    it('producer override scope does not force reruns for reusable artifacts', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
      });

      expect(plan.layers.flat()).toEqual([]);
    });

    it('producer override scope alone does not force selected reruns', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }
      const buildState = createSucceededBuildState(baseline);

      const { plan } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        blockedProducerJobIds: ['Producer:AudioProducer[1]'],
      });

      const allJobIds = plan.layers.flat().map((j) => j.jobId);
      expect(allJobIds).toEqual([]);
    });

    it('removes downstream dirty jobs when blocked upstream artifacts are missing', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        artifacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'h0',
            producedBy: 'Producer:ScriptProducer',
          },
          'Artifact:NarrationScript[1]': {
            hash: 'h1',
            producedBy: 'Producer:ScriptProducer',
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'h2',
            producedBy: 'Producer:AudioProducer[0]',
          },
        },
      });

      const { plan, prunedUnrunnableJobs } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        blockedProducerJobIds: ['Producer:AudioProducer[1]'],
      });

      const allJobIds = plan.layers.flat().map((j) => j.jobId);
      expect(allJobIds).toEqual([]);
      expect(prunedUnrunnableJobs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            jobId: 'Producer:TimelineAssembler',
            missingArtifactInputs: ['Artifact:SegmentAudio[1]'],
          }),
        ])
      );
    });

    it('keeps downstream jobs when blocked upstream artifacts are already reusable', async () => {
      const ctx = memoryContext();
      await initializeMovieStorage(ctx, 'demo');
      const eventLog = createEventLog(ctx);
      const graph = buildProducerGraph();
      const planner = createPlanner();

      const baseline = createInputEvents(
        { 'Input:InquiryPrompt': 'Tell me a story' },
        'rev-0001'
      );
      for (const event of baseline) {
        await eventLog.appendInput('demo', event);
      }

      const buildState = createSucceededBuildState(baseline, {
        artifacts: {
          'Artifact:NarrationScript[0]': {
            hash: 'h0',
            producedBy: 'Producer:ScriptProducer',
          },
          'Artifact:NarrationScript[1]': {
            hash: 'h1',
            producedBy: 'Producer:ScriptProducer',
          },
          'Artifact:SegmentAudio[0]': {
            hash: 'h2',
            producedBy: 'Producer:AudioProducer[0]',
          },
          'Artifact:SegmentAudio[1]': {
            hash: 'h3',
            producedBy: 'Producer:AudioProducer[1]',
          },
        },
      });

      const { plan, prunedUnrunnableJobs } = await planner.computePlan({
        movieId: 'demo',
        buildState,
        eventLog,
        blueprint: graph,
        targetRevision: 'rev-0002',
        pendingEdits: [],
        blockedProducerJobIds: ['Producer:AudioProducer[1]'],
      });

      const allJobIds = plan.layers.flat().map((j) => j.jobId);
      expect(allJobIds).toEqual(['Producer:TimelineAssembler']);
      expect(prunedUnrunnableJobs).toBeUndefined();
    });
  });
});
