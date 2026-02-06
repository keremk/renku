import { describe, it, expect } from 'vitest';
import { buildFfmpegCommand, detectOutputFormat } from './command-builder.js';
import type { TimelineDocument, VideoTrack, VideoClip } from '@gorenku/compositions';
import type { AssetPathMap } from './types.js';

/**
 * Create a minimal video clip for testing.
 */
function createVideoClip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    id: 'clip-1',
    kind: 'Video',
    startTime: 0,
    duration: 10,
    properties: {
      assetId: 'Artifact:TestProducer.Video',
    },
    ...overrides,
  };
}

/**
 * Create a minimal video track for testing.
 */
function createVideoTrack(clips: VideoClip[]): VideoTrack {
  return {
    id: 'track-1',
    kind: 'Video',
    clips,
  };
}

/**
 * Create a minimal timeline document for testing.
 */
function createTimeline(tracks: VideoTrack[], duration = 10): TimelineDocument {
  return {
    id: 'test-timeline',
    duration,
    tracks,
  };
}

/**
 * Extract the filter_complex string from FFmpeg args.
 */
function getFilterComplex(args: string[]): string | undefined {
  const idx = args.indexOf('-filter_complex');
  return idx >= 0 ? args[idx + 1] : undefined;
}

describe('command-builder', () => {
  describe('buildFfmpegCommand', () => {
    describe('video clip audio extraction', () => {
      it('extracts audio from video clips by default (volume undefined)', () => {
        const clip = createVideoClip({
          // volume is undefined - should default to 1 and extract audio
        });
        const track = createVideoTrack([clip]);
        const timeline = createTimeline([track], 10);
        const assetPaths: AssetPathMap = {
          'Artifact:TestProducer.Video': '/path/to/video.mp4',
        };

        const result = buildFfmpegCommand(timeline, assetPaths, {
          width: 1920,
          height: 1080,
          fps: 30,
        });

        // The filter_complex should include audio processing for the video clip
        // When audio is extracted, it goes through the audio mixer
        // If no audio was extracted, it would use anullsrc (silence generator)
        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();

        // Should NOT have silence generator when video audio is extracted
        expect(filterComplex).not.toContain('anullsrc');

        // Should have audio volume/mix filter referencing the video input's audio
        expect(filterComplex).toContain('[0:a]');
      });

      it('extracts audio from video clips when volume is explicitly set to 1', () => {
        const clip = createVideoClip({
          properties: {
            assetId: 'Artifact:TestProducer.Video',
            volume: 1,
          },
        });
        const track = createVideoTrack([clip]);
        const timeline = createTimeline([track], 10);
        const assetPaths: AssetPathMap = {
          'Artifact:TestProducer.Video': '/path/to/video.mp4',
        };

        const result = buildFfmpegCommand(timeline, assetPaths, {
          width: 1920,
          height: 1080,
          fps: 30,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();

        // Should have audio processing
        expect(filterComplex).toContain('[0:a]');
        expect(filterComplex).not.toContain('anullsrc');
      });

      it('strips audio from video clips when volume is explicitly 0', () => {
        const clip = createVideoClip({
          properties: {
            assetId: 'Artifact:TestProducer.Video',
            volume: 0,
          },
        });
        const track = createVideoTrack([clip]);
        const timeline = createTimeline([track], 10);
        const assetPaths: AssetPathMap = {
          'Artifact:TestProducer.Video': '/path/to/video.mp4',
        };

        const result = buildFfmpegCommand(timeline, assetPaths, {
          width: 1920,
          height: 1080,
          fps: 30,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();

        // When volume is 0, audio is not extracted
        // The filter should use anullsrc to generate silence
        expect(filterComplex).toContain('anullsrc');

        // Should NOT reference the video's audio stream
        expect(filterComplex).not.toContain('[0:a]');
      });

      it('applies volume scaling when volume is between 0 and 1', () => {
        const clip = createVideoClip({
          properties: {
            assetId: 'Artifact:TestProducer.Video',
            volume: 0.5,
          },
        });
        const track = createVideoTrack([clip]);
        const timeline = createTimeline([track], 10);
        const assetPaths: AssetPathMap = {
          'Artifact:TestProducer.Video': '/path/to/video.mp4',
        };

        const result = buildFfmpegCommand(timeline, assetPaths, {
          width: 1920,
          height: 1080,
          fps: 30,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();

        // Should have audio processing with volume adjustment
        expect(filterComplex).toContain('[0:a]');
        expect(filterComplex).toContain('volume=0.5');
      });
    });
  });

  describe('detectOutputFormat', () => {
    it('returns video when timeline has video tracks', () => {
      const clip = createVideoClip();
      const track = createVideoTrack([clip]);
      const timeline = createTimeline([track]);

      expect(detectOutputFormat(timeline)).toBe('video');
    });

    it('returns audio when timeline has only audio tracks', () => {
      const timeline: TimelineDocument = {
        id: 'test-timeline',
        duration: 10,
        tracks: [
          {
            id: 'audio-track',
            kind: 'Audio',
            clips: [],
          },
        ],
      };

      expect(detectOutputFormat(timeline)).toBe('audio');
    });
  });
});
