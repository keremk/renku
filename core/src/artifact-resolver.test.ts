import { Buffer } from 'node:buffer';
import { TextEncoder } from 'node:util';
import { describe, expect, it } from 'vitest';
import { extractArtifactKind, resolveArtifactsFromEventLog } from './artifact-resolver.js';
import type { EventLog } from './event-log.js';
import type { StorageContext } from './storage.js';
import type { ArtefactEvent, BlobRef, RevisionId } from './types.js';

describe('extractArtifactKind', () => {
  it('extracts kind from artifact ID with dimensions', () => {
    expect(extractArtifactKind('Artifact:SegmentImage[segment=0][image=0]')).toBe('SegmentImage');
  });

  it('extracts kind from artifact ID without dimensions', () => {
    expect(extractArtifactKind('Artifact:NarrationScript')).toBe('NarrationScript');
  });

  it('extracts kind from input ID', () => {
    expect(extractArtifactKind('Input:Topic')).toBe('Topic');
  });

  it('handles multiple dimension formats', () => {
    expect(extractArtifactKind('Artifact:SegmentAudio[segment=5]')).toBe('SegmentAudio');
  });
});

describe('resolveArtifactsFromEventLog', () => {
  it('returns empty object for empty artifact IDs', async () => {
    const mockEventLog = createMockEventLog([]);
    const mockStorage = createMockStorage({});

    const result = await resolveArtifactsFromEventLog({
      artifactIds: [],
      eventLog: mockEventLog,
      storage: mockStorage,
      movieId: 'test-movie',
    });

    expect(result).toEqual({});
  });

  it('resolves blob artifact from event log', async () => {
    const blobData = Buffer.from([1, 2, 3, 4]);
    const blobRef: BlobRef = {
      hash: 'abc123def456',
      size: 4,
      mimeType: 'image/png',
    };

    const event: ArtefactEvent = {
      artefactId: 'Artifact:SegmentImage[segment=0]',
      revision: 'rev-1' as RevisionId,
      inputsHash: 'hash-1',
      output: { blob: blobRef },
      status: 'succeeded',
      producedBy: 'job-1',
      createdAt: '2025-01-01T00:00:00Z',
    };

    const mockEventLog = createMockEventLog([event]);
    const mockStorage = createMockStorage({
      'test-movie/blobs/ab/abc123def456.png': blobData,
    });

    const result = await resolveArtifactsFromEventLog({
      artifactIds: ['Artifact:SegmentImage[segment=0]'],
      eventLog: mockEventLog,
      storage: mockStorage,
      movieId: 'test-movie',
    });

    expect(result).toEqual({
      SegmentImage: blobData,
      'SegmentImage[segment=0]': blobData,
      'Artifact:SegmentImage[segment=0]': blobData,
    });
  });

  it('resolves inline artifact from event log', async () => {
    const scriptText = 'This is a narration script';
    const blobRef: BlobRef = {
      hash: 'narrationhash1234567890',
      size: scriptText.length,
      mimeType: 'text/plain',
    };

    const event: ArtefactEvent = {
      artefactId: 'Artifact:NarrationScript',
      revision: 'rev-1' as RevisionId,
      inputsHash: 'hash-1',
      output: { blob: blobRef },
      status: 'succeeded',
      producedBy: 'job-1',
      createdAt: '2025-01-01T00:00:00Z',
    };

    const mockEventLog = createMockEventLog([event]);
    const mockStorage = createMockStorage({
      'test-movie/blobs/na/narrationhash1234567890.txt': new TextEncoder().encode(scriptText),
    });

    const result = await resolveArtifactsFromEventLog({
      artifactIds: ['Artifact:NarrationScript'],
      eventLog: mockEventLog,
      storage: mockStorage,
      movieId: 'test-movie',
    });

    expect(result).toEqual({
      NarrationScript: scriptText,
      'Artifact:NarrationScript': scriptText,
    });
  });

  it('resolves multiple artifacts', async () => {
    const blobData = Buffer.from([5, 6, 7, 8]);
    const audioBlobRef: BlobRef = {
      hash: 'def456abc789',
      size: 4,
      mimeType: 'audio/mpeg',
    };
    const titleText = 'Amazing Documentary';
    const titleBlobRef: BlobRef = {
      hash: 'movietitlehash123',
      size: titleText.length,
      mimeType: 'text/plain',
    };

    const events: ArtefactEvent[] = [
      {
        artefactId: 'Artifact:SegmentAudio[segment=0]',
        revision: 'rev-1' as RevisionId,
        inputsHash: 'hash-1',
        output: { blob: audioBlobRef },
        status: 'succeeded',
        producedBy: 'job-1',
        createdAt: '2025-01-01T00:00:00Z',
      },
      {
        artefactId: 'Artifact:MovieTitle',
        revision: 'rev-1' as RevisionId,
        inputsHash: 'hash-2',
        output: { blob: titleBlobRef },
        status: 'succeeded',
        producedBy: 'job-2',
        createdAt: '2025-01-01T00:01:00Z',
      },
    ];

    const mockEventLog = createMockEventLog(events);
    const mockStorage = createMockStorage({
      'test-movie/blobs/de/def456abc789.mp3': blobData,
      'test-movie/blobs/mo/movietitlehash123.txt': new TextEncoder().encode(titleText),
    });

    const result = await resolveArtifactsFromEventLog({
      artifactIds: ['Artifact:SegmentAudio[segment=0]', 'Artifact:MovieTitle'],
      eventLog: mockEventLog,
      storage: mockStorage,
      movieId: 'test-movie',
    });

    expect(result).toEqual({
      SegmentAudio: blobData,
      'SegmentAudio[segment=0]': blobData,
      'Artifact:SegmentAudio[segment=0]': blobData,
      MovieTitle: titleText,
      'Artifact:MovieTitle': titleText,
    });
  });

  it('uses latest event when multiple events exist for same artifact', async () => {
    const oldBlobData = Buffer.from([1, 2]);
    const newBlobData = Buffer.from([3, 4]);

    const events: ArtefactEvent[] = [
      {
        artefactId: 'Artifact:SegmentImage[segment=0]',
        revision: 'rev-1' as any,
        inputsHash: 'hash-1',
        output: {
          blob: { hash: 'old123', size: 2, mimeType: 'image/png' },
        },
        status: 'succeeded',
        producedBy: 'job-1',
        createdAt: '2025-01-01T00:00:00Z',
      },
      {
        artefactId: 'Artifact:SegmentImage[segment=0]',
        revision: 'rev-2' as any,
        inputsHash: 'hash-2',
        output: {
          blob: { hash: 'new456', size: 2, mimeType: 'image/png' },
        },
        status: 'succeeded',
        producedBy: 'job-2',
        createdAt: '2025-01-01T00:01:00Z',
      },
    ];

    const mockEventLog = createMockEventLog(events);
    const mockStorage = createMockStorage({
      'test-movie/blobs/ol/old123.png': oldBlobData,
      'test-movie/blobs/ne/new456.png': newBlobData,
    });

    const result = await resolveArtifactsFromEventLog({
      artifactIds: ['Artifact:SegmentImage[segment=0]'],
      eventLog: mockEventLog,
      storage: mockStorage,
      movieId: 'test-movie',
    });

    // Should use the newer blob
    expect(result).toEqual({
      SegmentImage: newBlobData,
      'SegmentImage[segment=0]': newBlobData,
      'Artifact:SegmentImage[segment=0]': newBlobData,
    });
  });

  it('ignores failed artifacts', async () => {
    const events: ArtefactEvent[] = [
      {
      artefactId: 'Artifact:SegmentImage[segment=0]',
      revision: 'rev-1' as RevisionId,
      inputsHash: 'hash-1',
      output: {},
      status: 'failed',
      producedBy: 'job-1',
      createdAt: '2025-01-01T00:00:00Z',
      },
    ];

    const mockEventLog = createMockEventLog(events);
    const mockStorage = createMockStorage({});

    const result = await resolveArtifactsFromEventLog({
      artifactIds: ['Artifact:SegmentImage[segment=0]'],
      eventLog: mockEventLog,
      storage: mockStorage,
      movieId: 'test-movie',
    });

    expect(result).toEqual({});
  });

  it('only resolves requested artifacts', async () => {
    const imageBlobRef: BlobRef = {
      hash: 'imagehash123',
      size: 'image-url'.length,
      mimeType: 'text/plain',
    };
    const audioBlobRef: BlobRef = {
      hash: 'audiohash123',
      size: 'audio-url'.length,
      mimeType: 'text/plain',
    };

    const events: ArtefactEvent[] = [
      {
      artefactId: 'Artifact:SegmentImage[segment=0]',
      revision: 'rev-1' as RevisionId,
      inputsHash: 'hash-1',
      output: { blob: imageBlobRef },
      status: 'succeeded',
      producedBy: 'job-1',
        createdAt: '2025-01-01T00:00:00Z',
      },
      {
      artefactId: 'Artifact:SegmentAudio[segment=0]',
      revision: 'rev-1' as RevisionId,
      inputsHash: 'hash-2',
      output: { blob: audioBlobRef },
      status: 'succeeded',
      producedBy: 'job-2',
        createdAt: '2025-01-01T00:01:00Z',
      },
    ];

    const mockEventLog = createMockEventLog(events);
    const mockStorage = createMockStorage({
      'test-movie/blobs/im/imagehash123.txt': new TextEncoder().encode('image-url'),
      'test-movie/blobs/au/audiohash123.txt': new TextEncoder().encode('audio-url'),
    });

    const result = await resolveArtifactsFromEventLog({
      artifactIds: ['Artifact:SegmentImage[segment=0]'], // Only request image
      eventLog: mockEventLog,
      storage: mockStorage,
      movieId: 'test-movie',
    });

    // Should only contain requested artifact
    expect(result).toEqual({
      SegmentImage: 'image-url',
      'SegmentImage[segment=0]': 'image-url',
      'Artifact:SegmentImage[segment=0]': 'image-url',
    });
    expect(result.SegmentAudio).toBeUndefined();
  });
});

// Helper to create mock event log
function createMockEventLog(events: ArtefactEvent[]): EventLog {
  return {
    async *streamInputs() {
      // Not needed for these tests
    },
    async *streamArtefacts() {
      for (const event of events) {
        yield event;
      }
    },
    async appendInput() {},
    async appendArtefact() {},
  };
}

// Helper to create mock storage
function createMockStorage(blobs: Record<string, Uint8Array>): StorageContext {
  return {
    storage: {
      async readToUint8Array(path: string): Promise<Uint8Array> {
        const data = blobs[path];
        if (!data) {
          throw new Error(`Blob not found: ${path}`);
        }
        return data;
      },
    } as unknown as StorageContext['storage'],
    basePath: 'builds',
    resolve(movieId: string, ...segments: string[]): string {
      return [movieId, ...segments].join('/');
    },
    async append() {},
  };
}
