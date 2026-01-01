import { describe, it, expect } from 'vitest';
import { buildFfmpegCommand, detectOutputFormat } from './command-builder.js';
import type { TimelineDocument } from '@gorenku/compositions';
import type { AssetPathMap } from './types.js';

describe('command-builder', () => {
  describe('detectOutputFormat', () => {
    it('should detect video format when image track exists', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          {
            id: 'track-0',
            kind: 'Image',
            clips: [],
          },
        ],
      };

      expect(detectOutputFormat(timeline)).toBe('video');
    });

    it('should detect video format when video track exists', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          {
            id: 'track-0',
            kind: 'Video',
            clips: [],
          },
        ],
      };

      expect(detectOutputFormat(timeline)).toBe('video');
    });

    it('should detect audio format when only audio tracks exist', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          {
            id: 'track-0',
            kind: 'Audio',
            clips: [],
          },
          {
            id: 'track-1',
            kind: 'Music',
            clips: [],
          },
        ],
      };

      expect(detectOutputFormat(timeline)).toBe('audio');
    });

    it('should detect audio format when no tracks exist', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [],
      };

      expect(detectOutputFormat(timeline)).toBe('audio');
    });
  });

  describe('buildFfmpegCommand', () => {
    it('should build a command with image track', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          {
            id: 'track-0',
            kind: 'Image',
            clips: [
              {
                id: 'clip-0',
                kind: 'Image',
                startTime: 0,
                duration: 10,
                properties: {
                  effect: 'KenBurns',
                  effects: [
                    {
                      assetId: 'Artifact:Image[0][0]',
                      startScale: 1,
                      endScale: 1.2,
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const assetPaths: AssetPathMap = {
        'Artifact:Image[0][0]': '/path/to/image.jpg',
      };

      const command = buildFfmpegCommand(timeline, assetPaths, {
        outputPath: 'output.mp4',
      });

      expect(command.ffmpegPath).toBe('ffmpeg');
      expect(command.args).toContain('-y');
      expect(command.args).toContain('-filter_complex');
      expect(command.args).toContain('-c:v');
      expect(command.args).toContain('libx264');
      expect(command.mimeType).toBe('video/mp4');
      expect(command.outputPath).toBe('output.mp4');
      expect(command.inputFiles).toContain('/path/to/image.jpg');
    });

    it('should build a command with audio track only', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 30,
        tracks: [
          {
            id: 'track-0',
            kind: 'Audio',
            clips: [
              {
                id: 'clip-0',
                kind: 'Audio',
                startTime: 0,
                duration: 30,
                properties: {
                  assetId: 'Artifact:Audio[0]',
                  volume: 1,
                },
              },
            ],
          },
        ],
      };

      const assetPaths: AssetPathMap = {
        'Artifact:Audio[0]': '/path/to/audio.mp3',
      };

      const command = buildFfmpegCommand(timeline, assetPaths, {
        outputPath: 'output.mp4',
      });

      expect(command.args).toContain('-c:a');
      expect(command.args).toContain('libmp3lame');
      expect(command.mimeType).toBe('audio/mpeg');
      expect(command.outputPath).toBe('output.mp3'); // Changed to mp3
      expect(command.inputFiles).toContain('/path/to/audio.mp3');
    });

    it('should build a command with multiple tracks', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 20,
        tracks: [
          {
            id: 'track-0',
            kind: 'Image',
            clips: [
              {
                id: 'clip-0',
                kind: 'Image',
                startTime: 0,
                duration: 10,
                properties: {
                  effects: [
                    { assetId: 'Artifact:Image[0][0]', startScale: 1, endScale: 1.2 },
                  ],
                },
              },
              {
                id: 'clip-1',
                kind: 'Image',
                startTime: 10,
                duration: 10,
                properties: {
                  effects: [
                    { assetId: 'Artifact:Image[1][0]', startScale: 1.2, endScale: 1 },
                  ],
                },
              },
            ],
          },
          {
            id: 'track-1',
            kind: 'Audio',
            clips: [
              {
                id: 'clip-a0',
                kind: 'Audio',
                startTime: 0,
                duration: 20,
                properties: {
                  assetId: 'Artifact:Audio[0]',
                  volume: 1,
                },
              },
            ],
          },
        ],
      };

      const assetPaths: AssetPathMap = {
        'Artifact:Image[0][0]': '/path/to/img1.jpg',
        'Artifact:Image[1][0]': '/path/to/img2.jpg',
        'Artifact:Audio[0]': '/path/to/audio.mp3',
      };

      const command = buildFfmpegCommand(timeline, assetPaths, {
        outputPath: 'output.mp4',
      });

      expect(command.inputFiles).toHaveLength(3);
      expect(command.mimeType).toBe('video/mp4');
      // Should have concat filter for multiple images
      expect(command.args.join(' ')).toContain('concat=n=2');
    });

    it('should handle music track with loop', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 60,
        tracks: [
          {
            id: 'track-0',
            kind: 'Music',
            clips: [
              {
                id: 'clip-0',
                kind: 'Music',
                startTime: 0,
                duration: 60,
                properties: {
                  assetId: 'Artifact:Music[0]',
                  volume: 0.3,
                  play: 'loop',
                  duration: 'full',
                },
              },
            ],
          },
        ],
      };

      const assetPaths: AssetPathMap = {
        'Artifact:Music[0]': '/path/to/music.mp3',
      };

      const command = buildFfmpegCommand(timeline, assetPaths, {
        outputPath: 'output.mp3',
      });

      expect(command.args).toContain('-stream_loop');
      expect(command.inputFiles).toContain('/path/to/music.mp3');
    });

    it('should apply custom encoding options', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          {
            id: 'track-0',
            kind: 'Image',
            clips: [
              {
                id: 'clip-0',
                kind: 'Image',
                startTime: 0,
                duration: 10,
                properties: {
                  effects: [{ assetId: 'Artifact:Image[0][0]' }],
                },
              },
            ],
          },
        ],
      };

      const assetPaths: AssetPathMap = {
        'Artifact:Image[0][0]': '/path/to/image.jpg',
      };

      const command = buildFfmpegCommand(timeline, assetPaths, {
        width: 1280,
        height: 720,
        fps: 24,
        preset: 'fast',
        crf: 18,
        audioBitrate: '256k',
        outputPath: 'output.mp4',
      });

      expect(command.args).toContain('fast');
      expect(command.args).toContain('18');
      expect(command.args).toContain('256k');
    });

    it('should handle video track', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 15,
        tracks: [
          {
            id: 'track-0',
            kind: 'Video',
            clips: [
              {
                id: 'clip-0',
                kind: 'Video',
                startTime: 0,
                duration: 15,
                properties: {
                  assetId: 'Artifact:Video[0]',
                  originalDuration: 12,
                  fitStrategy: 'stretch',
                  volume: 0.5,
                },
              },
            ],
          },
        ],
      };

      const assetPaths: AssetPathMap = {
        'Artifact:Video[0]': '/path/to/video.mp4',
      };

      const command = buildFfmpegCommand(timeline, assetPaths, {
        outputPath: 'output.mp4',
      });

      expect(command.inputFiles).toContain('/path/to/video.mp4');
      expect(command.mimeType).toBe('video/mp4');
    });

    it('should handle captions track', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          {
            id: 'track-0',
            kind: 'Image',
            clips: [
              {
                id: 'clip-0',
                kind: 'Image',
                startTime: 0,
                duration: 10,
                properties: {
                  effects: [{ assetId: 'Artifact:Image[0][0]' }],
                },
              },
            ],
          },
          {
            id: 'track-1',
            kind: 'Captions',
            clips: [
              {
                id: 'clip-c0',
                kind: 'Captions',
                startTime: 0,
                duration: 10,
                properties: {
                  captions: ['First caption', 'Second caption'],
                },
              },
            ],
          },
        ],
      };

      const assetPaths: AssetPathMap = {
        'Artifact:Image[0][0]': '/path/to/image.jpg',
      };

      const command = buildFfmpegCommand(timeline, assetPaths, {
        outputPath: 'output.mp4',
      });

      // Should have drawtext filter for captions
      expect(command.args.join(' ')).toContain('drawtext=');
    });

    it('should skip missing assets', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          {
            id: 'track-0',
            kind: 'Image',
            clips: [
              {
                id: 'clip-0',
                kind: 'Image',
                startTime: 0,
                duration: 10,
                properties: {
                  effects: [
                    { assetId: 'Artifact:Image[0][0]' },
                    { assetId: 'Artifact:Image[0][1]' }, // Missing
                  ],
                },
              },
            ],
          },
        ],
      };

      const assetPaths: AssetPathMap = {
        'Artifact:Image[0][0]': '/path/to/image.jpg',
        // Artifact:Image[0][1] is missing
      };

      const command = buildFfmpegCommand(timeline, assetPaths, {
        outputPath: 'output.mp4',
      });

      // Should only have one input file
      expect(command.inputFiles).toHaveLength(1);
    });

    it('should use custom ffmpeg path', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [],
      };

      const command = buildFfmpegCommand(timeline, {}, {
        ffmpegPath: '/usr/local/bin/ffmpeg',
        outputPath: 'output.mp3',
      });

      expect(command.ffmpegPath).toBe('/usr/local/bin/ffmpeg');
    });
  });
});
