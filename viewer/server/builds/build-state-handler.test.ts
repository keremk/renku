/**
 * Tests for build-state handler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createEventLog,
  createRunLifecycleService,
  createStorageContext,
  initializeMovieStorage,
  RuntimeErrorCode,
} from '@gorenku/core';
import { getBuildState } from './build-state-handler.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const VIEWER_FIXTURES_ROOT = path.join(TEST_DIR, '../fixtures/blueprints');

describe('getBuildState', () => {
  let tempDir: string;
  let blueprintFolder: string;
  let movieId: string;
  let movieDir: string;
  let transcriptionBlueprintPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'build-state-handler-test-')
    );
    blueprintFolder = tempDir;
    movieId = 'movie-test123';
    movieDir = path.join(blueprintFolder, 'builds', movieId);
    transcriptionBlueprintPath = path.join(
      VIEWER_FIXTURES_ROOT,
      'build-inputs-nested-model-normalization',
      'build-inputs-nested-model-normalization.yaml'
    );

    // Create directory structure
    await fs.mkdir(path.join(movieDir, 'events'), { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('returns empty response when no build state exists yet', async () => {
    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.movieId).toBe(movieId);
    expect(result.revision).toBeNull();
    expect(result.artifacts).toEqual([]);
  });

  it('surfaces malformed run lifecycle JSON instead of returning an empty response', async () => {
    await fs.writeFile(
      path.join(movieDir, 'events', 'runs.log'),
      '{"type":"run-started"',
      'utf8'
    );

    await expect(getBuildState(blueprintFolder, movieId)).rejects.toMatchObject({
      code: RuntimeErrorCode.INVALID_BUILD_HISTORY_JSON,
    });
  });

  it('surfaces non-canonical artifact ids instead of returning partial data', async () => {
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      [
        JSON.stringify({
          artifactId: 'bad-artifact-id',
          revision: 'rev-0001',
          inputsHash: 'bad-inputs',
          output: {},
          status: 'failed',
          createdAt: '2024-01-01T00:00:00Z',
        }),
        '',
      ].join('\n')
    );

    await expect(getBuildState(blueprintFolder, movieId)).rejects.toMatchObject({
      code: RuntimeErrorCode.ARTIFACT_RESOLUTION_FAILED,
    });
  });

  it('normalizes nested build-state model fields into the canonical TranscriptionProducer config', async () => {
    await fs.writeFile(
      path.join(movieDir, 'inputs.yaml'),
      [
        'inputs:',
        '  InquiryPrompt: "Tell the story of Ada Lovelace."',
        '  Duration: 30',
        'models:',
        '  - producerId: "TranscriptionProducer"',
        '    provider: "renku"',
        '    model: "speech/transcription"',
        '  - producerId: "TranscriptionProducer.stt"',
        '    provider: "fal-ai"',
        '    model: "elevenlabs/speech-to-text"',
        '',
      ].join('\n'),
      'utf8'
    );

    const result = await getBuildState(
      blueprintFolder,
      movieId,
      transcriptionBlueprintPath
    );

    expect(result.models).toEqual([
      {
        producerId: 'Producer:TranscriptionProducer',
        provider: 'renku',
        model: 'speech/transcription',
        config: {
          stt: {
            provider: 'fal-ai',
            model: 'elevenlabs/speech-to-text',
          },
        },
      },
    ]);
  });

  it('keeps snapshot-backed inputs after an artifact-only revision', async () => {
    await fs.mkdir(path.join(movieDir, 'runs'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'events', 'runs.log'),
      [
        JSON.stringify({
          type: 'run-started',
          revision: 'rev-0001',
          startedAt: '2024-01-01T00:00:00Z',
          inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
          inputSnapshotHash: 'snapshot-hash-1',
          planPath: 'runs/rev-0001-plan.json',
          runConfig: {},
        }),
        '',
      ].join('\n')
    );
    await fs.writeFile(
      path.join(movieDir, 'runs', 'rev-0001-inputs.yaml'),
      ['inputs:', '  InquiryPrompt: "Hello from snapshot"', '  Duration: 30', ''].join(
        '\n'
      ),
      'utf8'
    );
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      [
        JSON.stringify({
          artifactId: 'Artifact:ImageGen.Output',
          revision: 'rev-0002',
          inputsHash: 'image-inputs',
          output: {
            blob: { hash: 'imgHash123', size: 500, mimeType: 'image/png' },
          },
          status: 'succeeded',
          producerJobId: 'Producer:ImageGen[0]',
          producerId: 'Producer:ImageGen',
          createdAt: '2024-01-02T00:00:00Z',
          lastRevisionBy: 'user',
          preEditArtifactHash: 'imgHash000',
        }),
        '',
      ].join('\n')
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.revision).toBe('rev-0002');
    expect(result.inputs).toEqual({
      InquiryPrompt: 'Hello from snapshot',
      Duration: 30,
    });
  });

  it('keeps draft-only revisions out of the displayed build state', async () => {
    const storage = createStorageContext({
      kind: 'local',
      rootDir: blueprintFolder,
      basePath: 'builds',
    });
    await initializeMovieStorage(storage, movieId);

    await fs.writeFile(
      path.join(movieDir, 'inputs.yaml'),
      ['inputs:', '  InquiryPrompt: "Draft only"', '  Duration: 30', ''].join(
        '\n'
      ),
      'utf8'
    );

    const eventLog = createEventLog(storage);
    await eventLog.appendInput(movieId, {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0003',
      hash: 'draft-hash',
      payload: 'Draft only',
      editedBy: 'user',
      createdAt: '2024-01-03T00:00:00Z',
    });

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.revision).toBeNull();
    expect(result.inputs).toEqual({
      InquiryPrompt: 'Draft only',
      Duration: 30,
    });
  });

  it('does not use a snapshot from a run newer than the displayed revision', async () => {
    await fs.mkdir(path.join(movieDir, 'runs'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'events', 'runs.log'),
      [
        JSON.stringify({
          type: 'run-started',
          revision: 'rev-0001',
          startedAt: '2024-01-01T00:00:00Z',
          inputSnapshotPath: 'runs/rev-0001-inputs.yaml',
          inputSnapshotHash: 'snapshot-hash-1',
          planPath: 'runs/rev-0001-plan.json',
          runConfig: {},
        }),
        JSON.stringify({
          type: 'run-started',
          revision: 'rev-0003',
          startedAt: '2024-01-03T00:00:00Z',
          inputSnapshotPath: 'runs/rev-0003-inputs.yaml',
          inputSnapshotHash: 'snapshot-hash-3',
          planPath: 'runs/rev-0003-plan.json',
          runConfig: {},
        }),
        '',
      ].join('\n')
    );
    await fs.writeFile(
      path.join(movieDir, 'runs', 'rev-0001-inputs.yaml'),
      ['inputs:', '  InquiryPrompt: "Older snapshot"', '  Duration: 30', ''].join(
        '\n'
      ),
      'utf8'
    );
    await fs.writeFile(
      path.join(movieDir, 'runs', 'rev-0003-inputs.yaml'),
      ['inputs:', '  InquiryPrompt: "Future snapshot"', '  Duration: 90', ''].join(
        '\n'
      ),
      'utf8'
    );
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      [
        JSON.stringify({
          artifactId: 'Artifact:ImageGen.Output',
          revision: 'rev-0002',
          inputsHash: 'image-inputs',
          output: {
            blob: { hash: 'imgHash123', size: 500, mimeType: 'image/png' },
          },
        status: 'succeeded',
        producerJobId: 'Producer:ImageGen[0]',
        producerId: 'Producer:ImageGen',
        createdAt: '2024-01-02T00:00:00Z',
        lastRevisionBy: 'producer',
      }),
        '',
      ].join('\n')
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.revision).toBe('rev-0002');
    expect(result.inputs).toEqual({
      InquiryPrompt: 'Older snapshot',
      Duration: 30,
    });
  });

  it('does not advance the displayed revision when a newer draft only records input events', async () => {
    const storage = createStorageContext({
      kind: 'local',
      rootDir: blueprintFolder,
      basePath: 'builds',
    });
    await initializeMovieStorage(storage, movieId);

    const eventLog = createEventLog(storage);
    await eventLog.appendArtifact(movieId, {
      artifactId: 'Artifact:ImageGen.Output',
      revision: 'rev-0002',
      inputsHash: 'image-inputs',
      output: {
        blob: { hash: 'imgHash123', size: 500, mimeType: 'image/png' },
      },
      status: 'succeeded',
      producerJobId: 'Producer:ImageGen[0]',
      producerId: 'Producer:ImageGen',
      createdAt: '2024-01-02T00:00:00Z',
      lastRevisionBy: 'producer',
    });
    await eventLog.appendInput(movieId, {
      id: 'Input:InquiryPrompt',
      revision: 'rev-0003',
      hash: 'future-input-hash',
      payload: 'Future draft',
      editedBy: 'user',
      createdAt: '2024-01-03T00:00:00Z',
    });

    const runLifecycleService = createRunLifecycleService(storage);
    const olderSnapshot = await runLifecycleService.writeInputSnapshot(
      movieId,
      'rev-0002',
      Buffer.from(
        ['inputs:', '  InquiryPrompt: "Older snapshot"', '  Duration: 30', ''].join(
          '\n'
        ),
        'utf8'
      )
    );
    await runLifecycleService.appendStarted(movieId, {
      type: 'run-started',
      revision: 'rev-0002',
      startedAt: '2024-01-02T00:00:00Z',
      inputSnapshotPath: olderSnapshot.path,
      inputSnapshotHash: olderSnapshot.hash,
      planPath: 'runs/rev-0002-plan.json',
      runConfig: {},
    });
    await runLifecycleService.appendCompleted(movieId, {
      type: 'run-completed',
      revision: 'rev-0002',
      completedAt: '2024-01-02T00:10:00Z',
      status: 'succeeded',
      summary: {
        jobCount: 1,
        counts: { succeeded: 1, failed: 0, skipped: 0 },
        layers: 1,
      },
    });
    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.revision).toBe('rev-0002');
    expect(result.inputs).toEqual({
      InquiryPrompt: 'Older snapshot',
      Duration: 30,
    });
  });

  it('returns artifacts from the event log', async () => {
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      [
        JSON.stringify({
          artifactId: 'Artifact:TestProducer.Output',
          revision: 'rev-001',
          inputsHash: 'test-producer-inputs',
          output: {
            blob: { hash: 'abc123', size: 100, mimeType: 'image/png' },
          },
          producerJobId: 'Producer:TestProducer[0]',
          producerId: 'Producer:TestProducer',
          status: 'succeeded',
          createdAt: '2024-01-01T00:00:00Z',
        }),
        '',
      ].join('\n')
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].id).toBe('Artifact:TestProducer.Output');
    expect(result.artifacts[0].name).toBe('TestProducer.Output');
    expect(result.artifacts[0].hash).toBe('abc123');
    expect(result.artifacts[0].status).toBe('succeeded');
    expect(result.artifacts[0].producerNodeId).toBe('Producer:TestProducer');
  });

  it('includes event-log artifacts even when no persisted build state exists yet', async () => {
    const eventLogEntry = {
      artifactId: 'Artifact:NewProducer.Result',
      output: {
        blob: { hash: 'newHash456', size: 200, mimeType: 'application/json' },
      },
      status: 'succeeded',
      createdAt: '2024-01-02T00:00:00Z',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(eventLogEntry) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].id).toBe('Artifact:NewProducer.Result');
    expect(result.artifacts[0].name).toBe('NewProducer.Result');
    expect(result.artifacts[0].hash).toBe('newHash456');
    expect(result.artifacts[0].size).toBe(200);
    expect(result.artifacts[0].mimeType).toBe('application/json');
    expect(result.artifacts[0].status).toBe('succeeded');
  });

  it('returns multiple artifacts from the event log', async () => {
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      [
        JSON.stringify({
          artifactId: 'Artifact:ExistingProducer.Output',
          revision: 'rev-001',
          inputsHash: 'existing-inputs',
          output: {
            blob: { hash: 'existingHash', size: 50, mimeType: 'text/plain' },
          },
          status: 'succeeded',
          producerJobId: 'Producer:ExistingProducer[0]',
          producerId: 'Producer:ExistingProducer',
          createdAt: '2024-01-01T00:00:00Z',
        }),
        JSON.stringify({
          artifactId: 'Artifact:NewProducer.Result',
          revision: 'rev-001',
          inputsHash: 'new-inputs',
          output: {
            blob: { hash: 'newHash789', size: 300, mimeType: 'audio/mpeg' },
          },
          status: 'succeeded',
          producerJobId: 'Producer:NewProducer[0]',
          producerId: 'Producer:NewProducer',
          createdAt: '2024-01-02T00:00:00Z',
        }),
        '',
      ].join('\n')
    );

    const result = await getBuildState(blueprintFolder, movieId);

    // Should have both artifacts
    expect(result.artifacts.length).toBe(2);

    const existingArtifact = result.artifacts.find(
      (a) => a.id === 'Artifact:ExistingProducer.Output'
    );
    const newArtifact = result.artifacts.find(
      (a) => a.id === 'Artifact:NewProducer.Result'
    );

    expect(existingArtifact).toBeDefined();
    expect(existingArtifact!.hash).toBe('existingHash');

    expect(newArtifact).toBeDefined();
    expect(newArtifact!.hash).toBe('newHash789');
  });

  it('preserves edit tracking fields from the latest event log artifact entry', async () => {
    const eventLogEntry = {
      artifactId: 'Artifact:TestProducer.Output',
      output: {
        blob: { hash: 'newEditedHash', size: 150, mimeType: 'image/png' },
      },
      status: 'succeeded',
      createdAt: '2024-01-02T00:00:00Z',
      lastRevisionBy: 'user',
      preEditArtifactHash: 'oldHash',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(eventLogEntry) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].hash).toBe('newEditedHash');
    expect(result.artifacts[0].size).toBe(150);
    expect(result.artifacts[0].lastRevisionBy).toBe('user');
    expect(result.artifacts[0].preEditArtifactHash).toBe('oldHash');
  });

  it('preserves original hash tracking for edited artifacts', async () => {
    const eventLogEntry = {
      artifactId: 'Artifact:TestProducer.Output',
      output: {
        blob: { hash: 'editedHash', size: 120, mimeType: 'image/png' },
      },
      status: 'succeeded',
      createdAt: '2024-01-02T00:00:00Z',
      lastRevisionBy: 'user',
      preEditArtifactHash: 'preEditArtifactHash',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(eventLogEntry) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts[0].lastRevisionBy).toBe('user');
    expect(result.artifacts[0].preEditArtifactHash).toBe('preEditArtifactHash');
  });

  it('includes failed events in the artifact list with status', async () => {
    const failedEvent = {
      artifactId: 'Artifact:FailedProducer.Output',
      output: {},
      status: 'failed',
      createdAt: '2024-01-02T00:00:00Z',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(failedEvent) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    // Failed events should appear as artifacts with failed status (for UI display/recovery)
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].id).toBe('Artifact:FailedProducer.Output');
    expect(result.artifacts[0].status).toBe('failed');
    expect(result.artifacts[0].hash).toBe(''); // No blob for failed artifacts
    expect(result.artifacts[0].size).toBe(0);
  });

  it('keeps the latest failed status while showing the previous succeeded blob', async () => {
    const events = [
      {
        artifactId: 'Artifact:ImageProducer.Output',
        revision: 'rev-0001',
        inputsHash: 'hash-1',
        output: {
          blob: {
            hash: 'image-hash-1',
            size: 123,
            mimeType: 'image/png',
          },
        },
        status: 'succeeded',
        producerJobId: 'Producer:ImageProducer[0]',
        producerId: 'Producer:ImageProducer',
        createdAt: '2024-01-01T00:00:00Z',
      },
      {
        artifactId: 'Artifact:ImageProducer.Output',
        revision: 'rev-0002',
        inputsHash: 'hash-2',
        output: {},
        status: 'failed',
        producerJobId: 'Producer:ImageProducer[0]',
        producerId: 'Producer:ImageProducer',
        createdAt: '2024-01-02T00:00:00Z',
      },
    ];

    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      events.map((event) => JSON.stringify(event)).join('\n') + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toMatchObject({
      id: 'Artifact:ImageProducer.Output',
      status: 'failed',
      hash: 'image-hash-1',
      size: 123,
      mimeType: 'image/png',
      showingPreviousOutput: true,
    });
  });

  it('includes skipped events with skip reason', async () => {
    const skippedEvent = {
      artifactId: 'Artifact:ConditionalProducer.Output',
      output: {},
      status: 'skipped',
      skipReason: 'conditions_not_met',
      skipMessage: "Condition 'has_video' was not met",
      createdAt: '2024-01-02T00:00:00Z',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(skippedEvent) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    // Skipped events should appear with skip info for UI display
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].id).toBe('Artifact:ConditionalProducer.Output');
    expect(result.artifacts[0].status).toBe('skipped');
    expect(result.artifacts[0].failureReason).toBe('conditions_not_met');
    expect(result.artifacts[0].skipMessage).toBe(
      "Condition 'has_video' was not met"
    );
  });

  it('includes recovery info for failed events with diagnostics', async () => {
    const failedEvent = {
      artifactId: 'Artifact:VideoGen.Output',
      output: {},
      status: 'failed',
      createdAt: '2024-01-02T00:00:00Z',
      diagnostics: {
        provider: 'fal-ai',
        model: 'fal-ai/kling-video',
        providerRequestId: 'req-abc123',
        recoverable: true,
        reason: 'timeout',
      },
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(failedEvent) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    // Failed events should include recovery info from diagnostics
    expect(result.artifacts.length).toBe(1);
    const artifact = result.artifacts[0];
    expect(artifact.id).toBe('Artifact:VideoGen.Output');
    expect(artifact.status).toBe('failed');
    expect(artifact.provider).toBe('fal-ai');
    expect(artifact.model).toBe('fal-ai/kling-video');
    expect(artifact.providerRequestId).toBe('req-abc123');
    expect(artifact.recoverable).toBe(true);
    expect(artifact.failureReason).toBe('timeout');
  });

  it('does not default recoverable when diagnostics omit recoverable', async () => {
    const failedEvent = {
      artifactId: 'Artifact:VideoGen.Output',
      output: {},
      status: 'failed',
      createdAt: '2024-01-02T00:00:00Z',
      diagnostics: {
        provider: 'fal-ai',
        model: 'fal-ai/kling-video',
        providerRequestId: 'req-abc123',
      },
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(failedEvent) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts.length).toBe(1);
    const artifact = result.artifacts[0];
    expect(artifact.providerRequestId).toBe('req-abc123');
    expect(artifact.recoverable).toBeUndefined();
  });

  it('does not infer timeout reason from recoverable without explicit reason', async () => {
    const failedEvent = {
      artifactId: 'Artifact:VideoGen.Output',
      output: {},
      status: 'failed',
      createdAt: '2024-01-02T00:00:00Z',
      diagnostics: {
        provider: 'fal-ai',
        model: 'fal-ai/kling-video',
        providerRequestId: 'req-abc123',
        recoverable: true,
      },
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(failedEvent) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts.length).toBe(1);
    const artifact = result.artifacts[0];
    expect(artifact.recoverable).toBe(true);
    expect(artifact.failureReason).toBeUndefined();
  });

  it('returns event log artifacts during mid-execution before any build state is persisted', async () => {
    const event1 = {
      artifactId: 'Artifact:ImageGen.Output',
      revision: 'rev-001',
      inputsHash: 'image-inputs',
      output: {
        blob: { hash: 'imgHash123', size: 500, mimeType: 'image/png' },
      },
      status: 'succeeded',
      producerJobId: 'Producer:ImageGen[0]',
      producerId: 'Producer:ImageGen',
      createdAt: '2024-01-01T12:00:00Z',
    };
    const event2 = {
      artifactId: 'Artifact:AudioGen.Output',
      revision: 'rev-001',
      inputsHash: 'audio-inputs',
      output: {
        blob: { hash: 'audioHash456', size: 1000, mimeType: 'audio/mpeg' },
      },
      status: 'succeeded',
      producerJobId: 'Producer:AudioGen[0]',
      producerId: 'Producer:AudioGen',
      createdAt: '2024-01-01T12:01:00Z',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(event1) + '\n' + JSON.stringify(event2) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.movieId).toBe(movieId);
    expect(result.revision).toBe('rev-001');
    expect(result.artifacts.length).toBe(2);

    const imgArtifact = result.artifacts.find(
      (a) => a.id === 'Artifact:ImageGen.Output'
    );
    expect(imgArtifact).toBeDefined();
    expect(imgArtifact!.hash).toBe('imgHash123');
    expect(imgArtifact!.mimeType).toBe('image/png');

    const audioArtifact = result.artifacts.find(
      (a) => a.id === 'Artifact:AudioGen.Output'
    );
    expect(audioArtifact).toBeDefined();
    expect(audioArtifact!.hash).toBe('audioHash456');
    expect(audioArtifact!.mimeType).toBe('audio/mpeg');
  });

  it('returns in-progress looped event-log artifacts when blueprintPath is set and inputs are missing', async () => {
    const loopedBlueprintPath = path.join(tempDir, 'looped-blueprint.yaml');
    await fs.writeFile(
      loopedBlueprintPath,
      [
        'meta:',
        '  id: looped-blueprint',
        '  name: Looped Blueprint',
        'inputs:',
        '  - name: NumOfSegments',
        '    type: int',
        '    required: true',
        'loops:',
        '  - name: segment',
        '    countInput: NumOfSegments',
        'outputs:',
        '  - name: SegmentImages',
        '    type: array',
        '    itemType: image',
        '    countInput: NumOfSegments',
        'connections: []',
      ].join('\n')
    );

    const eventLogEntry = {
      artifactId: 'Artifact:ImageGen.GeneratedImage[0]',
      producerJobId: 'Producer:ImageGen[0]',
      producerId: 'Producer:ImageGen',
      output: {
        blob: { hash: 'loopedHash123', size: 500, mimeType: 'image/png' },
      },
      status: 'succeeded',
      createdAt: '2024-01-01T12:00:00Z',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(eventLogEntry) + '\n'
    );

    const result = await getBuildState(
      blueprintFolder,
      movieId,
      loopedBlueprintPath
    );

    expect(result.artifacts).toHaveLength(1);
    expect(result.artifacts[0]).toEqual(
      expect.objectContaining({
        id: 'Artifact:ImageGen.GeneratedImage[0]',
        producerJobId: 'Producer:ImageGen[0]',
        producerNodeId: 'Producer:ImageGen',
        hash: 'loopedHash123',
      })
    );
  });

  it('returns event log artifacts when no derived build state is available yet', async () => {
    const eventLogEntry = {
      artifactId: 'Artifact:Producer.Output',
      revision: 'rev-001',
      inputsHash: 'producer-inputs',
      output: {
        blob: { hash: 'hash789', size: 250, mimeType: 'text/plain' },
      },
      status: 'succeeded',
      producerJobId: 'Producer:Producer[0]',
      producerId: 'Producer:Producer',
      createdAt: '2024-01-01T12:00:00Z',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(eventLogEntry) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.movieId).toBe(movieId);
    expect(result.revision).toBe('rev-001');
    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].hash).toBe('hash789');
  });

  it('defaults mimeType to application/octet-stream for event-log artifacts', async () => {
    const eventLogEntry = {
      artifactId: 'Artifact:Producer.Output',
      output: {
        blob: { hash: 'someHash', size: 100 },
      },
      status: 'succeeded',
      createdAt: '2024-01-02T00:00:00Z',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(eventLogEntry) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].mimeType).toBe('application/octet-stream');
  });
});
