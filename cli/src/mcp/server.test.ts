import { Buffer } from 'node:buffer';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MovieStorage } from './server.js';

const TIMELINE_ID = 'Artifact:TimelineComposer.Timeline';

describe('MovieStorage', () => {
  let rootDir: string;
  let storage: MovieStorage;
  const movieId = 'movie-test123';

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'renku-test-'));
    const buildsDir = join(rootDir, 'builds', movieId);
    await mkdir(join(buildsDir, 'blobs', 'ab'), { recursive: true });
    await mkdir(join(buildsDir, 'blobs', 'fe'), { recursive: true });
    await mkdir(join(buildsDir, 'manifests'), { recursive: true });

    await writeFile(join(buildsDir, 'inputs.yaml'), 'inputs:\n  InquiryPrompt: "Hello"\n', 'utf8');

    const timelineBody = JSON.stringify({ duration: 30 });
    await writeFile(join(buildsDir, 'blobs', 'fe', 'feed1234'), timelineBody, 'utf8');

    const manifest = {
      revision: 'rev-0001',
      baseRevision: null,
      createdAt: new Date().toISOString(),
      inputs: {},
      artefacts: {
        [TIMELINE_ID]: {
          hash: 'feed1234',
          producedBy: 'Producer:Timeline',
          status: 'succeeded',
          createdAt: new Date().toISOString(),
          blob: {
            hash: 'feed1234',
            size: Buffer.byteLength(timelineBody, 'utf8'),
            mimeType: 'application/json',
          },
        },
        'Artifact:Audio.Sample': {
          hash: 'audio-hash',
          producedBy: 'Producer:Audio',
          status: 'succeeded',
          createdAt: new Date().toISOString(),
          blob: {
            hash: 'abcd1234',
            size: 4,
            mimeType: 'audio/mpeg',
          },
        },
      },
    };

    await writeFile(join(buildsDir, 'manifests', 'rev-0001.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await writeFile(
      join(buildsDir, 'current.json'),
      JSON.stringify({ manifestPath: 'manifests/rev-0001.json' }, null, 2),
      'utf8',
    );
    // Blob file (mp3 extension inferred from mime type)
    await writeFile(join(buildsDir, 'blobs', 'ab', 'abcd1234.mp3'), Buffer.from([1, 2, 3]));

    storage = new MovieStorage(rootDir, 'builds');
  });

  afterEach(async () => {
    await rm(rootDir, { recursive: true, force: true });
  });

  it('lists movie inputs as resources', async () => {
    const result = await storage.listInputs();
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]?.uri).toBe(`renku://movies/${movieId}/inputs`);
  });

  it('reads timeline artefact as formatted JSON', async () => {
    const response = await storage.readTimeline(movieId);
    const first = response.contents[0];
    if (!first || !('text' in first)) {
      throw new Error('Expected text content for timeline response');
    }
    expect(first.mimeType).toBe('application/json');
    const parsed = JSON.parse(first.text ?? '{}');
    expect(parsed.duration).toBe(30);
  });

  it('reads blob artefacts as base64 resources', async () => {
    const response = await storage.readArtefact(movieId, encodeURIComponent('Artifact:Audio.Sample'));
    const first = response.contents[0];
    if (!first || !('blob' in first)) {
      throw new Error('Expected blob content for artefact response');
    }
    expect(first.blob).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(first.mimeType).toBe('audio/mpeg');
  });
});
