import { describe, expect, it, vi } from 'vitest';
import {
  createEventLog,
  createStorageContext,
  initializeMovieStorage,
  readBlobFromStorage,
  type ArtefactEvent,
} from '@gorenku/core';
import { recoverFailedArtifactsBeforePlanning } from './recovery-prepass.js';

const MOVIE_ID = 'movie-test';

function createFailedEvent(
  overrides: Partial<ArtefactEvent> = {}
): ArtefactEvent {
  return {
    artefactId: 'Artifact:MeetingVideoProducer.GeneratedVideo[0]',
    revision: 'rev-0001',
    inputsHash: 'inputs-hash',
    output: {},
    status: 'failed',
    producedBy: 'Producer:MeetingVideoProducer[0]',
    diagnostics: {
      provider: 'fal-ai',
      model: 'fal-ai/kling-video',
      providerRequestId: 'req-123',
      recoverable: true,
    },
    createdAt: '2026-02-16T12:00:00.000Z',
    ...overrides,
  };
}

async function readLatestEvent(
  eventLog: ReturnType<typeof createEventLog>,
  artefactId: string
) {
  let latest: ArtefactEvent | undefined;
  for await (const event of eventLog.streamArtefacts(MOVIE_ID)) {
    if (event.artefactId === artefactId) {
      latest = event;
    }
  }
  return latest;
}

describe('recoverFailedArtifactsBeforePlanning', () => {
  it('recovers completed fal job and appends succeeded artifact event', async () => {
    const storage = createStorageContext({
      kind: 'memory',
      basePath: 'demo/builds',
    });
    await initializeMovieStorage(storage, MOVIE_ID);
    const eventLog = createEventLog(storage);

    const failedEvent = createFailedEvent();
    await eventLog.appendArtefact(MOVIE_ID, failedEvent);

    const summary = await recoverFailedArtifactsBeforePlanning({
      storage,
      movieId: MOVIE_ID,
      dependencies: {
        checkFalStatus: vi.fn(async () => ({
          status: 'completed' as const,
          urls: ['https://cdn.example.com/video.mp4'],
        })),
        downloadBinary: vi.fn(async () => ({
          data: Buffer.from('recovered-video'),
          mimeType: 'video/mp4',
        })),
        now: () => '2026-02-16T12:05:00.000Z',
      },
    });

    expect(summary.checkedArtifactIds).toEqual([
      'Artifact:MeetingVideoProducer.GeneratedVideo[0]',
    ]);
    expect(summary.recoveredArtifactIds).toEqual([
      'Artifact:MeetingVideoProducer.GeneratedVideo[0]',
    ]);
    expect(summary.pendingArtifactIds).toEqual([]);
    expect(summary.failedArtifactIds).toEqual([]);

    const latest = await readLatestEvent(
      eventLog,
      'Artifact:MeetingVideoProducer.GeneratedVideo[0]'
    );
    expect(latest).toBeDefined();
    expect(latest?.status).toBe('succeeded');
    expect(latest?.output.blob).toBeDefined();
    expect(latest?.diagnostics?.provider).toBe('fal-ai');
    expect(latest?.diagnostics?.model).toBe('fal-ai/kling-video');
    expect(latest?.diagnostics?.providerRequestId).toBe('req-123');

    const blobRef = latest?.output.blob;
    expect(blobRef).toBeDefined();
    if (!blobRef) {
      throw new Error('Recovered blob was not persisted.');
    }
    const blob = await readBlobFromStorage(storage, MOVIE_ID, blobRef);
    expect(Buffer.from(blob.data)).toEqual(Buffer.from('recovered-video'));
  });

  it('marks recoverable artifacts as pending when provider is still processing', async () => {
    const storage = createStorageContext({
      kind: 'memory',
      basePath: 'demo/builds',
    });
    await initializeMovieStorage(storage, MOVIE_ID);
    const eventLog = createEventLog(storage);

    const failedEvent = createFailedEvent();
    await eventLog.appendArtefact(MOVIE_ID, failedEvent);

    const downloadBinary = vi.fn(async () => ({
      data: Buffer.from('unexpected'),
      mimeType: 'video/mp4',
    }));

    const summary = await recoverFailedArtifactsBeforePlanning({
      storage,
      movieId: MOVIE_ID,
      dependencies: {
        checkFalStatus: vi.fn(async () => ({ status: 'in_progress' as const })),
        downloadBinary,
      },
    });

    expect(summary.checkedArtifactIds).toEqual([
      'Artifact:MeetingVideoProducer.GeneratedVideo[0]',
    ]);
    expect(summary.recoveredArtifactIds).toEqual([]);
    expect(summary.pendingArtifactIds).toEqual([
      'Artifact:MeetingVideoProducer.GeneratedVideo[0]',
    ]);
    expect(summary.failedArtifactIds).toEqual([]);
    expect(downloadBinary).not.toHaveBeenCalled();

    const latest = await readLatestEvent(
      eventLog,
      'Artifact:MeetingVideoProducer.GeneratedVideo[0]'
    );
    expect(latest?.status).toBe('failed');
  });

  it('skips artifacts when provider diagnostics are not recoverable fal candidates', async () => {
    const storage = createStorageContext({
      kind: 'memory',
      basePath: 'demo/builds',
    });
    await initializeMovieStorage(storage, MOVIE_ID);
    const eventLog = createEventLog(storage);

    await eventLog.appendArtefact(
      MOVIE_ID,
      createFailedEvent({
        artefactId: 'Artifact:ReplicateProducer.GeneratedImage[0]',
        diagnostics: {
          provider: 'replicate',
          model: 'some/model',
          providerRequestId: 'rep-123',
          recoverable: true,
        },
      })
    );

    const checkFalStatus = vi.fn(async () => ({
      status: 'completed' as const,
      urls: ['https://cdn.example.com/image.png'],
    }));

    const summary = await recoverFailedArtifactsBeforePlanning({
      storage,
      movieId: MOVIE_ID,
      dependencies: {
        checkFalStatus,
      },
    });

    expect(summary.checkedArtifactIds).toEqual([]);
    expect(summary.recoveredArtifactIds).toEqual([]);
    expect(summary.pendingArtifactIds).toEqual([]);
    expect(summary.failedArtifactIds).toEqual([]);
    expect(checkFalStatus).not.toHaveBeenCalled();
  });

  it('uses artifact index to choose URL when provider returns multiple outputs', async () => {
    const storage = createStorageContext({
      kind: 'memory',
      basePath: 'demo/builds',
    });
    await initializeMovieStorage(storage, MOVIE_ID);
    const eventLog = createEventLog(storage);

    await eventLog.appendArtefact(
      MOVIE_ID,
      createFailedEvent({
        artefactId: 'Artifact:MeetingVideoProducer.GeneratedVideo[1]',
      })
    );

    const downloadBinary = vi.fn(async (url: string) => ({
      data: Buffer.from(url),
      mimeType: 'video/mp4',
    }));

    const summary = await recoverFailedArtifactsBeforePlanning({
      storage,
      movieId: MOVIE_ID,
      dependencies: {
        checkFalStatus: vi.fn(async () => ({
          status: 'completed' as const,
          urls: [
            'https://cdn.example.com/video-0.mp4',
            'https://cdn.example.com/video-1.mp4',
          ],
        })),
        downloadBinary,
      },
    });

    expect(summary.recoveredArtifactIds).toEqual([
      'Artifact:MeetingVideoProducer.GeneratedVideo[1]',
    ]);
    expect(downloadBinary).toHaveBeenCalledWith(
      'https://cdn.example.com/video-1.mp4'
    );
  });
});
