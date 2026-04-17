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
    await mkdir(join(buildsDir, 'events'), { recursive: true });
    await mkdir(join(buildsDir, 'runs'), { recursive: true });

    const createdAt = new Date().toISOString();
    const revision = 'rev-0001';
    const inputEvents = [
      {
        id: 'Input:InquiryPrompt',
        revision,
        hash: 'abc123',
        payload: 'Hello',
        editedBy: 'user',
        createdAt,
      },
    ];
    const inputsLogContent = inputEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(join(buildsDir, 'events', 'inputs.log'), inputsLogContent, 'utf8');

    const timelineBody = JSON.stringify({ duration: 30 });
    await writeFile(join(buildsDir, 'blobs', 'fe', 'feed1234'), timelineBody, 'utf8');

    const artifactEvents = [
      {
        artifactId: TIMELINE_ID,
        revision,
        inputsHash: 'timeline-inputs-hash',
        output: {
          blob: {
            hash: 'feed1234',
            size: Buffer.byteLength(timelineBody, 'utf8'),
            mimeType: 'application/json',
          },
        },
        status: 'succeeded',
        producedBy: 'Producer:TimelineComposer[0]',
        producerId: 'Producer:TimelineComposer',
        createdAt,
      },
      {
        artifactId: 'Artifact:Audio.Sample',
        revision,
        inputsHash: 'audio-inputs-hash',
        output: {
          blob: {
            hash: 'abcd1234',
            size: 4,
            mimeType: 'audio/mpeg',
          },
        },
        status: 'succeeded',
        producedBy: 'Producer:Audio[0]',
        producerId: 'Producer:Audio',
        createdAt,
      },
    ];
    const artifactsLogContent = artifactEvents.map(e => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(join(buildsDir, 'events', 'artifacts.log'), artifactsLogContent, 'utf8');

    await writeFile(join(buildsDir, 'blobs', 'ab', 'abcd1234.mp3'), Buffer.from([1, 2, 3]));
    const snapshotContents = ['inputs:', '  InquiryPrompt: Hello', ''].join('\n');
    await writeFile(join(buildsDir, 'runs', 'rev-0001-inputs.yaml'), snapshotContents, 'utf8');
    await writeFile(
      join(buildsDir, 'runs', 'rev-0001-run.json'),
      JSON.stringify(
        {
          revision,
          createdAt,
          blueprintPath: '/catalog/blueprints/example/example.yaml',
          sourceInputsPath: '/tmp/inputs.yaml',
          inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
          inputSnapshotHash: 'snapshot-hash',
          planPath: 'runs/rev-0001-plan.json',
          runConfig: {},
          status: 'succeeded',
          startedAt: createdAt,
          completedAt: createdAt,
        },
        null,
        2,
      ),
      'utf8',
    );

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

  it('reads timeline artifact as formatted JSON', async () => {
    const response = await storage.readTimeline(movieId);
    const first = response.contents[0];
    if (!first || !('text' in first)) {
      throw new Error('Expected text content for timeline response');
    }
    expect(first.mimeType).toBe('application/json');
    const parsed = JSON.parse(first.text ?? '{}');
    expect(parsed.duration).toBe(30);
  });

  it('reads blob artifacts as base64 resources', async () => {
    const response = await storage.readArtifact(movieId, encodeURIComponent('Artifact:Audio.Sample'));
    const first = response.contents[0];
    if (!first || !('blob' in first)) {
      throw new Error('Expected blob content for artifact response');
    }
    expect(first.blob).toBe(Buffer.from([1, 2, 3]).toString('base64'));
    expect(first.mimeType).toBe('audio/mpeg');
  });

  it('reads inputs from events/inputs.log and returns YAML', async () => {
    const response = await storage.readInputs(movieId, `renku://movies/${movieId}/inputs`);
    const first = response.contents[0];
    if (!first || !('text' in first)) {
      throw new Error('Expected text content for inputs response');
    }
    expect(first.mimeType).toBe('text/yaml');
    expect(first.text).toContain('InquiryPrompt');
    expect(first.text).toContain('Hello');
  });
});
