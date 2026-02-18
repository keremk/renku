import { describe, it, expect } from 'vitest';
import { buildFfmpegCommand, detectOutputFormat } from './command-builder.js';
import type {
  TimelineDocument,
  TimelineTrack,
  ImageTrack,
  ImageClip,
  VideoTrack,
  VideoClip,
  MusicTrack,
  MusicClip,
  TextTrack,
  TextClip,
} from '@gorenku/compositions';
import type { AssetPathMap } from './types.js';

type ProbeFixture = Record<string, boolean>;
type ImageDimensionsFixture = { width: number; height: number };

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
 * Create a minimal music clip for testing.
 */
function createMusicClip(overrides: Partial<MusicClip> = {}): MusicClip {
  return {
    id: 'music-clip-1',
    kind: 'Music',
    startTime: 0,
    duration: 10,
    properties: {
      assetId: 'Artifact:TestProducer.Music',
    },
    ...overrides,
  };
}

/**
 * Create a minimal image clip for testing.
 */
function createImageClip(overrides: Partial<ImageClip> = {}): ImageClip {
  return {
    id: 'image-clip-1',
    kind: 'Image',
    startTime: 0,
    duration: 10,
    properties: {
      effect: 'KenBurns',
      effects: [
        {
          assetId: 'Artifact:TestProducer.Image',
          startScale: 1,
          endScale: 1.2,
          startX: 0,
          endX: 0,
          startY: 0,
          endY: 0,
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Create a minimal video track for testing.
 */
function createVideoTrack(clips: VideoClip[]): VideoTrack {
  return {
    id: 'video-track-1',
    kind: 'Video',
    clips,
  };
}

/**
 * Create a minimal music track for testing.
 */
function createMusicTrack(clips: MusicClip[]): MusicTrack {
  return {
    id: 'music-track-1',
    kind: 'Music',
    clips,
  };
}

/**
 * Create a minimal image track for testing.
 */
function createImageTrack(clips: ImageClip[]): ImageTrack {
  return {
    id: 'image-track-1',
    kind: 'Image',
    clips,
  };
}

/**
 * Create a minimal text clip for testing.
 */
function createTextClip(overrides: Partial<TextClip> = {}): TextClip {
  return {
    id: 'text-clip-1',
    kind: 'Text',
    startTime: 0,
    duration: 10,
    properties: {
      effect: 'fade-in-out',
      effects: [
        {
          text: 'Hello world',
          transition: 'fade-in-out',
          startTime: 0,
          duration: 10,
        },
      ],
    },
    ...overrides,
  };
}

/**
 * Create a minimal text track for testing.
 */
function createTextTrack(clips: TextClip[]): TextTrack {
  return {
    id: 'text-track-1',
    kind: 'Text',
    clips,
  };
}

/**
 * Create a minimal timeline document for testing.
 */
function createTimeline(
  tracks: TimelineTrack[],
  duration = 10
): TimelineDocument {
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

async function buildCommandWithProbe(
  timeline: TimelineDocument,
  assetPaths: AssetPathMap,
  probeFixture: ProbeFixture,
  imageDimensions: ImageDimensionsFixture = { width: 1920, height: 1080 }
) {
  return buildFfmpegCommand(
    timeline,
    assetPaths,
    {
      width: 1920,
      height: 1080,
      fps: 30,
    },
    undefined,
    undefined,
    {
      probeVideoAudioStream: async ({ assetId }) => {
        const result = probeFixture[assetId];
        if (result === undefined) {
          throw new Error(`Missing probe fixture for video asset '${assetId}'`);
        }
        return result;
      },
      probeImageDimensions: async () => imageDimensions,
    }
  );
}

describe('command-builder', () => {
  describe('buildFfmpegCommand', () => {
    describe('video clip audio extraction', () => {
      it('extracts audio from video clips by default (volume undefined)', async () => {
        const clip = createVideoClip();
        const track = createVideoTrack([clip]);
        const timeline = createTimeline([track], 10);
        const assetPaths: AssetPathMap = {
          'Artifact:TestProducer.Video': '/path/to/video.mp4',
        };

        const result = await buildCommandWithProbe(timeline, assetPaths, {
          'Artifact:TestProducer.Video': true,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();
        expect(filterComplex).not.toContain('anullsrc');
        expect(filterComplex).toContain('[0:a]');
      });

      it('extracts audio from video clips when volume is explicitly set to 1', async () => {
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

        const result = await buildCommandWithProbe(timeline, assetPaths, {
          'Artifact:TestProducer.Video': true,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();
        expect(filterComplex).toContain('[0:a]');
        expect(filterComplex).not.toContain('anullsrc');
      });

      it('strips audio from video clips when volume is explicitly 0', async () => {
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

        const result = await buildCommandWithProbe(timeline, assetPaths, {
          'Artifact:TestProducer.Video': true,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();
        expect(filterComplex).toContain('anullsrc');
        expect(filterComplex).not.toContain('[0:a]');
      });

      it('applies volume scaling when volume is between 0 and 1', async () => {
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

        const result = await buildCommandWithProbe(timeline, assetPaths, {
          'Artifact:TestProducer.Video': true,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();
        expect(filterComplex).toContain('[0:a]');
        expect(filterComplex).toContain('volume=0.5');
      });

      it('mixes music without referencing video audio when video input is video-only', async () => {
        const videoClip = createVideoClip({
          properties: { assetId: 'Artifact:TestProducer.VideoOnly' },
        });
        const musicClip = createMusicClip({
          properties: { assetId: 'Artifact:TestProducer.Music', volume: 0.3 },
        });
        const timeline = createTimeline(
          [createVideoTrack([videoClip]), createMusicTrack([musicClip])],
          10
        );
        const assetPaths: AssetPathMap = {
          'Artifact:TestProducer.VideoOnly': '/path/to/video-only.mp4',
          'Artifact:TestProducer.Music': '/path/to/music.mp3',
        };

        const result = await buildCommandWithProbe(timeline, assetPaths, {
          'Artifact:TestProducer.VideoOnly': false,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();
        expect(filterComplex).not.toContain('[0:a]');
        expect(filterComplex).toContain('[1:a]');
        expect(filterComplex).not.toContain('anullsrc');
      });

      it('generates silence when all video clips are video-only and no other audio tracks exist', async () => {
        const videoClip = createVideoClip({
          properties: { assetId: 'Artifact:TestProducer.VideoOnly' },
        });
        const timeline = createTimeline([createVideoTrack([videoClip])], 10);
        const assetPaths: AssetPathMap = {
          'Artifact:TestProducer.VideoOnly': '/path/to/video-only.mp4',
        };

        const result = await buildCommandWithProbe(timeline, assetPaths, {
          'Artifact:TestProducer.VideoOnly': false,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();
        expect(filterComplex).toContain('anullsrc');
        expect(filterComplex).not.toContain('[0:a]');
      });

      it('mixes only audio-capable video clips when input set is mixed', async () => {
        const firstVideoClip = createVideoClip({
          id: 'clip-1',
          properties: { assetId: 'Artifact:TestProducer.VideoOnly' },
        });
        const secondVideoClip = createVideoClip({
          id: 'clip-2',
          properties: { assetId: 'Artifact:TestProducer.VideoWithAudio' },
        });
        const musicClip = createMusicClip({
          properties: { assetId: 'Artifact:TestProducer.Music', volume: 0.3 },
        });

        const timeline = createTimeline(
          [
            createVideoTrack([firstVideoClip, secondVideoClip]),
            createMusicTrack([musicClip]),
          ],
          10
        );
        const assetPaths: AssetPathMap = {
          'Artifact:TestProducer.VideoOnly': '/path/to/video-only.mp4',
          'Artifact:TestProducer.VideoWithAudio':
            '/path/to/video-with-audio.mp4',
          'Artifact:TestProducer.Music': '/path/to/music.mp3',
        };

        const result = await buildCommandWithProbe(timeline, assetPaths, {
          'Artifact:TestProducer.VideoOnly': false,
          'Artifact:TestProducer.VideoWithAudio': true,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();
        expect(filterComplex).not.toContain('[0:a]');
        expect(filterComplex).toContain('[1:a]');
        expect(filterComplex).toContain('[2:a]');
        expect(filterComplex).toContain('amix=inputs=2');
      });

      it('keeps existing behavior when all video inputs expose audio streams', async () => {
        const firstVideoClip = createVideoClip({
          id: 'clip-1',
          properties: { assetId: 'Artifact:TestProducer.VideoA' },
        });
        const secondVideoClip = createVideoClip({
          id: 'clip-2',
          properties: { assetId: 'Artifact:TestProducer.VideoB' },
        });
        const timeline = createTimeline([
          createVideoTrack([firstVideoClip, secondVideoClip]),
        ]);
        const assetPaths: AssetPathMap = {
          'Artifact:TestProducer.VideoA': '/path/to/video-a.mp4',
          'Artifact:TestProducer.VideoB': '/path/to/video-b.mp4',
        };

        const result = await buildCommandWithProbe(timeline, assetPaths, {
          'Artifact:TestProducer.VideoA': true,
          'Artifact:TestProducer.VideoB': true,
        });

        const filterComplex = getFilterComplex(result.args);
        expect(filterComplex).toBeDefined();
        expect(filterComplex).toContain('[0:a]');
        expect(filterComplex).toContain('[1:a]');
        expect(filterComplex).toContain('amix=inputs=2');
        expect(filterComplex).not.toContain('anullsrc');
      });
    });

    it('uses looped image inputs with crop-based KenBurns pipeline', async () => {
      const imageClip = createImageClip();
      const timeline = createTimeline([createImageTrack([imageClip])], 10);
      const assetPaths: AssetPathMap = {
        'Artifact:TestProducer.Image': '/path/to/image.png',
      };

      const result = await buildFfmpegCommand(
        timeline,
        assetPaths,
        {
          width: 1920,
          height: 1080,
          fps: 30,
        },
        undefined,
        undefined,
        {
          probeImageDimensions: async () => ({ width: 1408, height: 768 }),
        }
      );

      expect(result.args).toContain('-loop');
      expect(result.args).toContain('1');
      expect(result.args).toContain('-framerate');
      expect(result.args).toContain('30');
      expect(result.args).toContain('-t');
      expect(result.args).toContain('-i');
      expect(result.args).toContain('/path/to/image.png');

      const filterComplex = getFilterComplex(result.args);
      expect(filterComplex).toContain('zoompan=');
    });

    it('renders text-only timelines as video with drawtext overlay', async () => {
      const textClip = createTextClip();
      const timeline = createTimeline([createTextTrack([textClip])], 10);
      const assetPaths: AssetPathMap = {};

      const result = await buildFfmpegCommand(timeline, assetPaths, {
        width: 1920,
        height: 1080,
        fps: 30,
      });

      const filterComplex = getFilterComplex(result.args);
      expect(filterComplex).toContain('color=c=black');
      expect(filterComplex).toContain('drawtext=');
      expect(result.mimeType).toBe('video/mp4');
      expect(result.outputPath.endsWith('.mp4')).toBe(true);
    });

    it('applies text transition expressions for slide and spring effects', async () => {
      const textClip = createTextClip({
        properties: {
          effect: 'slide-in-out-left',
          effects: [
            {
              text: 'Slide text',
              transition: 'slide-in-out-left',
              startTime: 0,
              duration: 5,
            },
            {
              text: 'Spring text',
              transition: 'spring-in-out',
              startTime: 5,
              duration: 5,
            },
          ],
        },
      });
      const timeline = createTimeline([createTextTrack([textClip])], 10);
      const assetPaths: AssetPathMap = {};

      const result = await buildFfmpegCommand(timeline, assetPaths, {
        width: 1920,
        height: 1080,
        fps: 30,
      });

      const filterComplex = getFilterComplex(result.args);
      expect(filterComplex).toContain('drawtext=');
      expect(filterComplex).toContain('sin(12*');
      expect(filterComplex).toContain('if(lt(t');
    });
  });

  describe('detectOutputFormat', () => {
    it('returns video when timeline has video tracks', () => {
      const clip = createVideoClip();
      const track = createVideoTrack([clip]);
      const timeline = createTimeline([track]);

      expect(detectOutputFormat(timeline)).toBe('video');
    });

    it('returns video when timeline has text tracks', () => {
      const clip = createTextClip();
      const track = createTextTrack([clip]);
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
