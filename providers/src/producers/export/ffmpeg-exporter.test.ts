import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createFfmpegExporterHandler, __test__ } from './ffmpeg-exporter.js';
import type { TimelineDocument } from '@gorenku/compositions';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';

const { mimeToExtension, collectAssetIds, detectOutputFormat } = __test__;
const mockedExecFile = vi.mocked(execFile);

// Helper to load schema from catalog for tests
const catalogRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../catalog/models'
);

async function mockGetModelSchema(
  provider: string,
  model: string
): Promise<string | null> {
  if (provider === 'renku' && model === 'ffmpeg/native-render') {
    const schemaPath = path.join(
      catalogRoot,
      'renku',
      'video',
      'ffmpeg-native-render.json'
    );
    return readFile(schemaPath, 'utf8');
  }
  return null;
}

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
        tracks: [{ id: 'track-0', kind: 'Image', clips: [] }],
      };

      expect(detectOutputFormat(timeline)).toBe('video');
    });

    it('should detect video format for video tracks', () => {
      const timeline: TimelineDocument = {
        id: 'test',
        duration: 10,
        tracks: [{ id: 'track-0', kind: 'Video', clips: [] }],
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
      await mkdir(path.join(tempRoot, 'builds', movieId, 'blobs', 'ab'), {
        recursive: true,
      });

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
        descriptor: {
          provider: 'renku',
          model: 'FfmpegExporter',
          environment: 'local',
        },
        mode: 'live',
        secretResolver: {
          async getSecret() {
            return null;
          },
        },
        getModelSchema: mockGetModelSchema,
      });

      expect(handler.provider).toBe('renku');
      expect(handler.model).toBe('FfmpegExporter');
      expect(handler.mode).toBe('live');
    });

    it('should return simulated response in simulated mode', async () => {
      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: {
          provider: 'renku',
          model: 'FfmpegExporter',
          environment: 'local',
        },
        mode: 'simulated',
        secretResolver: {
          async getSecret() {
            return null;
          },
        },
        getModelSchema: mockGetModelSchema,
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

    it('should accept valid config with subtitles', async () => {
      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: {
          provider: 'renku',
          model: 'FfmpegExporter',
          environment: 'local',
        },
        mode: 'simulated',
        secretResolver: {
          async getSecret() {
            return null;
          },
        },
        getModelSchema: mockGetModelSchema,
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
          providerConfig: {
            subtitles: {
              font: 'Arial',
              fontSize: 48,
              fontBaseColor: '#FFFFFF',
              fontHighlightColor: '#FFD700',
            },
          },
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
    });

    it('should reject unknown fields like karaoke', async () => {
      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: {
          provider: 'renku',
          model: 'FfmpegExporter',
          environment: 'local',
        },
        mode: 'simulated',
        secretResolver: {
          async getSecret() {
            return null;
          },
        },
        getModelSchema: mockGetModelSchema,
      });

      await expect(
        handler.invoke({
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
            providerConfig: {
              karaoke: { fontSize: 48 }, // Invalid field - should be 'subtitles'
            },
            extras: {
              resolvedInputs: {
                'Input:MovieId': movieId,
                'Input:StorageRoot': tempRoot,
                'Input:StorageBasePath': 'builds',
              },
            },
          },
        })
      ).rejects.toThrow(/unknown field.*karaoke/i);
    });

    it('should reject invalid nested field names in subtitles', async () => {
      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: {
          provider: 'renku',
          model: 'FfmpegExporter',
          environment: 'local',
        },
        mode: 'simulated',
        secretResolver: {
          async getSecret() {
            return null;
          },
        },
        getModelSchema: mockGetModelSchema,
      });

      await expect(
        handler.invoke({
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
            providerConfig: {
              subtitles: {
                fontColor: '#FFFFFF', // Invalid - should be 'fontBaseColor'
              },
            },
            extras: {
              resolvedInputs: {
                'Input:MovieId': movieId,
                'Input:StorageRoot': tempRoot,
                'Input:StorageBasePath': 'builds',
              },
            },
          },
        })
      ).rejects.toThrow(/must NOT have additional properties/);
    });

    it('should reject invalid crf value out of range', async () => {
      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: {
          provider: 'renku',
          model: 'FfmpegExporter',
          environment: 'local',
        },
        mode: 'simulated',
        secretResolver: {
          async getSecret() {
            return null;
          },
        },
        getModelSchema: mockGetModelSchema,
      });

      await expect(
        handler.invoke({
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
            providerConfig: {
              crf: 100, // Invalid - should be 0-51
            },
            extras: {
              resolvedInputs: {
                'Input:MovieId': movieId,
                'Input:StorageRoot': tempRoot,
                'Input:StorageBasePath': 'builds',
              },
            },
          },
        })
      ).rejects.toThrow(/must be <= 51/);
    });

    it('should reject invalid preset enum value', async () => {
      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: {
          provider: 'renku',
          model: 'FfmpegExporter',
          environment: 'local',
        },
        mode: 'simulated',
        secretResolver: {
          async getSecret() {
            return null;
          },
        },
        getModelSchema: mockGetModelSchema,
      });

      await expect(
        handler.invoke({
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
            providerConfig: {
              preset: 'invalid-preset', // Invalid - should be ultrafast, fast, medium, etc.
            },
            extras: {
              resolvedInputs: {
                'Input:MovieId': movieId,
                'Input:StorageRoot': tempRoot,
                'Input:StorageBasePath': 'builds',
              },
            },
          },
        })
      ).rejects.toThrow(/must be equal to one of the allowed values/);
    });

    it('should reject invalid hex color format', async () => {
      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: {
          provider: 'renku',
          model: 'FfmpegExporter',
          environment: 'local',
        },
        mode: 'simulated',
        secretResolver: {
          async getSecret() {
            return null;
          },
        },
        getModelSchema: mockGetModelSchema,
      });

      await expect(
        handler.invoke({
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
            providerConfig: {
              subtitles: {
                fontBaseColor: 'not-a-color', // Invalid - should be #XXXXXX
              },
            },
            extras: {
              resolvedInputs: {
                'Input:MovieId': movieId,
                'Input:StorageRoot': tempRoot,
                'Input:StorageBasePath': 'builds',
              },
            },
          },
        })
      ).rejects.toThrow(/must match pattern/);
    });

    it('should surface cancellation when ffmpeg is aborted', async () => {
      const abortError = new Error('The operation was aborted') as Error & {
        code?: string;
      };
      abortError.name = 'AbortError';
      abortError.code = 'ABORT_ERR';

      mockedExecFile.mockImplementationOnce((...args: unknown[]) => {
        let callback:
          | ((err: Error | null, stdout?: string, stderr?: string) => void)
          | undefined;
        if (typeof args[3] === 'function') {
          callback = args[3] as (
            err: Error | null,
            stdout?: string,
            stderr?: string
          ) => void;
        } else if (typeof args[2] === 'function') {
          callback = args[2] as (
            err: Error | null,
            stdout?: string,
            stderr?: string
          ) => void;
        }
        callback?.(abortError);
        return {
          on: vi.fn(),
          stdout: { on: vi.fn() },
          stderr: { on: vi.fn() },
        } as never;
      });

      const abortController = new AbortController();
      abortController.abort();

      const factory = createFfmpegExporterHandler();
      const handler = factory({
        descriptor: {
          provider: 'renku',
          model: 'FfmpegExporter',
          environment: 'local',
        },
        mode: 'live',
        secretResolver: {
          async getSecret() {
            return null;
          },
        },
        getModelSchema: mockGetModelSchema,
      });

      await expect(
        handler.invoke({
          jobId: 'test-job',
          provider: 'renku',
          model: 'FfmpegExporter',
          revision: 'rev-1',
          layerIndex: 0,
          attempt: 1,
          inputs: [],
          produces: ['Artifact:FinalVideo'],
          signal: abortController.signal,
          context: {
            environment: 'local',
            providerConfig: {},
            extras: {
              resolvedInputs: {
                'Input:MovieId': movieId,
                'Input:StorageRoot': tempRoot,
                'Input:StorageBasePath': 'builds',
              },
            },
          },
        })
      ).rejects.toThrow(/cancelled by user request/i);
    });
  });
});
