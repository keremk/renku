import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectRequiredExtractions,
  needsExtraction,
  extractDerivedArtefacts,
  resetFfmpegCache,
} from './ffmpeg-extractor.js';

describe('detectRequiredExtractions', () => {
  it('returns null for all when no derived artifacts present', () => {
    const produces = ['Artifact:TextToVideoProducer.GeneratedVideo'];

    const result = detectRequiredExtractions(produces);

    expect(result.firstFrameId).toBeNull();
    expect(result.lastFrameId).toBeNull();
    expect(result.audioTrackId).toBeNull();
  });

  it('detects FirstFrame artifact', () => {
    const produces = [
      'Artifact:TextToVideoProducer.GeneratedVideo',
      'Artifact:TextToVideoProducer.FirstFrame',
    ];

    const result = detectRequiredExtractions(produces);

    expect(result.firstFrameId).toBe('Artifact:TextToVideoProducer.FirstFrame');
    expect(result.lastFrameId).toBeNull();
    expect(result.audioTrackId).toBeNull();
  });

  it('detects LastFrame artifact', () => {
    const produces = [
      'Artifact:TextToVideoProducer.GeneratedVideo',
      'Artifact:TextToVideoProducer.LastFrame',
    ];

    const result = detectRequiredExtractions(produces);

    expect(result.firstFrameId).toBeNull();
    expect(result.lastFrameId).toBe('Artifact:TextToVideoProducer.LastFrame');
    expect(result.audioTrackId).toBeNull();
  });

  it('detects AudioTrack artifact', () => {
    const produces = [
      'Artifact:TextToVideoProducer.GeneratedVideo',
      'Artifact:TextToVideoProducer.AudioTrack',
    ];

    const result = detectRequiredExtractions(produces);

    expect(result.firstFrameId).toBeNull();
    expect(result.lastFrameId).toBeNull();
    expect(result.audioTrackId).toBe('Artifact:TextToVideoProducer.AudioTrack');
  });

  it('detects all derived artifacts', () => {
    const produces = [
      'Artifact:TextToVideoProducer.GeneratedVideo',
      'Artifact:TextToVideoProducer.FirstFrame',
      'Artifact:TextToVideoProducer.LastFrame',
      'Artifact:TextToVideoProducer.AudioTrack',
    ];

    const result = detectRequiredExtractions(produces);

    expect(result.firstFrameId).toBe('Artifact:TextToVideoProducer.FirstFrame');
    expect(result.lastFrameId).toBe('Artifact:TextToVideoProducer.LastFrame');
    expect(result.audioTrackId).toBe('Artifact:TextToVideoProducer.AudioTrack');
  });

  it('handles artifact IDs with indices', () => {
    const produces = [
      'Artifact:VideoProducer[0].GeneratedVideo',
      'Artifact:VideoProducer[0].FirstFrame',
    ];

    const result = detectRequiredExtractions(produces);

    expect(result.firstFrameId).toBe('Artifact:VideoProducer[0].FirstFrame');
  });

  it('handles short artifact IDs without namespace', () => {
    const produces = ['Artifact:GeneratedVideo', 'Artifact:FirstFrame', 'Artifact:LastFrame'];

    const result = detectRequiredExtractions(produces);

    expect(result.firstFrameId).toBe('Artifact:FirstFrame');
    expect(result.lastFrameId).toBe('Artifact:LastFrame');
  });

  it('handles empty produces array', () => {
    const result = detectRequiredExtractions([]);

    expect(result.firstFrameId).toBeNull();
    expect(result.lastFrameId).toBeNull();
    expect(result.audioTrackId).toBeNull();
  });

  it('ignores unrelated artifacts with similar names', () => {
    const produces = [
      'Artifact:FirstFrameImage', // Not exactly "FirstFrame"
      'Artifact:LastFramePreview', // Not exactly "LastFrame"
      'Artifact:AudioTrackMixed', // Not exactly "AudioTrack"
    ];

    const result = detectRequiredExtractions(produces);

    expect(result.firstFrameId).toBeNull();
    expect(result.lastFrameId).toBeNull();
    expect(result.audioTrackId).toBeNull();
  });
});

describe('needsExtraction', () => {
  it('returns false when no extractions needed', () => {
    const extractions = {
      firstFrameId: null,
      lastFrameId: null,
      audioTrackId: null,
    };

    expect(needsExtraction(extractions)).toBe(false);
  });

  it('returns true when firstFrame needed', () => {
    const extractions = {
      firstFrameId: 'Artifact:FirstFrame',
      lastFrameId: null,
      audioTrackId: null,
    };

    expect(needsExtraction(extractions)).toBe(true);
  });

  it('returns true when lastFrame needed', () => {
    const extractions = {
      firstFrameId: null,
      lastFrameId: 'Artifact:LastFrame',
      audioTrackId: null,
    };

    expect(needsExtraction(extractions)).toBe(true);
  });

  it('returns true when audioTrack needed', () => {
    const extractions = {
      firstFrameId: null,
      lastFrameId: null,
      audioTrackId: 'Artifact:AudioTrack',
    };

    expect(needsExtraction(extractions)).toBe(true);
  });

  it('returns true when multiple extractions needed', () => {
    const extractions = {
      firstFrameId: 'Artifact:FirstFrame',
      lastFrameId: 'Artifact:LastFrame',
      audioTrackId: 'Artifact:AudioTrack',
    };

    expect(needsExtraction(extractions)).toBe(true);
  });
});

describe('extractDerivedArtefacts', () => {
  beforeEach(() => {
    resetFfmpegCache();
  });

  describe('simulated mode', () => {
    it('generates mock first frame', async () => {
      const produces = ['Artifact:GeneratedVideo', 'Artifact:FirstFrame'];
      const videoBuffer = Buffer.from('mock video data');

      const result = await extractDerivedArtefacts({
        videoBuffer,
        primaryArtifactId: 'Artifact:GeneratedVideo',
        produces,
        mode: 'simulated',
      });

      expect(result.firstFrame).toBeDefined();
      expect(result.firstFrame?.status).toBe('succeeded');
      expect(result.firstFrame?.artefactId).toBe('Artifact:FirstFrame');
      expect(result.firstFrame?.blob?.mimeType).toBe('image/png');
      expect(result.firstFrame?.diagnostics?.source).toBe('simulated');
    });

    it('generates mock last frame', async () => {
      const produces = ['Artifact:GeneratedVideo', 'Artifact:LastFrame'];
      const videoBuffer = Buffer.from('mock video data');

      const result = await extractDerivedArtefacts({
        videoBuffer,
        primaryArtifactId: 'Artifact:GeneratedVideo',
        produces,
        mode: 'simulated',
      });

      expect(result.lastFrame).toBeDefined();
      expect(result.lastFrame?.status).toBe('succeeded');
      expect(result.lastFrame?.artefactId).toBe('Artifact:LastFrame');
      expect(result.lastFrame?.blob?.mimeType).toBe('image/png');
    });

    it('generates mock audio track with specified duration', async () => {
      const produces = ['Artifact:GeneratedVideo', 'Artifact:AudioTrack'];
      const videoBuffer = Buffer.from('mock video data');
      const mockDurationSeconds = 10;

      const result = await extractDerivedArtefacts({
        videoBuffer,
        primaryArtifactId: 'Artifact:GeneratedVideo',
        produces,
        mode: 'simulated',
        mockDurationSeconds,
      });

      expect(result.audioTrack).toBeDefined();
      expect(result.audioTrack?.status).toBe('succeeded');
      expect(result.audioTrack?.artefactId).toBe('Artifact:AudioTrack');
      expect(result.audioTrack?.blob?.mimeType).toBe('audio/wav');
      expect(result.audioTrack?.diagnostics?.durationSeconds).toBe(mockDurationSeconds);
    });

    it('generates all mock artifacts when requested', async () => {
      const produces = [
        'Artifact:GeneratedVideo',
        'Artifact:FirstFrame',
        'Artifact:LastFrame',
        'Artifact:AudioTrack',
      ];
      const videoBuffer = Buffer.from('mock video data');

      const result = await extractDerivedArtefacts({
        videoBuffer,
        primaryArtifactId: 'Artifact:GeneratedVideo',
        produces,
        mode: 'simulated',
      });

      expect(result.firstFrame).toBeDefined();
      expect(result.lastFrame).toBeDefined();
      expect(result.audioTrack).toBeDefined();
    });

    it('returns empty result when no derived artifacts requested', async () => {
      const produces = ['Artifact:GeneratedVideo'];
      const videoBuffer = Buffer.from('mock video data');

      const result = await extractDerivedArtefacts({
        videoBuffer,
        primaryArtifactId: 'Artifact:GeneratedVideo',
        produces,
        mode: 'simulated',
      });

      expect(result.firstFrame).toBeUndefined();
      expect(result.lastFrame).toBeUndefined();
      expect(result.audioTrack).toBeUndefined();
    });
  });

  describe('live mode', () => {
    // These tests verify behavior in live mode
    // Note: We skip tests that require actual ffmpeg execution with real video data
    // to avoid timeouts and flaky tests in CI environments

    it('detection works correctly in live mode context', async () => {
      // Test that detection logic works correctly even in live mode
      // This doesn't actually invoke ffmpeg since no derived artifacts are requested
      const produces = ['Artifact:GeneratedVideo'];
      const videoBuffer = Buffer.from('mock video data');

      const result = await extractDerivedArtefacts({
        videoBuffer,
        primaryArtifactId: 'Artifact:GeneratedVideo',
        produces,
        mode: 'live',
      });

      // No extraction needed, so result should be empty
      expect(result.firstFrame).toBeUndefined();
      expect(result.lastFrame).toBeUndefined();
      expect(result.audioTrack).toBeUndefined();
    });
  });
});
