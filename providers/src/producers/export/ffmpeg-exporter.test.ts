import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFfmpegExporterHandler, __test__ } from './ffmpeg-exporter.js';
import type { TimelineDocument } from '@gorenku/compositions';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const { parseFfmpegExporterConfig, parseSubtitleConfig, mimeToExtension, collectAssetIds, detectOutputFormat } = __test__;

// Mock child_process for testing
vi.mock('node:child_process', () => ({
  execFile: vi.fn((cmd, args, opts, cb) => {
    if (typeof opts === 'function') {
      cb = opts;
    }
    // Simulate successful FFmpeg execution
    if (cb) {
      cb(null, '', '');
    }
    return {
      on: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
    };
  }),
}));

describe('ffmpeg-exporter', () => {
  describe('parseFfmpegExporterConfig', () => {
    it('should parse valid config', () => {
      const config = parseFfmpegExporterConfig({
        rootFolder: '/path/to/storage',
        width: 1280,
        height: 720,
        fps: 24,
        preset: 'fast',
        crf: 18,
        audioBitrate: '256k',
        ffmpegPath: '/usr/local/bin/ffmpeg',
      });

      expect(config.rootFolder).toBe('/path/to/storage');
      expect(config.width).toBe(1280);
      expect(config.height).toBe(720);
      expect(config.fps).toBe(24);
      expect(config.preset).toBe('fast');
      expect(config.crf).toBe(18);
      expect(config.audioBitrate).toBe('256k');
      expect(config.ffmpegPath).toBe('/usr/local/bin/ffmpeg');
    });

    it('should handle empty config', () => {
      const config = parseFfmpegExporterConfig({});

      expect(config.rootFolder).toBeUndefined();
      expect(config.width).toBeUndefined();
      expect(config.height).toBeUndefined();
    });

    it('should handle null config', () => {
      const config = parseFfmpegExporterConfig(null);

      expect(config.rootFolder).toBeUndefined();
    });

    it('should ignore invalid types', () => {
      const config = parseFfmpegExporterConfig({
        width: 'not a number',
        fps: 'also not a number',
        preset: 123,
      });

      expect(config.width).toBeUndefined();
      expect(config.fps).toBeUndefined();
      expect(config.preset).toBeUndefined();
    });

    it('should parse subtitles config', () => {
      const config = parseFfmpegExporterConfig({
        subtitles: {
          font: 'Helvetica',
          fontSize: 64,
          fontBaseColor: '#FFFFFF',
          fontHighlightColor: '#FFD700',
          backgroundColor: '#000000',
          backgroundOpacity: 0.5,
          bottomMarginPercent: 15,
          maxWordsPerLine: 6,
          highlightEffect: false,
        },
      });

      expect(config.subtitles).toBeDefined();
      expect(config.subtitles?.font).toBe('Helvetica');
      expect(config.subtitles?.fontSize).toBe(64);
      expect(config.subtitles?.fontBaseColor).toBe('#FFFFFF');
      expect(config.subtitles?.fontHighlightColor).toBe('#FFD700');
      expect(config.subtitles?.backgroundColor).toBe('#000000');
      expect(config.subtitles?.backgroundOpacity).toBe(0.5);
      expect(config.subtitles?.bottomMarginPercent).toBe(15);
      expect(config.subtitles?.maxWordsPerLine).toBe(6);
      expect(config.subtitles?.highlightEffect).toBe(false);
    });
  });

  describe('parseSubtitleConfig', () => {
    it('should return undefined for null input', () => {
      expect(parseSubtitleConfig(null)).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
      expect(parseSubtitleConfig(undefined)).toBeUndefined();
    });

    it('should return undefined for non-object input', () => {
      expect(parseSubtitleConfig('string')).toBeUndefined();
      expect(parseSubtitleConfig(123)).toBeUndefined();
    });

    it('should parse all subtitle config fields', () => {
      const config = parseSubtitleConfig({
        font: 'Arial',
        fontSize: 48,
        fontBaseColor: '#FFFFFF',
        fontHighlightColor: '#FFD700',
        backgroundColor: '#000000',
        backgroundOpacity: 0.5,
        bottomMarginPercent: 10,
        maxWordsPerLine: 4,
        highlightEffect: true,
      });

      expect(config?.font).toBe('Arial');
      expect(config?.fontSize).toBe(48);
      expect(config?.fontBaseColor).toBe('#FFFFFF');
      expect(config?.fontHighlightColor).toBe('#FFD700');
      expect(config?.backgroundColor).toBe('#000000');
      expect(config?.backgroundOpacity).toBe(0.5);
      expect(config?.bottomMarginPercent).toBe(10);
      expect(config?.maxWordsPerLine).toBe(4);
      expect(config?.highlightEffect).toBe(true);
    });

    it('should handle partial config', () => {
      const config = parseSubtitleConfig({
        fontSize: 64,
        highlightEffect: false,
      });

      expect(config?.fontSize).toBe(64);
      expect(config?.highlightEffect).toBe(false);
      expect(config?.font).toBeUndefined();
      expect(config?.fontBaseColor).toBeUndefined();
    });

    it('should ignore invalid field types', () => {
      const config = parseSubtitleConfig({
        font: 123, // should be string
        fontSize: 'large', // should be number
        highlightEffect: 'yes', // should be boolean
      });

      expect(config?.font).toBeUndefined();
      expect(config?.fontSize).toBeUndefined();
      expect(config?.highlightEffect).toBeUndefined();
    });
  });

  describe('mimeToExtension', () => {
    it('should convert image MIME types', () => {
      expect(mimeToExtension('image/jpeg')).toBe('jpg');
      expect(mimeToExtension('image/png')).toBe('png');
      expect(mimeToExtension('image/webp')).toBe('webp');
    });

    it('should convert audio MIME types', () => {
      expect(mimeToExtension('audio/mpeg')).toBe('mp3');
      expect(mimeToExtension('audio/mp3')).toBe('mp3');
      expect(mimeToExtension('audio/wav')).toBe('wav');
    });

    it('should convert video MIME types', () => {
      expect(mimeToExtension('video/mp4')).toBe('mp4');
      expect(mimeToExtension('video/webm')).toBe('webm');
    });

    it('should handle JSON', () => {
      expect(mimeToExtension('application/json')).toBe('json');
    });

    it('should return bin for unknown types', () => {
      expect(mimeToExtension('application/octet-stream')).toBe('bin');
      expect(mimeToExtension(undefined)).toBe('bin');
    });
  });

  describe('collectAssetIds', () => {
    it('should collect asset IDs from image tracks', () => {
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
                    { assetId: 'Artifact:Image[0][1]' },
                  ],
                },
              },
            ],
          },
        ],
      };

      const assetIds = collectAssetIds(timeline);

      expect(assetIds.has('Artifact:Image[0][0]')).toBe(true);
      expect(assetIds.has('Artifact:Image[0][1]')).toBe(true);
    });

    it('should collect asset IDs from audio tracks', () => {
      const timeline: TimelineDocument = {
        id: 'test',
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
                  assetId: 'Artifact:Audio[0]',
                },
              },
            ],
          },
        ],
      };

      const assetIds = collectAssetIds(timeline);

      expect(assetIds.has('Artifact:Audio[0]')).toBe(true);
    });

    it('should collect asset IDs from video tracks', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          {
            id: 'track-0',
            kind: 'Video',
            clips: [
              {
                id: 'clip-0',
                kind: 'Video',
                startTime: 0,
                duration: 10,
                properties: {
                  assetId: 'Artifact:Video[0]',
                },
              },
            ],
          },
        ],
      };

      const assetIds = collectAssetIds(timeline);

      expect(assetIds.has('Artifact:Video[0]')).toBe(true);
    });

    it('should handle empty timeline', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [],
      };

      const assetIds = collectAssetIds(timeline);

      expect(assetIds.size).toBe(0);
    });
  });

  describe('detectOutputFormat', () => {
    it('should detect video format for image tracks', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          { id: 'track-0', kind: 'Image', clips: [] },
        ],
      };

      expect(detectOutputFormat(timeline)).toBe('video');
    });

    it('should detect video format for video tracks', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          { id: 'track-0', kind: 'Video', clips: [] },
        ],
      };

      expect(detectOutputFormat(timeline)).toBe('video');
    });

    it('should detect audio format for audio-only tracks', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [
          { id: 'track-0', kind: 'Audio', clips: [] },
          { id: 'track-1', kind: 'Music', clips: [] },
        ],
      };

      expect(detectOutputFormat(timeline)).toBe('audio');
    });
  });

  describe('createFfmpegExporterHandler', () => {
    let tempRoot: string;
    let movieId: string;

    beforeEach(async () => {
      tempRoot = await mkdtemp(path.join(tmpdir(), 'ffmpeg-test-'));
      movieId = 'test-movie-123';

      // Create movie directory structure
      await mkdir(path.join(tempRoot, 'builds', movieId), { recursive: true });
      await mkdir(path.join(tempRoot, 'builds', movieId, 'blobs', 'ab'), { recursive: true });

      // Create manifest files
      const timeline: TimelineDocument = {
        id: 'timeline-1',
        duration: 10,
        tracks: [],
      };

      const manifest = {
        artefacts: {
          'Artifact:TimelineComposer.Timeline': {
            blob: {
              hash: 'ab123',
              size: 100,
              mimeType: 'application/json',
            },
          },
        },
      };

      const pointer = {
        revision: '1',
        manifestPath: 'manifest.json',
      };

      await writeFile(
        path.join(tempRoot, 'builds', movieId, 'current.json'),
        JSON.stringify(pointer)
      );
      await writeFile(
        path.join(tempRoot, 'builds', movieId, 'manifest.json'),
        JSON.stringify(manifest)
      );
      await writeFile(
        path.join(tempRoot, 'builds', movieId, 'blobs', 'ab', 'ab123.json'),
        JSON.stringify(timeline)
      );
    });

    afterEach(async () => {
      await rm(tempRoot, { recursive: true, force: true });
    });

    it('should create a handler factory', () => {
      const factory = createFfmpegExporterHandler();

      expect(typeof factory).toBe('function');
    });

    it('should create a handler with correct properties', () => {
      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: { provider: 'renku', model: 'FfmpegExporter', environment: 'local' },
        mode: 'live',
        secretResolver: { async getSecret() { return null; } },
      });

      expect(handler.provider).toBe('renku');
      expect(handler.model).toBe('FfmpegExporter');
      expect(handler.mode).toBe('live');
    });

    it('should return simulated response in simulated mode', async () => {
      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: { provider: 'renku', model: 'FfmpegExporter', environment: 'local' },
        mode: 'simulated',
        secretResolver: { async getSecret() { return null; } },
      });

      const response = await handler.invoke({
        jobId: 'test-job',
        provider: 'renku',
        model: 'FfmpegExporter',
        revision: 'rev-1',
        layerIndex: 0,
        attempt: 1,
        inputs: [],
        produces: ['Artifact:FinalVideo'],
        context: {
          environment: 'local',
          extras: {
            resolvedInputs: {
              'Input:MovieId': movieId,
              'Input:StorageRoot': tempRoot,
              'Input:StorageBasePath': 'builds',
            },
          },
        },
      });

      expect(response.status).toBe('succeeded');
      expect(response.artefacts[0]?.status).toBe('succeeded');
      expect(response.artefacts[0]?.blob?.mimeType).toBe('video/mp4');
    });
  });
});
