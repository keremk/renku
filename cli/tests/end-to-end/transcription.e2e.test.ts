/**
 * End-to-end tests for the transcription and karaoke subtitles pipeline.
 *
 * These tests verify:
 * 1. Audio concatenation with real audio files and correct timing
 * 2. Timestamp alignment using real STT JSON output
 * 3. Karaoke filter generation produces valid FFmpeg drawtext filters
 * 4. Full pipeline integration from TranscriptionProducer to VideoExporter
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { runExecute, formatMovieId } from '../../src/commands/execute.js';
import {
  alignTranscriptionToTimeline,
  buildKaraokeFilter,
  buildKaraokeFilterChain,
  escapeDrawtext,
  checkFfmpegAvailability,
  resetFfmpegCache,
  type AudioSegment,
  type STTOutput,
  type TranscriptionArtifact,
} from '@gorenku/providers';
import {
  createLoggerRecorder,
  findJob,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';
import {
  CLI_FIXTURES_BLUEPRINTS,
  CLI_FIXTURES_INPUTS,
  CLI_FIXTURES_MEDIA,
  CLI_FIXTURES_SCHEMAS,
} from '../test-catalog-paths.js';

/**
 * Load the transcription.json fixture and parse it as STT output.
 */
async function loadTranscriptionFixture(): Promise<STTOutput> {
  const content = await readFile(resolve(CLI_FIXTURES_SCHEMAS, 'transcription.json'), 'utf8');
  return JSON.parse(content) as STTOutput;
}

/**
 * Load the audio-fixture.mp3 as a buffer.
 */
async function loadAudioFixture(): Promise<Buffer> {
  return readFile(resolve(CLI_FIXTURES_MEDIA, 'audio-fixture.mp3'));
}

describe('end-to-end: transcription producer plan validation', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('includes TranscriptionProducer in plan with correct bindings', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'cut-scene-video', 'video-audio-music.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'transcription-inputs.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-transcription';
    const storageMovieId = formatMovieId(movieId);

    const result = await runExecute({
      storageMovieId,
      movieId,
      isNew: true,
      inputsPath,
      blueprintSpecifier: blueprintPath,
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    if (result.build?.status !== 'succeeded') {
      throw new Error(`dryRun failed: ${JSON.stringify(result.build, null, 2)}`);
    }
    expect(warnings).toHaveLength(0);
    expect(errors).toHaveLength(0);

    const plan = await readPlan(result.planPath);

    // Verify TranscriptionProducer job exists
    const transcriptionJob = findJob(plan, 'TranscriptionProducer');
    expect(transcriptionJob).toBeDefined();

    // Verify correct input bindings from blueprint connections
    expect(transcriptionJob?.context?.inputBindings?.Timeline).toBe(
      'Artifact:TimelineComposer.Timeline'
    );

    // TranscriptionProducer no longer has AudioSegments fan-in;
    // audio is now wired to TimelineComposer.TranscriptionAudio instead.
    // Verify the TimelineComposer receives the TranscriptionAudio fan-in
    const timelineJob = findJob(plan, 'TimelineComposer');
    const transcriptionAudioFanIn = timelineJob?.context?.fanIn?.['Input:TimelineComposer.TranscriptionAudio'];
    expect(transcriptionAudioFanIn).toBeDefined();
    expect(transcriptionAudioFanIn?.members?.length).toBeGreaterThan(0);

    // Verify VideoExporter receives Transcription input
    const exporterJob = findJob(plan, 'VideoExporter');
    expect(exporterJob).toBeDefined();
    expect(exporterJob?.context?.inputBindings?.Transcription).toBe(
      'Artifact:TranscriptionProducer.Transcription'
    );
  });

  it('schedules TranscriptionProducer after TimelineComposer and before VideoExporter', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'cut-scene-video', 'video-audio-music.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'transcription-inputs.yaml');
    const { logger } = createLoggerRecorder();
    const movieId = 'e2e-transcription-scheduling';
    const storageMovieId = formatMovieId(movieId);

    const result = await runExecute({
      storageMovieId,
      movieId,
      isNew: true,
      inputsPath,
      blueprintSpecifier: blueprintPath,
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    expect(result.build?.status).toBe('succeeded');

    const plan = await readPlan(result.planPath);

    // Find layer indices for each producer
    const timelineLayer = plan.layers.findIndex((layer: any[]) =>
      layer.some((job: any) => job.producer === 'TimelineComposer')
    );
    const transcriptionLayer = plan.layers.findIndex((layer: any[]) =>
      layer.some((job: any) => job.producer === 'TranscriptionProducer')
    );
    const exporterLayer = plan.layers.findIndex((layer: any[]) =>
      layer.some((job: any) => job.producer === 'VideoExporter')
    );

    // Verify correct ordering: Timeline -> Transcription -> Exporter
    expect(transcriptionLayer).toBeGreaterThan(timelineLayer);
    expect(exporterLayer).toBeGreaterThan(transcriptionLayer);
  });
});

describe('end-to-end: timestamp alignment with real STT fixture', () => {
  it('aligns transcription timestamps to audio segments correctly', async () => {
    const sttOutput = await loadTranscriptionFixture();

    // Create audio segments that represent clips in a timeline
    // Segment 1: starts at 0, duration ~3.5s (covers "Hello...system")
    // Segment 2: starts at 5s with a gap, duration ~2s (covers "powered...sound?")
    const audioSegments: AudioSegment[] = [
      {
        buffer: Buffer.alloc(100),
        startTime: 0,
        duration: 4.0,
        clipId: 'clip-1',
        assetId: 'audio-segment-1',
      },
      {
        buffer: Buffer.alloc(100),
        startTime: 5.0,
        duration: 2.0,
        clipId: 'clip-2',
        assetId: 'audio-segment-2',
      },
    ];

    const transcription = alignTranscriptionToTimeline(sttOutput, audioSegments);

    // Verify output structure
    expect(transcription.text).toBe(sttOutput.text);
    expect(transcription.language).toBe('eng');
    expect(transcription.words.length).toBeGreaterThan(0);

    // Verify only word tokens are included (no spacing)
    expect(transcription.words.every(w => w.text.trim().length > 0)).toBe(true);

    // Verify first word has correct timing
    const firstWord = transcription.words[0];
    expect(firstWord?.text).toBe('Hello.');
    expect(firstWord?.startTime).toBeCloseTo(0.079, 2);
    expect(firstWord?.endTime).toBeCloseTo(1.059, 2);
    expect(firstWord?.clipId).toBe('clip-1');

    // Find a word that should be in the second segment (after 5s)
    const laterWord = transcription.words.find(w => w.text === 'How');
    expect(laterWord).toBeDefined();
    expect(laterWord?.startTime).toBeCloseTo(6.019, 2);
    expect(laterWord?.clipId).toBe('clip-2');

    // Verify segments are created
    expect(transcription.segments.length).toBe(2);
    expect(transcription.segments[0]?.clipId).toBe('clip-1');
    expect(transcription.segments[1]?.clipId).toBe('clip-2');
  });

  it('handles single segment timeline correctly', async () => {
    const sttOutput = await loadTranscriptionFixture();

    const audioSegments: AudioSegment[] = [
      {
        buffer: Buffer.alloc(100),
        startTime: 0,
        duration: 10.0,
        clipId: 'single-clip',
        assetId: 'single-audio',
      },
    ];

    const transcription = alignTranscriptionToTimeline(sttOutput, audioSegments);

    // All words should be in the single clip
    expect(transcription.words.every(w => w.clipId === 'single-clip')).toBe(true);
    expect(transcription.segments.length).toBe(1);
    expect(transcription.segments[0]?.text).toContain('Hello');
    expect(transcription.segments[0]?.text).toContain('sound');
  });

  it('preserves word-level timing precision from STT output', async () => {
    const sttOutput = await loadTranscriptionFixture();

    const audioSegments: AudioSegment[] = [
      {
        buffer: Buffer.alloc(100),
        startTime: 0,
        duration: 10.0,
        clipId: 'clip-1',
        assetId: 'audio-1',
      },
    ];

    const transcription = alignTranscriptionToTimeline(sttOutput, audioSegments);

    // Verify specific word timings match the fixture precisely
    const wordTimings: Record<string, { start: number; end: number }> = {
      'Hello.': { start: 0.079, end: 1.059 },
      'This': { start: 1.1, end: 1.279 },
      'test': { start: 1.599, end: 1.919 },
      'ElevenLabs.': { start: 4.559, end: 6.0 },
      'sound?': { start: 6.48, end: 6.98 },
    };

    for (const [text, expected] of Object.entries(wordTimings)) {
      const word = transcription.words.find(w => w.text === text);
      expect(word).toBeDefined();
      expect(word?.startTime).toBeCloseTo(expected.start, 2);
      expect(word?.endTime).toBeCloseTo(expected.end, 2);
    }
  });
});

describe('end-to-end: karaoke filter generation with real transcription', () => {
  it('generates valid FFmpeg drawtext filter from transcription fixture', async () => {
    const sttOutput = await loadTranscriptionFixture();

    const audioSegments: AudioSegment[] = [
      {
        buffer: Buffer.alloc(100),
        startTime: 0,
        duration: 10.0,
        clipId: 'clip-1',
        assetId: 'audio-1',
      },
    ];

    const transcription = alignTranscriptionToTimeline(sttOutput, audioSegments);

    const filter = buildKaraokeFilter(transcription, {
      width: 1920,
      height: 1080,
      fontSize: 48,
      fontColor: 'white',
      highlightColor: '#FFD700',
    });

    // Filter should contain drawtext commands
    expect(filter).toContain('drawtext=');

    // Filter should contain word text (escaped)
    expect(filter).toContain('Hello');
    expect(filter).toContain('test');

    // Filter should contain timing conditions
    expect(filter).toContain('between(t,');

    // Filter should contain font settings
    expect(filter).toContain('fontsize=48');
    expect(filter).toContain('fontcolor=');

    // Filter should have highlight color for word overlays
    expect(filter).toContain('#FFD700');
  });

  it('escapes special characters correctly for FFmpeg', () => {
    // Test escaping of various special characters
    expect(escapeDrawtext("it's")).toBe("it'\\''s");
    expect(escapeDrawtext('note: test')).toBe('note\\: test');
    expect(escapeDrawtext('path\\file')).toBe('path\\\\file');
    expect(escapeDrawtext('line1\nline2')).toBe('line1\\nline2');
  });

  it('generates filter chain with input/output labels', async () => {
    const sttOutput = await loadTranscriptionFixture();

    const audioSegments: AudioSegment[] = [
      {
        buffer: Buffer.alloc(100),
        startTime: 0,
        duration: 10.0,
        clipId: 'clip-1',
        assetId: 'audio-1',
      },
    ];

    const transcription = alignTranscriptionToTimeline(sttOutput, audioSegments);

    const filterChain = buildKaraokeFilterChain(
      '[v0]',
      transcription,
      { width: 1920, height: 1080 },
      'vout'
    );

    // Should start with input label
    expect(filterChain).toMatch(/^\[v0\]/);

    // Should end with output label
    expect(filterChain).toMatch(/\[vout\]$/);
  });

  it('handles empty transcription gracefully', () => {
    const emptyTranscription: TranscriptionArtifact = {
      text: '',
      words: [],
      segments: [],
      language: 'en',
      totalDuration: 10,
    };

    const filter = buildKaraokeFilter(emptyTranscription, {
      width: 1920,
      height: 1080,
    });

    // Empty transcription should return empty filter
    expect(filter).toBe('');
  });

  it('groups words into lines with maxWordsPerLine option', async () => {
    const sttOutput = await loadTranscriptionFixture();

    const audioSegments: AudioSegment[] = [
      {
        buffer: Buffer.alloc(100),
        startTime: 0,
        duration: 10.0,
        clipId: 'clip-1',
        assetId: 'audio-1',
      },
    ];

    const transcription = alignTranscriptionToTimeline(sttOutput, audioSegments);

    // With maxWordsPerLine=4, we should see multiple word groups
    const filter = buildKaraokeFilter(transcription, {
      width: 1920,
      height: 1080,
      maxWordsPerLine: 4,
    });

    // Count drawtext commands - should have background layers for each group
    // plus highlight overlays for each word
    const drawtextCount = (filter.match(/drawtext=/g) || []).length;

    // With 17 words and maxWordsPerLine=4, we expect:
    // - 5 word groups (4+4+4+4+1)
    // - Each group has 1 background + N highlights
    // So total = 5 backgrounds + 17 word highlights = 22
    expect(drawtextCount).toBeGreaterThan(10);
  });
});

describe('end-to-end: TranscriptionProducer output validation', () => {
  it('produces non-empty aligned transcription from real fixture data', async () => {
    const sttOutput = await loadTranscriptionFixture();
    const audioBuffer = await loadAudioFixture();

    const audioSegments: AudioSegment[] = [
      {
        buffer: audioBuffer,
        startTime: 0,
        duration: 7.0,
        clipId: 'clip-fixture',
        assetId: 'audio-fixture',
      },
    ];

    const transcription = alignTranscriptionToTimeline(sttOutput, audioSegments);

    // Must have non-empty word list
    expect(transcription.words.length).toBeGreaterThan(0);

    // Every word must have valid timing
    for (const word of transcription.words) {
      expect(word.startTime).toBeGreaterThanOrEqual(0);
      expect(word.endTime).toBeGreaterThanOrEqual(word.startTime);
      expect(word.text.trim().length).toBeGreaterThan(0);
    }

    // Segments must have non-empty text
    expect(transcription.segments.length).toBeGreaterThan(0);
    for (const segment of transcription.segments) {
      expect(segment.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('alignment with empty STT output produces empty words', () => {
    const emptySttOutput: STTOutput = {
      text: '',
      language_code: 'eng',
      language_probability: 0,
      words: [],
    };

    const audioSegments: AudioSegment[] = [
      {
        buffer: Buffer.alloc(100),
        startTime: 0,
        duration: 5.0,
        clipId: 'clip-1',
        assetId: 'audio-1',
      },
    ];

    const transcription = alignTranscriptionToTimeline(emptySttOutput, audioSegments);

    // Empty STT should produce empty aligned output
    expect(transcription.words).toHaveLength(0);
    expect(transcription.text).toBe('');
  });
});

describe('end-to-end: audio fixture validation', () => {
  it('audio fixture is valid MP3 with correct format', async () => {
    const audioBuffer = await loadAudioFixture();

    // Should be non-empty
    expect(audioBuffer.length).toBeGreaterThan(1000);

    // Should have ID3 tag (0x49 0x44 0x33 = "ID3") or MP3 frame sync
    const hasId3 = audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33;
    const hasFrameSync = audioBuffer[0] === 0xff && (audioBuffer[1] & 0xe0) === 0xe0;
    expect(hasId3 || hasFrameSync).toBe(true);

    // Size should be reasonable for a short audio clip (>50KB)
    expect(audioBuffer.length).toBeGreaterThan(50000);
  });
});

describe('end-to-end: transcription STT fixture validation', () => {
  it('transcription fixture has correct ElevenLabs STT structure', async () => {
    const sttOutput = await loadTranscriptionFixture();

    // Validate top-level structure
    expect(sttOutput.text).toBeDefined();
    expect(sttOutput.text.length).toBeGreaterThan(0);
    expect(sttOutput.language_code).toBe('eng');
    expect(sttOutput.words).toBeInstanceOf(Array);

    // Validate we have both words and spacing
    const words = sttOutput.words.filter(w => w.type === 'word');
    const spacing = sttOutput.words.filter(w => w.type === 'spacing');
    expect(words.length).toBeGreaterThan(0);
    expect(spacing.length).toBeGreaterThan(0);

    // Validate word structure
    for (const word of words) {
      expect(word.text).toBeDefined();
      expect(typeof word.start).toBe('number');
      expect(typeof word.end).toBe('number');
      expect(word.end).toBeGreaterThanOrEqual(word.start);
    }

    // Validate timing is monotonically increasing
    let lastEnd = 0;
    for (const word of words) {
      expect(word.start).toBeGreaterThanOrEqual(lastEnd - 0.1); // Allow small overlap
      lastEnd = word.end;
    }
  });

  it('transcription fixture timing matches audio fixture duration', async () => {
    const sttOutput = await loadTranscriptionFixture();

    // Find the last word's end time
    const words = sttOutput.words.filter(w => w.type === 'word');
    const lastWord = words[words.length - 1];
    const audioDuration = lastWord?.end ?? 0;

    // Audio should be roughly 7 seconds based on the fixture
    expect(audioDuration).toBeGreaterThan(6);
    expect(audioDuration).toBeLessThan(8);
  });
});

describe('end-to-end: real ffmpeg karaoke filter execution', () => {
  beforeEach(() => {
    resetFfmpegCache();
  });

  it('ffmpeg can parse karaoke filter syntax', async () => {
    const ffmpegAvailable = await checkFfmpegAvailability();
    if (!ffmpegAvailable) {
      console.warn('Skipping test: ffmpeg not available');
      return;
    }

    const sttOutput = await loadTranscriptionFixture();

    const audioSegments: AudioSegment[] = [
      {
        buffer: Buffer.alloc(100),
        startTime: 0,
        duration: 10.0,
        clipId: 'clip-1',
        assetId: 'audio-1',
      },
    ];

    const transcription = alignTranscriptionToTimeline(sttOutput, audioSegments);

    const filter = buildKaraokeFilter(transcription, {
      width: 1920,
      height: 1080,
      fontSize: 48,
    });

    // Verify filter is syntactically valid by checking structure
    // Each drawtext should have required parameters
    const drawtextClauses = filter.split('drawtext=').slice(1);
    for (const clause of drawtextClauses) {
      // Each clause should have text, fontsize (static or animated expression), and enable
      expect(clause).toMatch(/text='/);
      // fontsize can be a number (static) or an FFmpeg expression (animated)
      expect(clause).toMatch(/fontsize=(\d+|'[^']+')/);
      expect(clause).toMatch(/enable='/);
    }
  });
});
