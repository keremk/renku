import { Buffer } from 'node:buffer';
import { describe, expect, it, vi } from 'vitest';
import { TextEncoder } from 'util';
import { createRunner } from './runner.js';
import { createEventLog } from './event-log.js';
import { createManifestService } from './manifest.js';
import { createStorageContext, initializeMovieStorage } from './storage.js';
import { formatBlobFileName } from './blob-utils.js';
import type {
  ArtefactEvent,
  ExecutionPlan,
  JobDescriptor,
  Manifest,
  ProduceRequest,
  ProduceResult,
} from './types.js';

const baseManifest: Manifest = {
  revision: 'rev-0000',
  baseRevision: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  inputs: {},
  artefacts: {},
};

const plan: ExecutionPlan = {
  revision: 'rev-0001',
  manifestBaseHash: 'hash-0000',
  layers: [
    [
      {
        jobId: 'job-1',
        producer: 'ScriptProducer',
        inputs: [],
        produces: ['Artifact:NarrationScript'],
        provider: 'openai',
        providerModel: 'openai/GPT-5',
        rateKey: 'llm:script',
      },
    ],
    [
      {
        jobId: 'job-2',
        producer: 'AudioProducer',
        inputs: ['Artifact:NarrationScript'],
        produces: ['Artifact:SegmentAudio[segment=0]'],
        provider: 'replicate',
        providerModel: 'elevenlabs/turbo-v2.5',
        rateKey: 'audio:elevenlabs-turbo',
      },
    ],
  ],
  createdAt: '2024-01-02T00:00:00.000Z',
  blueprintLayerCount: 2,
};

describe('createRunner', () => {
  it('executes layers and persists artefacts', async () => {
    const storage = createStorageContext({ kind: 'memory' });
    await initializeMovieStorage(storage, 'movie-123');
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    const produce = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      if (request.job.jobId === 'job-1') {
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [
            {
              artefactId: 'Artifact:NarrationScript',
              blob: {
                data: 'Once upon a time',
                mimeType: 'text/plain',
              },
            },
          ],
        };
      }
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: [
          {
            artefactId: 'Artifact:SegmentAudio[segment=0]',
            blob: {
              data: new TextEncoder().encode('AUDIO_DATA'),
              mimeType: 'audio/wav',
            },
          },
        ],
      };
    });

    const runner = createRunner();
    const result = await runner.execute(plan, {
      movieId: 'movie-123',
      manifest: baseManifest,
      storage,
      eventLog,
      manifestService,
      produce,
    });

    expect(produce).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('succeeded');
    expect(result.jobs).toHaveLength(2);

    const firstJob = result.jobs.find((job) => job.jobId === 'job-1');
    const firstBlob = firstJob?.artefacts[0].output.blob;
    expect('inline' in (firstJob?.artefacts[0].output ?? {})).toBe(false);
    expect(firstBlob).toBeDefined();
    expect(firstBlob?.mimeType).toBe('text/plain');
    const narrationPath = storage.resolve(
      'movie-123',
      'blobs',
      firstBlob!.hash.slice(0, 2),
      formatBlobFileName(firstBlob!.hash, firstBlob!.mimeType),
    );
    const narration = await storage.storage.readToString(narrationPath);
    expect(narration).toBe('Once upon a time');

    const audioJob = result.jobs.find((job) => job.jobId === 'job-2');
    const audioBlob = audioJob?.artefacts[0].output.blob;
    expect(audioBlob).toBeDefined();
    expect(audioBlob?.mimeType).toBe('audio/wav');
    const audioPath = storage.resolve(
      'movie-123',
      'blobs',
      audioBlob!.hash.slice(0, 2),
      formatBlobFileName(audioBlob!.hash, audioBlob!.mimeType),
    );
    const storedAudio = await storage.storage.readToUint8Array(audioPath);
    expect(Array.from(storedAudio)).toEqual(Array.from(new TextEncoder().encode('AUDIO_DATA')));

    const manifest = await result.buildManifest();
    expect(manifest.revision).toBe('rev-0001');
    expect(Object.keys(manifest.artefacts)).toContain('Artifact:NarrationScript');
    expect(Object.keys(manifest.artefacts)).toContain('Artifact:SegmentAudio[segment=0]');
  });

  it('uses stub produce when none supplied', async () => {
    const storage = createStorageContext({ kind: 'memory' });
    await initializeMovieStorage(storage, 'movie-456');
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    const runner = createRunner();
    const result = await runner.execute(plan, {
      movieId: 'movie-456',
      manifest: baseManifest,
      storage,
      eventLog,
      manifestService,
    });

    expect(result.status).toBe('succeeded');
    expect(result.jobs.every((job) => job.status === 'skipped')).toBe(true);
  });

  it('marks run as failed when job throws', async () => {
    const storage = createStorageContext({ kind: 'memory' });
    await initializeMovieStorage(storage, 'movie-error');
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    const produce = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      if (request.job.jobId === 'job-2') {
        throw new Error('boom');
      }
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: [
          {
            artefactId: 'Artifact:NarrationScript',
            blob: {
              data: 'Hello world',
              mimeType: 'text/plain',
            },
          },
        ],
      };
    });

    const runner = createRunner();
    const result = await runner.execute(plan, {
      movieId: 'movie-error',
      manifest: baseManifest,
      storage,
      eventLog,
      manifestService,
      produce,
    });

    expect(result.status).toBe('failed');
    const failedJob = result.jobs.find((job) => job.jobId === 'job-2');
    expect(failedJob?.status).toBe('failed');
    expect(failedJob?.error?.message).toContain('boom');
  });

  it('injects alias inputs derived from upstream artefacts', async () => {
    const storage = createStorageContext({ kind: 'memory' });
    await initializeMovieStorage(storage, 'movie-alias');
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);
    const aliasText = 'aliased text';
    const aliasBlobHash = 'aliastext123';
    const aliasBlobRef: ArtefactEvent['output']['blob'] = {
      hash: aliasBlobHash,
      size: aliasText.length,
      mimeType: 'text/plain',
    };
    const aliasDir = storage.resolve('movie-alias', 'blobs', aliasBlobHash.slice(0, 2));
    await storage.storage.createDirectory(aliasDir, {});
    const aliasPath = storage.resolve(
      'movie-alias',
      'blobs',
      aliasBlobHash.slice(0, 2),
      formatBlobFileName(aliasBlobHash, aliasBlobRef.mimeType),
    );
    await storage.storage.write(aliasPath, Buffer.from(aliasText), { mimeType: 'text/plain' });

    const artefactEvent: ArtefactEvent = {
      artefactId: 'Artifact:ScriptGeneration.NarrationScript[segment=0]',
      revision: 'rev-0001',
      inputsHash: 'hash',
      output: { blob: aliasBlobRef },
      status: 'succeeded',
      producedBy: 'Producer:ScriptGeneration[segment=0]',
      createdAt: new Date().toISOString(),
    };

    await eventLog.appendArtefact('movie-alias', artefactEvent);

    let observedResolvedInputs: Record<string, unknown> | undefined;

    const runner = createRunner({
      produce: async (request) => {
        observedResolvedInputs = request.job.context?.extras?.resolvedInputs as Record<string, unknown> | undefined;
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [],
        };
      },
    });

    const job: JobDescriptor = {
      jobId: 'job-alias',
      producer: 'ImagePromptGeneration.ImagePromptProducer[segment=0]',
      inputs: [
        'Artifact:ScriptGeneration.NarrationScript[segment=0]',
        'Input:ImagePromptGeneration.NarrativeText',
      ],
      produces: [],
      provider: 'openai',
      providerModel: 'gpt-5-mini',
      rateKey: 'llm:image_prompt',
      context: {
        namespacePath: ['ImagePromptGeneration'],
        indices: { segment: 0 },
        producerAlias: 'ImagePromptGeneration.ImagePromptProducer',
        inputs: [
          'Artifact:ScriptGeneration.NarrationScript[segment=0]',
          'Input:ImagePromptGeneration.NarrativeText',
        ],
        produces: [],
        inputBindings: {
          NarrativeText: 'Artifact:ScriptGeneration.NarrationScript[segment=0]',
        },
      },
    };

    const manifest: Manifest = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: new Date().toISOString(),
      inputs: {},
      artefacts: {},
    };

    await runner.executeJob(job, {
      movieId: 'movie-alias',
      storage,
      eventLog,
      manifest,
      manifestService,
      layerIndex: 0,
      attempt: 1,
      revision: 'rev-0002',
    });

    expect(
      observedResolvedInputs?.['Artifact:ScriptGeneration.NarrationScript[segment=0]'],
    ).toBe('aliased text');
  });

  it('injects fan-in groupings even when no upstream artefacts are resolved', async () => {
    const storage = createStorageContext({ kind: 'memory' });
    await initializeMovieStorage(storage, 'movie-fanin');
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    let observedResolvedInputs: Record<string, unknown> | undefined;

    const runner = createRunner({
      produce: async (request) => {
        observedResolvedInputs = request.job.context?.extras?.resolvedInputs as Record<string, unknown> | undefined;
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [],
        };
      },
    });

    const fanInJob: JobDescriptor = {
      jobId: 'job-fanin',
      producer: 'TimelineComposer.TimelineProducer',
      inputs: [
        'Input:TimelineComposer.ImageSegments',
        'Input:TimelineComposer.AudioSegments',
      ],
      produces: ['Artifact:TimelineComposer.Timeline'],
      provider: 'renku',
      providerModel: 'OrderedTimeline',
      rateKey: 'timeline:ordered',
      context: {
        namespacePath: ['TimelineComposer'],
        indices: {},
        producerAlias: 'TimelineComposer.TimelineProducer',
        inputs: [
          'Input:TimelineComposer.ImageSegments',
          'Input:TimelineComposer.AudioSegments',
        ],
        produces: ['Artifact:TimelineComposer.Timeline'],
        fanIn: {
          'Input:TimelineComposer.ImageSegments': {
            groupBy: 'segment',
            orderBy: 'image',
            members: [
              { id: 'Artifact:ImageGenerator.SegmentImage[0][0]', group: 0, order: 0 },
              { id: 'Artifact:ImageGenerator.SegmentImage[1][0]', group: 1, order: 0 },
            ],
          },
          'Input:TimelineComposer.AudioSegments': {
            groupBy: 'segment',
            members: [
              { id: 'Artifact:AudioGenerator.SegmentAudio[0]', group: 0 },
              { id: 'Artifact:AudioGenerator.SegmentAudio[1]', group: 1 },
            ],
          },
        },
      },
    };

    const manifest: Manifest = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: new Date().toISOString(),
      inputs: {},
      artefacts: {},
    };

    await runner.executeJob(fanInJob, {
      movieId: 'movie-fanin',
      storage,
      eventLog,
      manifest,
      manifestService,
      layerIndex: 0,
      attempt: 1,
      revision: 'rev-0002',
    });

    expect(observedResolvedInputs).toBeDefined();
    const imageSegments = observedResolvedInputs?.['Input:TimelineComposer.ImageSegments'] as
      | { groupBy: string; orderBy?: string; groups: string[][] }
      | undefined;
    expect(imageSegments?.groupBy).toBe('segment');
    expect(imageSegments?.orderBy).toBe('image');
    expect(imageSegments?.groups).toEqual([
      ['Artifact:ImageGenerator.SegmentImage[0][0]'],
      ['Artifact:ImageGenerator.SegmentImage[1][0]'],
    ]);

    const audioSegments = observedResolvedInputs?.['Input:TimelineComposer.AudioSegments'] as
      | { groupBy: string; groups: string[][] }
      | undefined;
    expect(audioSegments?.groupBy).toBe('segment');
    expect(audioSegments?.groups).toEqual([
      ['Artifact:AudioGenerator.SegmentAudio[0]'],
      ['Artifact:AudioGenerator.SegmentAudio[1]'],
    ]);
  });

  it('does not skip job when unconditional fanIn members exist even if conditional inputs unsatisfied', async () => {
    const storage = createStorageContext({ kind: 'memory' });
    await initializeMovieStorage(storage, 'movie-conditional-fanin');
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    // Store video artifacts that will be unconditional fanIn members
    const videoData = new TextEncoder().encode('video-data');
    const videoBlobHash = 'videohash123';
    const videoBlobRef = { hash: videoBlobHash, size: videoData.length, mimeType: 'video/mp4' };
    const videoDir = storage.resolve('movie-conditional-fanin', 'blobs', videoBlobHash.slice(0, 2));
    await storage.storage.createDirectory(videoDir, {});
    const videoPath = storage.resolve(
      'movie-conditional-fanin',
      'blobs',
      videoBlobHash.slice(0, 2),
      formatBlobFileName(videoBlobHash, videoBlobRef.mimeType),
    );
    await storage.storage.write(videoPath, Buffer.from(videoData), { mimeType: 'video/mp4' });

    // Add video artifact to event log (unconditional)
    await eventLog.appendArtefact('movie-conditional-fanin', {
      artefactId: 'Artifact:VideoProducer.GeneratedVideo[0]',
      revision: 'rev-0001',
      inputsHash: 'hash',
      output: { blob: videoBlobRef },
      status: 'succeeded',
      producedBy: 'Producer:VideoProducer[0]',
      createdAt: new Date().toISOString(),
    });

    let jobWasExecuted = false;

    const runner = createRunner({
      produce: async (request) => {
        jobWasExecuted = true;
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [],
        };
      },
    });

    // Job with:
    // - VideoSegments fanIn: unconditional members
    // - AudioSegments fanIn: conditional members (condition will be false)
    const job: JobDescriptor = {
      jobId: 'job-timeline',
      producer: 'TimelineComposer',
      inputs: [
        'Input:TimelineComposer.VideoSegments',
        'Input:TimelineComposer.AudioSegments',
      ],
      produces: ['Artifact:TimelineComposer.Timeline'],
      provider: 'renku',
      providerModel: 'timeline/ordered',
      rateKey: 'timeline:ordered',
      context: {
        namespacePath: ['TimelineComposer'],
        indices: {},
        producerAlias: 'TimelineComposer',
        inputs: [
          'Input:TimelineComposer.VideoSegments',
          'Input:TimelineComposer.AudioSegments',
        ],
        produces: ['Artifact:TimelineComposer.Timeline'],
        fanIn: {
          'Input:TimelineComposer.VideoSegments': {
            groupBy: 'clip',
            members: [
              { id: 'Artifact:VideoProducer.GeneratedVideo[0]', group: 0 },
            ],
          },
          'Input:TimelineComposer.AudioSegments': {
            groupBy: 'clip',
            members: [
              { id: 'Artifact:AudioProducer.GeneratedAudio[0]', group: 0 },
            ],
          },
        },
        // Only AudioProducer artifacts have conditions - VideoProducer is unconditional
        inputConditions: {
          'Artifact:AudioProducer.GeneratedAudio[0]': {
            condition: {
              when: 'AdScriptProducer.AdScript.Scenes[clip].HasNarration',
              is: true,
            },
            indices: { clip: 0 },
          },
        },
      },
    };

    const manifest: Manifest = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: new Date().toISOString(),
      inputs: {},
      artefacts: {},
    };

    const result = await runner.executeJob(job, {
      movieId: 'movie-conditional-fanin',
      storage,
      eventLog,
      manifest,
      manifestService,
      layerIndex: 0,
      attempt: 1,
      revision: 'rev-0002',
    });

    // Job should NOT be skipped because VideoSegments has unconditional members
    expect(jobWasExecuted).toBe(true);
    expect(result.status).toBe('succeeded');
  });

  it('skips job when all conditional inputs unsatisfied and no unconditional artifact inputs', async () => {
    const storage = createStorageContext({ kind: 'memory' });
    await initializeMovieStorage(storage, 'movie-all-conditional');
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    let jobWasExecuted = false;

    const runner = createRunner({
      produce: async (request) => {
        jobWasExecuted = true;
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [],
        };
      },
    });

    // Job where ALL fanIn members are conditional and none are satisfied
    const job: JobDescriptor = {
      jobId: 'job-all-conditional',
      producer: 'AudioConsumer',
      inputs: ['Input:AudioConsumer.AudioSegments'],
      produces: ['Artifact:AudioConsumer.Output'],
      provider: 'test',
      providerModel: 'test/model',
      rateKey: 'test:model',
      context: {
        namespacePath: ['AudioConsumer'],
        indices: {},
        producerAlias: 'AudioConsumer',
        inputs: ['Input:AudioConsumer.AudioSegments'],
        produces: ['Artifact:AudioConsumer.Output'],
        fanIn: {
          'Input:AudioConsumer.AudioSegments': {
            groupBy: 'clip',
            members: [
              { id: 'Artifact:AudioProducer.GeneratedAudio[0]', group: 0 },
              { id: 'Artifact:AudioProducer.GeneratedAudio[1]', group: 1 },
            ],
          },
        },
        // ALL members have conditions that evaluate to false
        inputConditions: {
          'Artifact:AudioProducer.GeneratedAudio[0]': {
            condition: {
              when: 'SomeProducer.Output.HasAudio',
              is: true,
            },
            indices: { clip: 0 },
          },
          'Artifact:AudioProducer.GeneratedAudio[1]': {
            condition: {
              when: 'SomeProducer.Output.HasAudio',
              is: true,
            },
            indices: { clip: 1 },
          },
        },
      },
    };

    const manifest: Manifest = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: new Date().toISOString(),
      inputs: {},
      artefacts: {},
    };

    const result = await runner.executeJob(job, {
      movieId: 'movie-all-conditional',
      storage,
      eventLog,
      manifest,
      manifestService,
      layerIndex: 0,
      attempt: 1,
      revision: 'rev-0002',
    });

    // Job SHOULD be skipped because all fanIn members are conditional and unsatisfied
    expect(jobWasExecuted).toBe(false);
    expect(result.status).toBe('skipped');
  });

  it('resolves asset data from Timeline clips into resolvedInputs for downstream consumers', async () => {
    const storage = createStorageContext({ kind: 'memory' });
    await initializeMovieStorage(storage, 'movie-asset-data');
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    const audioPayload = new TextEncoder().encode('audio-binary-data');
    let observedResolvedInputs: Record<string, unknown> | undefined;
    let observedAssetBlobPaths: Record<string, string> | undefined;

    // Plan:
    // Layer 0: AudioProducer produces audio blob
    // Layer 1: TimelineComposer produces a Timeline JSON with assetId references
    // Layer 2: TranscriptionProducer consumes Timeline — needs audio data
    const assetPlan: ExecutionPlan = {
      revision: 'rev-asset',
      manifestBaseHash: 'hash-asset',
      layers: [
        [
          {
            jobId: 'job-audio-0',
            producer: 'AudioProducer',
            inputs: [],
            produces: ['Artifact:AudioProducer.GeneratedAudio[0]'],
            provider: 'replicate',
            providerModel: 'audio/model',
            rateKey: 'audio:model',
          },
        ],
        [
          {
            jobId: 'job-timeline',
            producer: 'TimelineComposer',
            inputs: ['Input:TimelineComposer.AudioSegments'],
            produces: ['Artifact:TimelineComposer.Timeline'],
            provider: 'renku',
            providerModel: 'timeline/ordered',
            rateKey: 'timeline:ordered',
            context: {
              namespacePath: ['TimelineComposer'],
              indices: {},
              producerAlias: 'TimelineComposer',
              inputs: ['Input:TimelineComposer.AudioSegments'],
              produces: ['Artifact:TimelineComposer.Timeline'],
              fanIn: {
                'Input:TimelineComposer.AudioSegments': {
                  groupBy: 'segment',
                  members: [
                    { id: 'Artifact:AudioProducer.GeneratedAudio[0]', group: 0 },
                  ],
                },
              },
            },
          },
        ],
        [
          {
            jobId: 'job-transcription',
            producer: 'TranscriptionProducer',
            inputs: ['Artifact:TimelineComposer.Timeline'],
            produces: ['Artifact:TranscriptionProducer.Transcription'],
            provider: 'renku',
            providerModel: 'speech/transcription',
            rateKey: 'transcription:stt',
            context: {
              namespacePath: [],
              indices: {},
              producerAlias: 'TranscriptionProducer',
              inputs: ['Artifact:TimelineComposer.Timeline'],
              produces: ['Artifact:TranscriptionProducer.Transcription'],
              inputBindings: {
                Timeline: 'Artifact:TimelineComposer.Timeline',
              },
            },
          },
        ],
      ],
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 3,
    };

    const runner = createRunner({
      produce: async (request) => {
        if (request.job.jobId === 'job-audio-0') {
          return {
            jobId: request.job.jobId,
            status: 'succeeded',
            artefacts: [
              {
                artefactId: 'Artifact:AudioProducer.GeneratedAudio[0]',
                blob: { data: audioPayload, mimeType: 'audio/mpeg' },
              },
            ],
          };
        }

        if (request.job.jobId === 'job-timeline') {
          // Produce a Timeline JSON containing clips with assetId references
          const timeline = {
            id: 'timeline-1',
            duration: 10,
            tracks: [
              {
                id: 'track-0',
                kind: 'Audio',
                clips: [
                  {
                    id: 'clip-0',
                    kind: 'Audio',
                    startTime: 0,
                    duration: 10,
                    properties: {
                      assetId: 'Artifact:AudioProducer.GeneratedAudio[0]',
                      volume: 1.0,
                    },
                  },
                ],
              },
              {
                id: 'track-1',
                kind: 'Transcription',
                clips: [
                  {
                    id: 'clip-t-0',
                    kind: 'Transcription',
                    startTime: 0,
                    duration: 10,
                    properties: {
                      assetId: 'Artifact:AudioProducer.GeneratedAudio[0]',
                    },
                  },
                ],
              },
            ],
          };
          return {
            jobId: request.job.jobId,
            status: 'succeeded',
            artefacts: [
              {
                artefactId: 'Artifact:TimelineComposer.Timeline',
                blob: {
                  data: JSON.stringify(timeline),
                  mimeType: 'application/json',
                },
              },
            ],
          };
        }

        // TranscriptionProducer — capture what it receives
        observedResolvedInputs = request.job.context?.extras?.resolvedInputs as Record<string, unknown> | undefined;
        observedAssetBlobPaths = request.job.context?.extras?.assetBlobPaths as Record<string, string> | undefined;
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [],
        };
      },
    });

    const result = await runner.execute(assetPlan, {
      movieId: 'movie-asset-data',
      manifest: baseManifest,
      storage,
      eventLog,
      manifestService,
    });

    expect(result.status).toBe('succeeded');

    // TranscriptionProducer should have the Timeline in resolvedInputs
    const timeline = observedResolvedInputs?.['Artifact:TimelineComposer.Timeline'] as Record<string, unknown> | undefined;
    expect(timeline).toBeDefined();
    expect(timeline?.id).toBe('timeline-1');

    // Asset blob paths should be populated (storage-relative paths)
    expect(observedAssetBlobPaths).toBeDefined();
    expect(observedAssetBlobPaths?.['Artifact:AudioProducer.GeneratedAudio[0]']).toBeDefined();

    // Audio data should also be available in resolvedInputs (the fix!)
    // This enables handlers to access blob data directly without needing
    // to resolve storage-relative paths to absolute file paths.
    const audioData = observedResolvedInputs?.['Artifact:AudioProducer.GeneratedAudio[0]'];
    expect(audioData).toBeDefined();
    expect(audioData).toBeInstanceOf(Buffer);
    expect(Array.from(audioData as Buffer)).toEqual(Array.from(audioPayload));
  });

  it('provides fan-in artefact blobs to downstream jobs', async () => {
    const storage = createStorageContext({ kind: 'memory' });
    await initializeMovieStorage(storage, 'movie-fanin-assets');
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    const audioPayload = new TextEncoder().encode('fan-in audio');
    let observedResolvedInputs: Record<string, unknown> | undefined;

    const fanInPlan: ExecutionPlan = {
      revision: 'rev-0003',
      manifestBaseHash: 'hash-0002',
      layers: [
        [
          {
            jobId: 'job-audio',
            producer: 'AudioProducer',
            inputs: [],
            produces: ['Artifact:AudioGenerator.SegmentAudio[0]'],
            provider: 'replicate',
            providerModel: 'audio/model',
            rateKey: 'audio:model',
          },
        ],
        [
          {
            jobId: 'job-timeline',
            producer: 'TimelineProducer',
            inputs: ['Input:TimelineComposer.AudioSegments'],
            produces: ['Artifact:TimelineComposer.Timeline'],
            provider: 'renku',
            providerModel: 'OrderedTimeline',
            rateKey: 'timeline:ordered',
            context: {
              namespacePath: ['TimelineComposer'],
              indices: {},
              producerAlias: 'TimelineComposer.TimelineProducer',
              inputs: ['Input:TimelineComposer.AudioSegments'],
              produces: ['Artifact:TimelineComposer.Timeline'],
              fanIn: {
                'Input:TimelineComposer.AudioSegments': {
                  groupBy: 'segment',
                  members: [
                    { id: 'Artifact:AudioGenerator.SegmentAudio[0]', group: 0 },
                  ],
                },
              },
            },
          },
        ],
      ],
      createdAt: new Date().toISOString(),
      blueprintLayerCount: 2,
    };

    const runner = createRunner({
      produce: async (request) => {
        if (request.job.jobId === 'job-audio') {
          return {
            jobId: request.job.jobId,
            status: 'succeeded',
            artefacts: [
              {
                artefactId: 'Artifact:AudioGenerator.SegmentAudio[0]',
                blob: {
                  data: audioPayload,
                  mimeType: 'audio/mpeg',
                },
              },
            ],
          } satisfies ProduceResult;
        }

        observedResolvedInputs = request.job.context?.extras?.resolvedInputs as Record<string, unknown> | undefined;
        return {
          jobId: request.job.jobId,
          status: 'succeeded',
          artefacts: [],
        } satisfies ProduceResult;
      },
    });

    await runner.execute(fanInPlan, {
      movieId: 'movie-fanin-assets',
      manifest: baseManifest,
      storage,
      eventLog,
      manifestService,
    });

    const payload = observedResolvedInputs?.['Artifact:AudioGenerator.SegmentAudio[0]'];
    expect(payload).toBeInstanceOf(Uint8Array);
    expect(Array.from(payload as Uint8Array)).toEqual(Array.from(audioPayload));
  });
});
