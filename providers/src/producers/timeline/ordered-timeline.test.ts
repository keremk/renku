import { describe, expect, it, vi } from 'vitest';
import { createTimelineProducerHandler } from './ordered-timeline.js';
import type { ProviderJobContext } from '../../types.js';

vi.mock('mediabunny', () => {
  class MockBufferSource {
    buffer: Uint8Array;

    constructor(data: ArrayBuffer | ArrayBufferView) {
      if (data instanceof ArrayBuffer) {
        this.buffer = new Uint8Array(data);
        return;
      }
      if (ArrayBuffer.isView(data)) {
        const view = data as ArrayBufferView;
        this.buffer = new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
        return;
      }
      throw new Error('Unsupported buffer payload.');
    }
  }

  class MockInput {
    private readonly source: MockBufferSource;

    constructor(options: { source: MockBufferSource }) {
      this.source = options.source;
    }

    async computeDuration() {
      const value = this.source.buffer[0];
      if (!Number.isFinite(value)) {
        throw new Error('Missing duration byte.');
      }
      return value;
    }

    dispose() {}
  }

  return {
    Input: MockInput,
    BufferSource: MockBufferSource,
    ALL_FORMATS: [],
  } satisfies Record<string, unknown>;
});

function createHandler() {
  return createTimelineProducerHandler()({
    descriptor: { provider: 'renku', model: 'OrderedTimeline', environment: 'local' },
    mode: 'live',
    secretResolver: { getSecret: async () => null },
  });
}

function makeRequest(options: { omitAudio?: boolean; audioDurations?: number[] } = {}): ProviderJobContext {
  const imageGroups = [
    ['Artifact:Image[0][0]', 'Artifact:Image[0][1]'],
    ['Artifact:Image[1][0]'],
  ];
  const audioGroups = options.omitAudio
    ? []
    : [
        ['Artifact:Audio[0]'],
      ['Artifact:Audio[1]'],
    ];
  const audioDurations = options.audioDurations ?? [12, 8];

  const resolvedInputs: Record<string, unknown> = {
    'Input:StorageRoot': '/tmp/timeline-root',
    'Input:StorageBasePath': 'builds',
    'Input:MovieId': 'movie-abc',
    'Input:TimelineComposer.ImageSegments': { groupBy: 'segment', orderBy: 'image', groups: imageGroups },
    'TimelineComposer.ImageSegments': { groupBy: 'segment', orderBy: 'image', groups: imageGroups },
    ImageSegments: imageGroups,
    'Input:TimelineComposer.AudioSegments': { groupBy: 'segment', groups: audioGroups },
    'TimelineComposer.AudioSegments': { groupBy: 'segment', groups: audioGroups },
    AudioSegments: audioGroups,
    'Input:TimelineComposer.Duration': 20,
    'TimelineComposer.Duration': 20,
    Duration: 20,
    MovieTitle: 'Comet Tales',
  };

  // Add image payloads (required for filterExistingAssets)
  imageGroups.forEach((group) => {
    group.forEach((assetId) => {
      if (assetId) {
        // Images don't need duration, just need to exist
        resolvedInputs[assetId] = createAssetPayload(1);
      }
    });
  });

  if (options.omitAudio) {
    delete resolvedInputs['Input:TimelineComposer.AudioSegments'];
    delete resolvedInputs['TimelineComposer.AudioSegments'];
    delete resolvedInputs.AudioSegments;
  } else {
    audioGroups.forEach((group, index) => {
      const assetId = group[0];
      if (!assetId) {
        return;
      }
      const payload = createAssetPayload(audioDurations[index] ?? audioDurations[0] ?? 1);
      resolvedInputs[assetId] = payload;
    });
  }

  return {
    provider: 'renku',
    model: 'OrderedTimeline',
    jobId: 'job-1',
    revision: 'rev-0001',
    layerIndex: 0,
    attempt: 1,
    inputs: [
      'Input:TimelineComposer.ImageSegments',
      'Input:TimelineComposer.AudioSegments',
      'Input:TimelineComposer.Duration',
    ],
    produces: ['Artifact:TimelineComposer.Timeline'],
    context: {
      extras: {
        resolvedInputs,
      },
      providerConfig: {
        config: {
          timeline: {
            numTracks: 2,
            masterTracks: ['Audio'],
            tracks: ['Image', 'Audio'],
            clips: [
              { kind: 'Image', inputs: 'ImageSegments[segment]', effect: 'KenBurns' },
              { kind: 'Audio', inputs: 'AudioSegments' },
            ],
          },
        },
      },
    },
  };
}

function createAssetPayload(duration: number): Uint8Array {
  const rounded = Math.max(1, Math.round(duration));
  return new Uint8Array([rounded]);
}

describe('TimelineProducer', () => {
  it('builds a timeline document with aligned tracks', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const result = await handler.invoke(request);

    expect(result.status).toBe('succeeded');
    expect(result.artefacts).toHaveLength(1);
    const payload = result.artefacts[0]?.blob?.data;
    expect(payload).toBeDefined();
    const timeline = JSON.parse(typeof payload === 'string' ? payload : '{}') as {
      duration: number;
      movieTitle?: string;
      assetFolder?: { source?: string; rootPath?: string };
      tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: Record<string, any> }> }>;
    };

    expect(timeline.duration).toBeCloseTo(20);
    expect(timeline.movieTitle).toBe('Comet Tales');
    expect(timeline.assetFolder?.source).toBe('local');
    expect(timeline.assetFolder?.rootPath).toBe('/tmp/timeline-root/builds/movie-abc');
    expect(timeline.tracks).toHaveLength(2);

    const audioTrack = timeline.tracks.find((track) => track.kind === 'Audio');
    expect(audioTrack).toBeDefined();
    expect(audioTrack?.clips).toHaveLength(2);
    expect(audioTrack?.clips[0]?.startTime).toBe(0);
    expect(audioTrack?.clips[0]?.duration).toBeCloseTo(12);
    expect(audioTrack?.clips[0]?.properties.assetId).toBe('Artifact:Audio[0]');
    expect(audioTrack?.clips[1]?.startTime).toBeCloseTo(12);
    expect(audioTrack?.clips[1]?.duration).toBeCloseTo(8);

    const imageTrack = timeline.tracks.find((track) => track.kind === 'Image');
    expect(imageTrack).toBeDefined();
    expect(imageTrack?.clips).toHaveLength(2);
    expect(imageTrack?.clips[0]?.properties.effects?.[0]?.assetId).toBe('Artifact:Image[0][0]');
  });

  it('throws when storage root is missing', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const extras = request.context.extras as { resolvedInputs: Record<string, unknown> };
    delete extras.resolvedInputs['Input:StorageRoot'];
    await expect(handler.invoke(request)).rejects.toThrow(/storage root/i);
  });

  it('throws when master audio segments are missing', async () => {
    const handler = createHandler();
    const request = makeRequest({ omitAudio: true });
    await expect(handler.invoke(request)).rejects.toThrow(/master track/);
  });

  it('throws when tracks are not provided', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const config = request.context.providerConfig as { config: { timeline: Record<string, unknown> } };
    delete config.config.timeline.tracks;
    await expect(handler.invoke(request)).rejects.toThrow(/tracks/i);
  });

  it('throws when masterTracks is missing', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const config = request.context.providerConfig as { config: { timeline: Record<string, unknown> } };
    delete config.config.timeline.masterTracks;
    await expect(handler.invoke(request)).rejects.toThrow(/masterTracks/i);
  });

  it('throws when timeline wrapper is missing', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const config = request.context.providerConfig as { config: Record<string, unknown> };
    delete config.config.timeline;
    await expect(handler.invoke(request)).rejects.toThrow(/timeline/i);
  });

  it('loops music clips to cover the entire timeline', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[] } } };
    config.config.timeline.clips.push({ kind: 'Music', inputs: 'MusicSegments', play: 'loop', duration: 'full', volume: 0.2 });
    config.config.timeline.numTracks = 3;
    config.config.timeline.tracks = ['Image', 'Audio', 'Music'];
    request.inputs.push('Input:TimelineComposer.MusicSegments');

    const musicFanIn = { groupBy: 'music', groups: [['Artifact:Music[0]']] };
    resolvedInputs['Input:TimelineComposer.MusicSegments'] = musicFanIn;
    resolvedInputs['TimelineComposer.MusicSegments'] = musicFanIn;
    resolvedInputs.MusicSegments = musicFanIn.groups;
    resolvedInputs['Artifact:Music[0]'] = createAssetPayload(5);

    const result = await handler.invoke(request);
    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as { tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number }> }> };
    const musicTrack = timeline.tracks.find((track) => track.kind === 'Music');
    expect(musicTrack).toBeDefined();
    expect(musicTrack?.clips).toHaveLength(4);
    expect(musicTrack?.clips[0]?.startTime).toBe(0);
    expect(musicTrack?.clips[3]?.startTime).toBeCloseTo(15);
    expect(musicTrack?.clips[3]?.duration).toBeCloseTo(5);
  });

  it('stops music when looping is disabled', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[] } } };
    config.config.timeline.clips.push({ kind: 'Music', inputs: 'MusicSegments', play: 'no-loop', duration: 'full' });
    config.config.timeline.numTracks = 3;
    config.config.timeline.tracks = ['Image', 'Audio', 'Music'];
    request.inputs.push('Input:TimelineComposer.MusicSegments');

    const musicFanIn = { groupBy: 'music', groups: [['Artifact:Music[0]']] };
    resolvedInputs['Input:TimelineComposer.MusicSegments'] = musicFanIn;
    resolvedInputs['TimelineComposer.MusicSegments'] = musicFanIn;
    resolvedInputs.MusicSegments = musicFanIn.groups;
    resolvedInputs['Artifact:Music[0]'] = createAssetPayload(6);

    const result = await handler.invoke(request);
    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '') as { tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number }> }> };
    const musicTrack = timeline.tracks.find((track) => track.kind === 'Music');
    expect(musicTrack).toBeDefined();
    expect(musicTrack?.clips).toHaveLength(1);
    expect(musicTrack?.clips[0]?.duration).toBeCloseTo(6);
    expect(musicTrack?.clips[0]?.startTime).toBe(0);
  });

  it('emits video clips with original durations and always uses stretch strategy', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[] } } };
    config.config.timeline.clips.push({ kind: 'Video', inputs: 'VideoSegments' });
    config.config.timeline.numTracks = 3;
    config.config.timeline.tracks = ['Image', 'Audio', 'Video'];
    request.inputs.push('Input:TimelineComposer.VideoSegments');

    const videoFanIn = {
      groupBy: 'segment',
      groups: [
        ['Artifact:Video[0]'],
        ['Artifact:Video[1]'],
      ],
    };
    resolvedInputs['Input:TimelineComposer.VideoSegments'] = videoFanIn;
    resolvedInputs['TimelineComposer.VideoSegments'] = videoFanIn;
    resolvedInputs.VideoSegments = videoFanIn.groups;
    resolvedInputs['Artifact:Video[0]'] = createAssetPayload(9);
    resolvedInputs['Artifact:Video[1]'] = createAssetPayload(8);

    const result = await handler.invoke(request);
    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      tracks: Array<{ kind: string; clips: Array<{ duration: number; properties: Record<string, unknown> }> }>;
    };
    const videoTrack = timeline.tracks.find((track) => track.kind === 'Video');
    expect(videoTrack).toBeDefined();
    expect(videoTrack?.clips).toHaveLength(2);
    expect(videoTrack?.clips[0]?.properties.originalDuration).toBeCloseTo(9);
    // Always uses stretch strategy regardless of duration difference
    expect(videoTrack?.clips[0]?.properties.fitStrategy).toBe('stretch');
    expect(videoTrack?.clips[1]?.properties.originalDuration).toBeCloseTo(8);
    expect(videoTrack?.clips[1]?.properties.fitStrategy).toBe('stretch');
  });

  it('filters clips based on tracks configuration', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; tracks?: string[]; masterTracks?: string[] } } };
    config.config.timeline.tracks = ['Audio'];
    config.config.timeline.masterTracks = ['Audio'];

    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    delete resolvedInputs['Input:TimelineComposer.ImageSegments'];
    delete resolvedInputs['TimelineComposer.ImageSegments'];
    delete resolvedInputs.ImageSegments;

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      tracks: Array<{ kind: string }>;
    };
    expect(timeline.tracks.every((track) => track.kind === 'Audio')).toBe(true);
    expect(timeline.tracks).toHaveLength(1);
  });

  it('throws when master track is not included in configured tracks', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const config = request.context.providerConfig as { config: { timeline: { tracks?: string[]; masterTracks?: string[] } } };
    config.config.timeline.tracks = ['Audio'];
    config.config.timeline.masterTracks = ['Video'];

    await expect(handler.invoke(request)).rejects.toThrow(/Master track kind/);
  });

  it('uses fallback master track when primary is missing segment', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } } };

    // Configure Audio as primary, Video as fallback
    config.config.timeline.masterTracks = ['Audio', 'Video'];
    config.config.timeline.tracks = ['Image', 'Audio', 'Video'];
    config.config.timeline.clips.push({ kind: 'Video', inputs: 'VideoSegments' });
    // Add VideoSegments to the inputs array so canonicalization works
    request.inputs.push('Input:TimelineComposer.VideoSegments');

    // Sparse audio: only segment 1 has audio
    const audioGroups = [
      [], // segment 0 - no audio (skipped)
      ['Artifact:Audio[1]'], // segment 1 - has audio
    ];
    resolvedInputs['Input:TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
    resolvedInputs['TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
    resolvedInputs['Artifact:Audio[1]'] = createAssetPayload(8);

    // Video present for both segments
    const videoGroups = [
      ['Artifact:Video[0]'],
      ['Artifact:Video[1]'],
    ];
    resolvedInputs['Input:TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
    resolvedInputs['TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
    resolvedInputs['Artifact:Video[0]'] = createAssetPayload(10);
    resolvedInputs['Artifact:Video[1]'] = createAssetPayload(8);

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      duration: number;
      tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number }> }>;
    };

    // Segment 0: duration from Video (10s) since Audio is missing
    // Segment 1: duration from Audio (8s)
    expect(timeline.duration).toBeCloseTo(18);

    const audioTrack = timeline.tracks.find((track) => track.kind === 'Audio');
    expect(audioTrack).toBeDefined();
    // Only 1 audio clip (segment 1)
    expect(audioTrack?.clips).toHaveLength(1);
    expect(audioTrack?.clips[0]?.startTime).toBeCloseTo(10);
    expect(audioTrack?.clips[0]?.duration).toBeCloseTo(8);

    const videoTrack = timeline.tracks.find((track) => track.kind === 'Video');
    expect(videoTrack).toBeDefined();
    expect(videoTrack?.clips).toHaveLength(2);
  });

  it('uses SegmentDuration fallback when all master tracks missing for a segment', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } } };

    // Configure Audio as primary, Video as fallback
    config.config.timeline.masterTracks = ['Audio', 'Video'];
    config.config.timeline.tracks = ['Image', 'Audio', 'Video'];
    config.config.timeline.clips.push({ kind: 'Video', inputs: 'VideoSegments' });
    // Add VideoSegments to the inputs array so canonicalization works
    request.inputs.push('Input:TimelineComposer.VideoSegments');

    // Segment 0: no audio, no video - will use SegmentDuration fallback
    // Segment 1: has audio
    const audioGroups = [
      [], // segment 0 - no audio
      ['Artifact:Audio[1]'], // segment 1 - has audio
    ];
    resolvedInputs['Input:TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
    resolvedInputs['TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
    resolvedInputs['Artifact:Audio[1]'] = createAssetPayload(8);

    const videoGroups = [
      [], // segment 0 - no video
      ['Artifact:Video[1]'],
    ];
    resolvedInputs['Input:TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
    resolvedInputs['TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
    resolvedInputs['Artifact:Video[1]'] = createAssetPayload(8);

    // Set SegmentDuration as fallback
    resolvedInputs['Input:SegmentDuration'] = 5;
    resolvedInputs['SegmentDuration'] = 5;

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      duration: number;
      tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number }> }>;
    };

    // Segment 0: duration from SegmentDuration (5s)
    // Segment 1: duration from Audio (8s)
    expect(timeline.duration).toBeCloseTo(13);
  });

  it('builds a Transcription track with correct clip timing', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[] } } };
    config.config.timeline.clips.push({ kind: 'Transcription', inputs: 'TranscriptionAudio' });
    config.config.timeline.numTracks = 3;
    config.config.timeline.tracks = ['Image', 'Audio', 'Transcription'];
    request.inputs.push('Input:TimelineComposer.TranscriptionAudio');

    const transcriptionFanIn = {
      groupBy: 'segment',
      groups: [
        ['Artifact:TranscriptionAudio[0]'],
        ['Artifact:TranscriptionAudio[1]'],
      ],
    };
    resolvedInputs['Input:TimelineComposer.TranscriptionAudio'] = transcriptionFanIn;
    resolvedInputs['TimelineComposer.TranscriptionAudio'] = transcriptionFanIn;
    resolvedInputs['Artifact:TranscriptionAudio[0]'] = createAssetPayload(12);
    resolvedInputs['Artifact:TranscriptionAudio[1]'] = createAssetPayload(8);

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: Record<string, unknown> }> }>;
    };
    const transcriptionTrack = timeline.tracks.find((track) => track.kind === 'Transcription');
    expect(transcriptionTrack).toBeDefined();
    expect(transcriptionTrack?.clips).toHaveLength(2);
    expect(transcriptionTrack?.clips[0]?.startTime).toBe(0);
    expect(transcriptionTrack?.clips[0]?.duration).toBeCloseTo(12);
    expect(transcriptionTrack?.clips[0]?.properties.assetId).toBe('Artifact:TranscriptionAudio[0]');
    expect(transcriptionTrack?.clips[1]?.startTime).toBeCloseTo(12);
    expect(transcriptionTrack?.clips[1]?.duration).toBeCloseTo(8);
    expect(transcriptionTrack?.clips[1]?.properties.assetId).toBe('Artifact:TranscriptionAudio[1]');
  });

  it('skips silent segments in Transcription track', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[] } } };
    config.config.timeline.clips.push({ kind: 'Transcription', inputs: 'TranscriptionAudio' });
    config.config.timeline.numTracks = 3;
    config.config.timeline.tracks = ['Image', 'Audio', 'Transcription'];
    request.inputs.push('Input:TimelineComposer.TranscriptionAudio');

    // Sparse: segment 0 has audio, segment 1 is silent
    const transcriptionFanIn = {
      groupBy: 'segment',
      groups: [
        ['Artifact:TranscriptionAudio[0]'],
        [], // silent segment
      ],
    };
    resolvedInputs['Input:TimelineComposer.TranscriptionAudio'] = transcriptionFanIn;
    resolvedInputs['TimelineComposer.TranscriptionAudio'] = transcriptionFanIn;
    resolvedInputs['Artifact:TranscriptionAudio[0]'] = createAssetPayload(12);

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: Record<string, unknown> }> }>;
    };
    const transcriptionTrack = timeline.tracks.find((track) => track.kind === 'Transcription');
    expect(transcriptionTrack).toBeDefined();
    // Only 1 clip — segment 1 is skipped
    expect(transcriptionTrack?.clips).toHaveLength(1);
    expect(transcriptionTrack?.clips[0]?.properties.assetId).toBe('Artifact:TranscriptionAudio[0]');
  });

  it('builds Transcription track from shorthand transcriptionClip config', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: Record<string, unknown> } };

    // Use shorthand config instead of explicit clips
    config.config.timeline = {
      masterTracks: ['Audio'],
      tracks: ['Audio', 'Transcription'],
      audioClip: { artifact: 'AudioSegments' },
      transcriptionClip: { artifact: 'TranscriptionAudio' },
    };
    request.inputs.push('Input:TimelineComposer.TranscriptionAudio');

    const transcriptionFanIn = {
      groupBy: 'segment',
      groups: [
        ['Artifact:TranscriptionAudio[0]'],
        ['Artifact:TranscriptionAudio[1]'],
      ],
    };
    resolvedInputs['Input:TimelineComposer.TranscriptionAudio'] = transcriptionFanIn;
    resolvedInputs['TimelineComposer.TranscriptionAudio'] = transcriptionFanIn;
    resolvedInputs['Artifact:TranscriptionAudio[0]'] = createAssetPayload(12);
    resolvedInputs['Artifact:TranscriptionAudio[1]'] = createAssetPayload(8);

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      tracks: Array<{ kind: string; clips: Array<{ properties: Record<string, unknown> }> }>;
    };
    const transcriptionTrack = timeline.tracks.find((track) => track.kind === 'Transcription');
    expect(transcriptionTrack).toBeDefined();
    expect(transcriptionTrack?.clips).toHaveLength(2);
    expect(transcriptionTrack?.clips[0]?.properties.assetId).toBe('Artifact:TranscriptionAudio[0]');
  });

  it('builds Transcription track with mixed audio sources from different producers', async () => {
    const handler = createHandler();
    const request = makeRequest({ audioDurations: [10, 8] });
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } } };

    // Add Video track as fallback master and Transcription track
    config.config.timeline.clips.push({ kind: 'Video', inputs: 'VideoSegments' });
    config.config.timeline.clips.push({ kind: 'Transcription', inputs: 'TranscriptionAudio' });
    config.config.timeline.numTracks = 4;
    config.config.timeline.tracks = ['Image', 'Audio', 'Video', 'Transcription'];
    config.config.timeline.masterTracks = ['Audio', 'Video'];
    request.inputs.push('Input:TimelineComposer.VideoSegments');
    request.inputs.push('Input:TimelineComposer.TranscriptionAudio');

    // 4 segments: Audio durations [10, 8, 7, 10] — master track gives segment durations
    // Extend audio to 4 segments
    const audioGroups = [
      ['Artifact:AudioProducer.GeneratedAudio[0]'],
      ['Artifact:AudioProducer.GeneratedAudio[1]'],
      ['Artifact:AudioProducer.GeneratedAudio[2]'],
      ['Artifact:AudioProducer.GeneratedAudio[3]'],
    ];
    resolvedInputs['Input:TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
    resolvedInputs['TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
    resolvedInputs['Artifact:AudioProducer.GeneratedAudio[0]'] = createAssetPayload(10);
    resolvedInputs['Artifact:AudioProducer.GeneratedAudio[1]'] = createAssetPayload(8);
    resolvedInputs['Artifact:AudioProducer.GeneratedAudio[2]'] = createAssetPayload(7);
    resolvedInputs['Artifact:AudioProducer.GeneratedAudio[3]'] = createAssetPayload(10);

    // Video groups for all 4 segments
    const videoGroups = [
      ['Artifact:Video[0]'],
      ['Artifact:Video[1]'],
      ['Artifact:Video[2]'],
      ['Artifact:Video[3]'],
    ];
    resolvedInputs['Input:TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
    resolvedInputs['TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
    resolvedInputs['Artifact:Video[0]'] = createAssetPayload(10);
    resolvedInputs['Artifact:Video[1]'] = createAssetPayload(8);
    resolvedInputs['Artifact:Video[2]'] = createAssetPayload(7);
    resolvedInputs['Artifact:Video[3]'] = createAssetPayload(10);

    // Extend images to 4 segments
    const imageGroups = [
      ['Artifact:Image[0][0]', 'Artifact:Image[0][1]'],
      ['Artifact:Image[1][0]'],
      ['Artifact:Image[2][0]'],
      ['Artifact:Image[3][0]'],
    ];
    resolvedInputs['Input:TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };
    resolvedInputs['TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };
    resolvedInputs['Artifact:Image[2][0]'] = createAssetPayload(1);
    resolvedInputs['Artifact:Image[3][0]'] = createAssetPayload(1);

    // TranscriptionAudio: mixed sources from different producers
    // Seg 0: narration audio, Seg 1: lipsync audio, Seg 2: silent, Seg 3: narration audio
    const transcriptionGroups = [
      ['Artifact:AudioProducer.GeneratedAudio[0]'],   // narration
      ['Artifact:LipsyncVideo.AudioTrack[1]'],         // lipsync
      [],                                               // silent
      ['Artifact:AudioProducer.GeneratedAudio[3]'],   // narration
    ];
    resolvedInputs['Input:TimelineComposer.TranscriptionAudio'] = { groupBy: 'segment', groups: transcriptionGroups };
    resolvedInputs['TimelineComposer.TranscriptionAudio'] = { groupBy: 'segment', groups: transcriptionGroups };
    // AudioProducer assets already registered above; add lipsync asset
    resolvedInputs['Artifact:LipsyncVideo.AudioTrack[1]'] = createAssetPayload(8);

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      duration: number;
      tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: Record<string, unknown> }> }>;
    };

    const transcriptionTrack = timeline.tracks.find((track) => track.kind === 'Transcription');
    expect(transcriptionTrack).toBeDefined();
    // 3 clips: segments 0, 1, 3 (segment 2 is silent)
    expect(transcriptionTrack?.clips).toHaveLength(3);

    // Clip 0: segment 0 at offset 0, duration 10
    expect(transcriptionTrack?.clips[0]?.startTime).toBe(0);
    expect(transcriptionTrack?.clips[0]?.duration).toBeCloseTo(10);
    expect(transcriptionTrack?.clips[0]?.properties.assetId).toBe('Artifact:AudioProducer.GeneratedAudio[0]');

    // Clip 1: segment 1 at offset 10, duration 8
    expect(transcriptionTrack?.clips[1]?.startTime).toBeCloseTo(10);
    expect(transcriptionTrack?.clips[1]?.duration).toBeCloseTo(8);
    expect(transcriptionTrack?.clips[1]?.properties.assetId).toBe('Artifact:LipsyncVideo.AudioTrack[1]');

    // Clip 2: segment 3 at offset 10+8+7=25, duration 10
    expect(transcriptionTrack?.clips[2]?.startTime).toBeCloseTo(25);
    expect(transcriptionTrack?.clips[2]?.duration).toBeCloseTo(10);
    expect(transcriptionTrack?.clips[2]?.properties.assetId).toBe('Artifact:AudioProducer.GeneratedAudio[3]');
  });

  it('builds Transcription track alongside Audio, Video, and Image tracks', async () => {
    const handler = createHandler();
    const request = makeRequest({ audioDurations: [12, 8] });
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } } };

    // Add Video and Transcription tracks
    config.config.timeline.clips.push({ kind: 'Video', inputs: 'VideoSegments' });
    config.config.timeline.clips.push({ kind: 'Transcription', inputs: 'TranscriptionAudio' });
    config.config.timeline.numTracks = 4;
    config.config.timeline.tracks = ['Image', 'Audio', 'Video', 'Transcription'];
    config.config.timeline.masterTracks = ['Audio'];
    request.inputs.push('Input:TimelineComposer.VideoSegments');
    request.inputs.push('Input:TimelineComposer.TranscriptionAudio');

    // Video for both segments
    const videoGroups = [['Artifact:Video[0]'], ['Artifact:Video[1]']];
    resolvedInputs['Input:TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
    resolvedInputs['TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
    resolvedInputs['Artifact:Video[0]'] = createAssetPayload(12);
    resolvedInputs['Artifact:Video[1]'] = createAssetPayload(8);

    // Transcription for both segments
    const transcriptionGroups = [['Artifact:TranscriptionAudio[0]'], ['Artifact:TranscriptionAudio[1]']];
    resolvedInputs['Input:TimelineComposer.TranscriptionAudio'] = { groupBy: 'segment', groups: transcriptionGroups };
    resolvedInputs['TimelineComposer.TranscriptionAudio'] = { groupBy: 'segment', groups: transcriptionGroups };
    resolvedInputs['Artifact:TranscriptionAudio[0]'] = createAssetPayload(12);
    resolvedInputs['Artifact:TranscriptionAudio[1]'] = createAssetPayload(8);

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: Record<string, unknown> }> }>;
    };

    // All 4 track types should be present
    expect(timeline.tracks).toHaveLength(4);
    const kinds = timeline.tracks.map((t) => t.kind).sort();
    expect(kinds).toEqual(['Audio', 'Image', 'Transcription', 'Video']);

    // Each track builds correctly without interference
    const audioTrack = timeline.tracks.find((t) => t.kind === 'Audio');
    expect(audioTrack?.clips).toHaveLength(2);
    expect(audioTrack?.clips[0]?.properties.assetId).toBe('Artifact:Audio[0]');

    const imageTrack = timeline.tracks.find((t) => t.kind === 'Image');
    expect(imageTrack?.clips).toHaveLength(2);

    const videoTrack = timeline.tracks.find((t) => t.kind === 'Video');
    expect(videoTrack?.clips).toHaveLength(2);

    const transcriptionTrack = timeline.tracks.find((t) => t.kind === 'Transcription');
    expect(transcriptionTrack?.clips).toHaveLength(2);
    expect(transcriptionTrack?.clips[0]?.startTime).toBe(0);
    expect(transcriptionTrack?.clips[0]?.duration).toBeCloseTo(12);
    expect(transcriptionTrack?.clips[1]?.startTime).toBeCloseTo(12);
    expect(transcriptionTrack?.clips[1]?.duration).toBeCloseTo(8);
  });

  it('builds Transcription track with interleaved sparse pattern across 6 segments', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
    const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } } };

    // Configure with Audio as master + Transcription
    config.config.timeline.clips = [
      { kind: 'Audio', inputs: 'AudioSegments' },
      { kind: 'Transcription', inputs: 'TranscriptionAudio' },
    ];
    config.config.timeline.numTracks = 2;
    config.config.timeline.tracks = ['Audio', 'Transcription'];
    config.config.timeline.masterTracks = ['Audio'];
    request.inputs.length = 0;
    request.inputs.push('Input:TimelineComposer.AudioSegments');
    request.inputs.push('Input:TimelineComposer.TranscriptionAudio');

    // 6 segments with uniform duration from SegmentDuration
    resolvedInputs['Input:SegmentDuration'] = 5;
    resolvedInputs['SegmentDuration'] = 5;
    resolvedInputs['Input:TimelineComposer.Duration'] = 30;
    resolvedInputs['TimelineComposer.Duration'] = 30;
    resolvedInputs['Duration'] = 30;

    // Audio for all 6 segments (all have audio)
    const audioGroups = Array.from({ length: 6 }, (_, i) => [`Artifact:Audio[${i}]`]);
    resolvedInputs['Input:TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
    resolvedInputs['TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
    for (let i = 0; i < 6; i++) {
      resolvedInputs[`Artifact:Audio[${i}]`] = createAssetPayload(5);
    }

    // TranscriptionAudio: only at segments 0, 2, 5 (sparse)
    const transcriptionGroups = [
      ['Artifact:TranscriptionAudio[0]'], // seg 0
      [],                                  // seg 1 silent
      ['Artifact:TranscriptionAudio[2]'], // seg 2
      [],                                  // seg 3 silent
      [],                                  // seg 4 silent
      ['Artifact:TranscriptionAudio[5]'], // seg 5
    ];
    resolvedInputs['Input:TimelineComposer.TranscriptionAudio'] = { groupBy: 'segment', groups: transcriptionGroups };
    resolvedInputs['TimelineComposer.TranscriptionAudio'] = { groupBy: 'segment', groups: transcriptionGroups };
    resolvedInputs['Artifact:TranscriptionAudio[0]'] = createAssetPayload(5);
    resolvedInputs['Artifact:TranscriptionAudio[2]'] = createAssetPayload(5);
    resolvedInputs['Artifact:TranscriptionAudio[5]'] = createAssetPayload(5);

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      duration: number;
      tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: Record<string, unknown> }> }>;
    };

    expect(timeline.duration).toBeCloseTo(30);

    const transcriptionTrack = timeline.tracks.find((track) => track.kind === 'Transcription');
    expect(transcriptionTrack).toBeDefined();
    // 3 clips: segments 0, 2, 5
    expect(transcriptionTrack?.clips).toHaveLength(3);

    // Seg 0: offset=0, duration=5
    expect(transcriptionTrack?.clips[0]?.startTime).toBe(0);
    expect(transcriptionTrack?.clips[0]?.duration).toBeCloseTo(5);
    expect(transcriptionTrack?.clips[0]?.properties.assetId).toBe('Artifact:TranscriptionAudio[0]');

    // Seg 2: offset=10 (5+5), duration=5
    expect(transcriptionTrack?.clips[1]?.startTime).toBeCloseTo(10);
    expect(transcriptionTrack?.clips[1]?.duration).toBeCloseTo(5);
    expect(transcriptionTrack?.clips[1]?.properties.assetId).toBe('Artifact:TranscriptionAudio[2]');

    // Seg 5: offset=25 (5*5), duration=5
    expect(transcriptionTrack?.clips[2]?.startTime).toBeCloseTo(25);
    expect(transcriptionTrack?.clips[2]?.duration).toBeCloseTo(5);
    expect(transcriptionTrack?.clips[2]?.properties.assetId).toBe('Artifact:TranscriptionAudio[5]');
  });

  it('skips image clips for segments with no images', async () => {
    const handler = createHandler();
    const request = makeRequest();
    const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;

    // Sparse images: only segment 0 has images
    const imageGroups = [
      ['Artifact:Image[0][0]', 'Artifact:Image[0][1]'],
      [], // segment 1 - no images (skipped)
    ];
    resolvedInputs['Input:TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };
    resolvedInputs['TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };

    // Add payloads for segment 0 images (required for filterExistingAssets)
    resolvedInputs['Artifact:Image[0][0]'] = createAssetPayload(1);
    resolvedInputs['Artifact:Image[0][1]'] = createAssetPayload(1);

    const result = await handler.invoke(request);
    expect(result.status).toBe('succeeded');

    const timelinePayload = result.artefacts[0]?.blob?.data;
    const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
      tracks: Array<{ kind: string; clips: Array<{ id: string }> }>;
    };

    const imageTrack = timeline.tracks.find((track) => track.kind === 'Image');
    expect(imageTrack).toBeDefined();
    // Only 1 image clip (segment 0), segment 1 is skipped
    expect(imageTrack?.clips).toHaveLength(1);
    expect(imageTrack?.clips[0]?.id).toBe('clip-0-0');
  });

  describe('master track item expansion', () => {
    it('expands multiple items per group into separate segments', async () => {
      const handler = createHandler();
      const request = makeRequest();
      const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
      const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } } };

      // Configure Video as master track
      config.config.timeline.masterTracks = ['Video'];
      config.config.timeline.tracks = ['Video', 'Audio', 'Image'];
      config.config.timeline.clips = [
        { kind: 'Video', inputs: 'VideoSegments' },
        { kind: 'Audio', inputs: 'AudioSegments' },
        { kind: 'Image', inputs: 'ImageSegments', effect: 'KenBurns' },
      ];
      request.inputs.length = 0;
      request.inputs.push('Input:TimelineComposer.VideoSegments');
      request.inputs.push('Input:TimelineComposer.AudioSegments');
      request.inputs.push('Input:TimelineComposer.ImageSegments');

      // Video master track: group 0 has 2 items, group 1 has 1 item
      // This should create 3 segments total: [V0a, V0b] from group 0, [V1] from group 1
      const videoGroups = [
        ['Artifact:Video[0][a]', 'Artifact:Video[0][b]'], // group 0: 2 items
        ['Artifact:Video[1]'], // group 1: 1 item
      ];
      resolvedInputs['Input:TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
      resolvedInputs['TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
      resolvedInputs['Artifact:Video[0][a]'] = createAssetPayload(5);
      resolvedInputs['Artifact:Video[0][b]'] = createAssetPayload(7);
      resolvedInputs['Artifact:Video[1]'] = createAssetPayload(8);

      // Audio: 1 item per group (should span the expanded segments)
      const audioGroups = [
        ['Artifact:Audio[0]'], // group 0: single audio spanning both video clips
        ['Artifact:Audio[1]'], // group 1: single audio for video clip
      ];
      resolvedInputs['Input:TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
      resolvedInputs['TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
      resolvedInputs['Artifact:Audio[0]'] = createAssetPayload(12);
      resolvedInputs['Artifact:Audio[1]'] = createAssetPayload(8);

      // Images: 1 set per group (should repeat for each expanded segment)
      const imageGroups = [
        ['Artifact:Image[0][0]', 'Artifact:Image[0][1]'], // group 0
        ['Artifact:Image[1][0]'], // group 1
      ];
      resolvedInputs['Input:TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };
      resolvedInputs['TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };

      const result = await handler.invoke(request);
      expect(result.status).toBe('succeeded');

      const timelinePayload = result.artefacts[0]?.blob?.data;
      const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
        duration: number;
        tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: Record<string, unknown> }> }>;
      };

      // Total duration: 5 + 7 + 8 = 20
      expect(timeline.duration).toBeCloseTo(20);

      // Video track (master): should have 3 clips, one per item
      const videoTrack = timeline.tracks.find((t) => t.kind === 'Video');
      expect(videoTrack).toBeDefined();
      expect(videoTrack?.clips).toHaveLength(3);
      // Sorted alphabetically: Video[0][a] first, then Video[0][b]
      expect(videoTrack?.clips[0]?.properties.assetId).toBe('Artifact:Video[0][a]');
      expect(videoTrack?.clips[0]?.startTime).toBe(0);
      expect(videoTrack?.clips[0]?.duration).toBeCloseTo(5);
      expect(videoTrack?.clips[1]?.properties.assetId).toBe('Artifact:Video[0][b]');
      expect(videoTrack?.clips[1]?.startTime).toBeCloseTo(5);
      expect(videoTrack?.clips[1]?.duration).toBeCloseTo(7);
      expect(videoTrack?.clips[2]?.properties.assetId).toBe('Artifact:Video[1]');
      expect(videoTrack?.clips[2]?.startTime).toBeCloseTo(12);
      expect(videoTrack?.clips[2]?.duration).toBeCloseTo(8);
    });

    it('spans non-master audio across expanded segments', async () => {
      const handler = createHandler();
      const request = makeRequest();
      const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
      const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } } };

      // Configure Video as master track
      config.config.timeline.masterTracks = ['Video'];
      config.config.timeline.tracks = ['Video', 'Audio'];
      config.config.timeline.clips = [
        { kind: 'Video', inputs: 'VideoSegments' },
        { kind: 'Audio', inputs: 'AudioSegments' },
      ];
      request.inputs.length = 0;
      request.inputs.push('Input:TimelineComposer.VideoSegments');
      request.inputs.push('Input:TimelineComposer.AudioSegments');

      // Video master: group 0 has 2 items (expands to 2 segments)
      const videoGroups = [
        ['Artifact:Video[0][a]', 'Artifact:Video[0][b]'],
      ];
      resolvedInputs['Input:TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
      resolvedInputs['TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
      resolvedInputs['Artifact:Video[0][a]'] = createAssetPayload(6);
      resolvedInputs['Artifact:Video[0][b]'] = createAssetPayload(4);

      // Audio: 1 item per group - should span both video segments
      const audioGroups = [
        ['Artifact:Audio[0]'],
      ];
      resolvedInputs['Input:TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
      resolvedInputs['TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
      resolvedInputs['Artifact:Audio[0]'] = createAssetPayload(10);

      const result = await handler.invoke(request);
      expect(result.status).toBe('succeeded');

      const timelinePayload = result.artefacts[0]?.blob?.data;
      const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
        tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: Record<string, unknown> }> }>;
      };

      // Audio track should have 1 clip spanning duration 6+4=10
      const audioTrack = timeline.tracks.find((t) => t.kind === 'Audio');
      expect(audioTrack).toBeDefined();
      expect(audioTrack?.clips).toHaveLength(1);
      expect(audioTrack?.clips[0]?.startTime).toBe(0);
      expect(audioTrack?.clips[0]?.duration).toBeCloseTo(10);
      expect(audioTrack?.clips[0]?.properties.assetId).toBe('Artifact:Audio[0]');
    });

    it('expands primary audio clips per segment when a group has multiple assets', async () => {
      const handler = createHandler();
      const request = makeRequest();
      const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
      const config = request.context.providerConfig as {
        config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } };
      };

      config.config.timeline.masterTracks = ['Audio'];
      config.config.timeline.tracks = ['Audio'];
      config.config.timeline.clips = [
        { kind: 'Audio', inputs: 'AudioSegments' },
      ];
      config.config.timeline.numTracks = 1;
      request.inputs.length = 0;
      request.inputs.push('Input:TimelineComposer.AudioSegments');

      const audioGroups = [
        ['Artifact:Audio[0][b]', 'Artifact:Audio[0][a]'],
        ['Artifact:Audio[1]'],
      ];
      resolvedInputs['Input:TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
      resolvedInputs['TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
      resolvedInputs['Artifact:Audio[0][a]'] = createAssetPayload(4);
      resolvedInputs['Artifact:Audio[0][b]'] = createAssetPayload(6);
      resolvedInputs['Artifact:Audio[1]'] = createAssetPayload(5);

      const result = await handler.invoke(request);
      expect(result.status).toBe('succeeded');

      const timelinePayload = result.artefacts[0]?.blob?.data;
      const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
        duration: number;
        tracks: Array<{
          kind: string;
          clips: Array<{ startTime: number; duration: number; properties: { assetId?: string } }>;
        }>;
      };

      expect(timeline.duration).toBeCloseTo(15);

      const audioTrack = timeline.tracks.find((track) => track.kind === 'Audio');
      expect(audioTrack).toBeDefined();
      expect(audioTrack?.clips).toHaveLength(3);
      expect(audioTrack?.clips[0]?.properties.assetId).toBe('Artifact:Audio[0][a]');
      expect(audioTrack?.clips[0]?.startTime).toBe(0);
      expect(audioTrack?.clips[0]?.duration).toBeCloseTo(4);
      expect(audioTrack?.clips[1]?.properties.assetId).toBe('Artifact:Audio[0][b]');
      expect(audioTrack?.clips[1]?.startTime).toBeCloseTo(4);
      expect(audioTrack?.clips[1]?.duration).toBeCloseTo(6);
      expect(audioTrack?.clips[2]?.properties.assetId).toBe('Artifact:Audio[1]');
      expect(audioTrack?.clips[2]?.startTime).toBeCloseTo(10);
      expect(audioTrack?.clips[2]?.duration).toBeCloseTo(5);
    });

    it('uses expanded segment count for Duration fallback when primary master has no native durations', async () => {
      const handler = createHandler();
      const request = makeRequest();
      const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
      const config = request.context.providerConfig as {
        config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } };
      };

      config.config.timeline.masterTracks = ['Image'];
      config.config.timeline.tracks = ['Image'];
      config.config.timeline.clips = [
        { kind: 'Image', inputs: 'ImageSegments', effect: 'KenBurns' },
      ];
      config.config.timeline.numTracks = 1;
      request.inputs.length = 0;
      request.inputs.push('Input:TimelineComposer.ImageSegments');

      resolvedInputs['Input:TimelineComposer.Duration'] = 24;
      resolvedInputs['TimelineComposer.Duration'] = 24;
      resolvedInputs.Duration = 24;
      delete resolvedInputs['Input:SegmentDuration'];
      delete resolvedInputs.SegmentDuration;

      const imageGroups = [
        ['Artifact:Image[0][a]', 'Artifact:Image[0][b]'],
        ['Artifact:Image[1]'],
        ['Artifact:Image[2][a]', 'Artifact:Image[2][b]', 'Artifact:Image[2][c]'],
      ];
      resolvedInputs['Input:TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };
      resolvedInputs['TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };
      for (const group of imageGroups) {
        for (const assetId of group) {
          resolvedInputs[assetId] = createAssetPayload(1);
        }
      }

      const result = await handler.invoke(request);
      expect(result.status).toBe('succeeded');

      const timelinePayload = result.artefacts[0]?.blob?.data;
      const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
        duration: number;
        tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number }> }>;
      };

      expect(timeline.duration).toBeCloseTo(24);

      const imageTrack = timeline.tracks.find((track) => track.kind === 'Image');
      expect(imageTrack).toBeDefined();
      expect(imageTrack?.clips).toHaveLength(6);
      for (const imageClip of imageTrack?.clips ?? []) {
        expect(imageClip.duration).toBeCloseTo(4);
      }
      expect(imageTrack?.clips[5]?.startTime).toBeCloseTo(20);
    });

    it('repeats images for each expanded segment from the same group', async () => {
      const handler = createHandler();
      const request = makeRequest();
      const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
      const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } } };

      // Configure Video as master track
      config.config.timeline.masterTracks = ['Video'];
      config.config.timeline.tracks = ['Video', 'Image'];
      config.config.timeline.clips = [
        { kind: 'Video', inputs: 'VideoSegments' },
        { kind: 'Image', inputs: 'ImageSegments', effect: 'KenBurns' },
      ];
      request.inputs.length = 0;
      request.inputs.push('Input:TimelineComposer.VideoSegments');
      request.inputs.push('Input:TimelineComposer.ImageSegments');

      // Video master: group 0 has 2 items (expands to 2 segments)
      const videoGroups = [
        ['Artifact:Video[0][a]', 'Artifact:Video[0][b]'],
      ];
      resolvedInputs['Input:TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
      resolvedInputs['TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
      resolvedInputs['Artifact:Video[0][a]'] = createAssetPayload(5);
      resolvedInputs['Artifact:Video[0][b]'] = createAssetPayload(5);

      // Images: 1 set per group - should be used in both expanded segments
      const imageGroups = [
        ['Artifact:Image[0][0]', 'Artifact:Image[0][1]'],
      ];
      resolvedInputs['Input:TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };
      resolvedInputs['TimelineComposer.ImageSegments'] = { groupBy: 'segment', orderBy: 'image', groups: imageGroups };

      const result = await handler.invoke(request);
      expect(result.status).toBe('succeeded');

      const timelinePayload = result.artefacts[0]?.blob?.data;
      const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
        tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: { effects?: Array<{ assetId: string }> } }> }>;
      };

      // Image track should have 2 clips (one per segment), each using the same images
      const imageTrack = timeline.tracks.find((t) => t.kind === 'Image');
      expect(imageTrack).toBeDefined();
      expect(imageTrack?.clips).toHaveLength(2);

      // Both clips should use the same images from group 0
      expect(imageTrack?.clips[0]?.properties.effects?.map((e) => e.assetId)).toEqual([
        'Artifact:Image[0][0]',
        'Artifact:Image[0][1]',
      ]);
      expect(imageTrack?.clips[1]?.properties.effects?.map((e) => e.assetId)).toEqual([
        'Artifact:Image[0][0]',
        'Artifact:Image[0][1]',
      ]);

      // But at different times
      expect(imageTrack?.clips[0]?.startTime).toBe(0);
      expect(imageTrack?.clips[0]?.duration).toBeCloseTo(5);
      expect(imageTrack?.clips[1]?.startTime).toBeCloseTo(5);
      expect(imageTrack?.clips[1]?.duration).toBeCloseTo(5);
    });

    it('maintains backward compatibility with single item per group', async () => {
      // This is covered by the existing tests, but let's verify explicitly
      const handler = createHandler();
      const request = makeRequest();

      // Standard config: Audio as master, 1 item per group
      // This should work exactly as before
      const result = await handler.invoke(request);
      expect(result.status).toBe('succeeded');

      const timelinePayload = result.artefacts[0]?.blob?.data;
      const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
        duration: number;
        tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number }> }>;
      };

      // Standard 2 segments, same as before
      const audioTrack = timeline.tracks.find((t) => t.kind === 'Audio');
      expect(audioTrack?.clips).toHaveLength(2);
      expect(audioTrack?.clips[0]?.startTime).toBe(0);
      expect(audioTrack?.clips[1]?.startTime).toBeCloseTo(12);
    });

    it('handles mixed groups with varying item counts', async () => {
      const handler = createHandler();
      const request = makeRequest();
      const resolvedInputs = request.context.extras?.resolvedInputs as Record<string, unknown>;
      const config = request.context.providerConfig as { config: { timeline: { clips: Array<Record<string, unknown>>; numTracks: number; tracks: string[]; masterTracks: string[] } } };

      // Configure Video as master track
      config.config.timeline.masterTracks = ['Video'];
      config.config.timeline.tracks = ['Video', 'Audio', 'Transcription'];
      config.config.timeline.clips = [
        { kind: 'Video', inputs: 'VideoSegments' },
        { kind: 'Audio', inputs: 'AudioSegments' },
        { kind: 'Transcription', inputs: 'TranscriptionAudio' },
      ];
      request.inputs.length = 0;
      request.inputs.push('Input:TimelineComposer.VideoSegments');
      request.inputs.push('Input:TimelineComposer.AudioSegments');
      request.inputs.push('Input:TimelineComposer.TranscriptionAudio');

      // Video master: group 0 has 1 item, group 1 has 2 items, group 2 has 1 item
      // This should create 4 segments total
      const videoGroups = [
        ['Artifact:Video[0]'], // 1 item
        ['Artifact:Video[1][a]', 'Artifact:Video[1][b]'], // 2 items
        ['Artifact:Video[2]'], // 1 item
      ];
      resolvedInputs['Input:TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
      resolvedInputs['TimelineComposer.VideoSegments'] = { groupBy: 'segment', groups: videoGroups };
      resolvedInputs['Artifact:Video[0]'] = createAssetPayload(4);
      resolvedInputs['Artifact:Video[1][a]'] = createAssetPayload(3);
      resolvedInputs['Artifact:Video[1][b]'] = createAssetPayload(5);
      resolvedInputs['Artifact:Video[2]'] = createAssetPayload(6);

      // Audio: 1 item per group
      const audioGroups = [
        ['Artifact:Audio[0]'],
        ['Artifact:Audio[1]'],
        ['Artifact:Audio[2]'],
      ];
      resolvedInputs['Input:TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
      resolvedInputs['TimelineComposer.AudioSegments'] = { groupBy: 'segment', groups: audioGroups };
      resolvedInputs['Artifact:Audio[0]'] = createAssetPayload(4);
      resolvedInputs['Artifact:Audio[1]'] = createAssetPayload(8);
      resolvedInputs['Artifact:Audio[2]'] = createAssetPayload(6);

      // Transcription: sparse (only groups 0 and 2)
      const transcriptionGroups = [
        ['Artifact:Transcription[0]'],
        [], // silent
        ['Artifact:Transcription[2]'],
      ];
      resolvedInputs['Input:TimelineComposer.TranscriptionAudio'] = { groupBy: 'segment', groups: transcriptionGroups };
      resolvedInputs['TimelineComposer.TranscriptionAudio'] = { groupBy: 'segment', groups: transcriptionGroups };
      resolvedInputs['Artifact:Transcription[0]'] = createAssetPayload(4);
      resolvedInputs['Artifact:Transcription[2]'] = createAssetPayload(6);

      // Remove default image groups
      delete resolvedInputs['Input:TimelineComposer.ImageSegments'];
      delete resolvedInputs['TimelineComposer.ImageSegments'];
      delete resolvedInputs.ImageSegments;

      const result = await handler.invoke(request);
      expect(result.status).toBe('succeeded');

      const timelinePayload = result.artefacts[0]?.blob?.data;
      const timeline = JSON.parse(typeof timelinePayload === 'string' ? timelinePayload : '{}') as {
        duration: number;
        tracks: Array<{ kind: string; clips: Array<{ startTime: number; duration: number; properties: Record<string, unknown> }> }>;
      };

      // Total: 4 + 3 + 5 + 6 = 18
      expect(timeline.duration).toBeCloseTo(18);

      // Video: 4 clips (one per item)
      const videoTrack = timeline.tracks.find((t) => t.kind === 'Video');
      expect(videoTrack?.clips).toHaveLength(4);
      expect(videoTrack?.clips[0]?.properties.assetId).toBe('Artifact:Video[0]');
      expect(videoTrack?.clips[0]?.duration).toBeCloseTo(4);
      expect(videoTrack?.clips[1]?.properties.assetId).toBe('Artifact:Video[1][a]');
      expect(videoTrack?.clips[1]?.duration).toBeCloseTo(3);
      expect(videoTrack?.clips[2]?.properties.assetId).toBe('Artifact:Video[1][b]');
      expect(videoTrack?.clips[2]?.duration).toBeCloseTo(5);
      expect(videoTrack?.clips[3]?.properties.assetId).toBe('Artifact:Video[2]');
      expect(videoTrack?.clips[3]?.duration).toBeCloseTo(6);

      // Audio: 3 clips (one per group, spanning its segments)
      const audioTrack = timeline.tracks.find((t) => t.kind === 'Audio');
      expect(audioTrack?.clips).toHaveLength(3);
      expect(audioTrack?.clips[0]?.startTime).toBe(0);
      expect(audioTrack?.clips[0]?.duration).toBeCloseTo(4); // group 0 has 1 segment
      expect(audioTrack?.clips[1]?.startTime).toBeCloseTo(4);
      expect(audioTrack?.clips[1]?.duration).toBeCloseTo(8); // group 1 spans 2 segments: 3+5=8
      expect(audioTrack?.clips[2]?.startTime).toBeCloseTo(12);
      expect(audioTrack?.clips[2]?.duration).toBeCloseTo(6); // group 2 has 1 segment

      // Transcription: 2 clips (groups 0 and 2, spanning their segments)
      const transcriptionTrack = timeline.tracks.find((t) => t.kind === 'Transcription');
      expect(transcriptionTrack?.clips).toHaveLength(2);
      expect(transcriptionTrack?.clips[0]?.startTime).toBe(0);
      expect(transcriptionTrack?.clips[0]?.duration).toBeCloseTo(4);
      expect(transcriptionTrack?.clips[1]?.startTime).toBeCloseTo(12);
      expect(transcriptionTrack?.clips[1]?.duration).toBeCloseTo(6);
    });
  });
});
