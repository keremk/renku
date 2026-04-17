/**
 * Tests for build-state handler.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { RuntimeErrorCode } from '@gorenku/core';
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

  it('returns empty response when no current.json exists', async () => {
    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.movieId).toBe(movieId);
    expect(result.revision).toBeNull();
    expect(result.artifacts).toEqual([]);
  });

  it('surfaces malformed run record JSON instead of returning an empty response', async () => {
    await fs.mkdir(path.join(movieDir, 'runs'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'runs', 'rev-0001-run.json'),
      '{"revision":',
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

  it('returns artifacts from manifest file', async () => {
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
          producedBy: 'Producer:TestProducer[0]',
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

  it('includes event-log-only artifacts not in manifest', async () => {
    // Create current.json with a manifest that has NO artifacts
    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-001',
        manifestPath: 'manifests/rev-001.json',
      })
    );

    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-001.json'),
      JSON.stringify({
        artifacts: {},
        createdAt: '2024-01-01T00:00:00Z',
      })
    );

    // Create event log with a succeeded artifact (simulating mid-execution state)
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

  it('combines manifest artifacts with event-log-only artifacts', async () => {
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
          producedBy: 'Producer:ExistingProducer[0]',
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
          producedBy: 'Producer:NewProducer[0]',
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

  it('prefers event log data over manifest for same artifact', async () => {
    // Create current.json
    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-001',
        manifestPath: 'manifests/rev-001.json',
      })
    );

    // Create manifest with artifact
    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-001.json'),
      JSON.stringify({
        artifacts: {
          'Artifact:TestProducer.Output': {
            blob: { hash: 'oldHash', size: 100, mimeType: 'image/png' },
            status: 'succeeded',
            createdAt: '2024-01-01T00:00:00Z',
          },
        },
        createdAt: '2024-01-01T00:00:00Z',
      })
    );

    // Create event log with updated version of same artifact (user edit)
    const eventLogEntry = {
      artifactId: 'Artifact:TestProducer.Output',
      output: {
        blob: { hash: 'newEditedHash', size: 150, mimeType: 'image/png' },
      },
      status: 'succeeded',
      createdAt: '2024-01-02T00:00:00Z',
      editedBy: 'user',
      originalHash: 'oldHash',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(eventLogEntry) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts.length).toBe(1);
    expect(result.artifacts[0].hash).toBe('newEditedHash');
    expect(result.artifacts[0].size).toBe(150);
    expect(result.artifacts[0].editedBy).toBe('user');
    expect(result.artifacts[0].originalHash).toBe('oldHash');
  });

  it('preserves edit tracking fields from event log', async () => {
    // Create current.json
    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-001',
        manifestPath: 'manifests/rev-001.json',
      })
    );

    // Create manifest with artifact
    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-001.json'),
      JSON.stringify({
        artifacts: {
          'Artifact:TestProducer.Output': {
            blob: { hash: 'originalHash', size: 100, mimeType: 'image/png' },
            status: 'succeeded',
          },
        },
        createdAt: '2024-01-01T00:00:00Z',
      })
    );

    // Event log shows user edit
    const eventLogEntry = {
      artifactId: 'Artifact:TestProducer.Output',
      output: {
        blob: { hash: 'editedHash', size: 120, mimeType: 'image/png' },
      },
      status: 'succeeded',
      createdAt: '2024-01-02T00:00:00Z',
      editedBy: 'user',
      originalHash: 'originalHash',
    };
    await fs.writeFile(
      path.join(movieDir, 'events', 'artifacts.log'),
      JSON.stringify(eventLogEntry) + '\n'
    );

    const result = await getBuildState(blueprintFolder, movieId);

    expect(result.artifacts[0].editedBy).toBe('user');
    expect(result.artifacts[0].originalHash).toBe('originalHash');
  });

  it('includes failed events in artifact list with status', async () => {
    // Create current.json with empty manifest
    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-001',
        manifestPath: 'manifests/rev-001.json',
      })
    );

    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-001.json'),
      JSON.stringify({ artifacts: {}, createdAt: '2024-01-01T00:00:00Z' })
    );

    // Event log has a failed event (no blob since it failed)
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

  it('includes skipped events with skip reason', async () => {
    // Create current.json with empty manifest
    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-001',
        manifestPath: 'manifests/rev-001.json',
      })
    );

    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-001.json'),
      JSON.stringify({ artifacts: {}, createdAt: '2024-01-01T00:00:00Z' })
    );

    // Event log has a skipped event (conditional skip)
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
    // Create current.json with empty manifest
    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-001',
        manifestPath: 'manifests/rev-001.json',
      })
    );

    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-001.json'),
      JSON.stringify({ artifacts: {}, createdAt: '2024-01-01T00:00:00Z' })
    );

    // Event log has a failed event with recovery info
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
    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-001',
        manifestPath: 'manifests/rev-001.json',
      })
    );

    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-001.json'),
      JSON.stringify({ artifacts: {}, createdAt: '2024-01-01T00:00:00Z' })
    );

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
    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-001',
        manifestPath: 'manifests/rev-001.json',
      })
    );

    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-001.json'),
      JSON.stringify({ artifacts: {}, createdAt: '2024-01-01T00:00:00Z' })
    );

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

  it('returns event log artifacts when current.json has null manifestPath (mid-execution)', async () => {
    const event1 = {
      artifactId: 'Artifact:ImageGen.Output',
      revision: 'rev-001',
      inputsHash: 'image-inputs',
      output: {
        blob: { hash: 'imgHash123', size: 500, mimeType: 'image/png' },
      },
      status: 'succeeded',
      producedBy: 'Producer:ImageGen[0]',
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
      producedBy: 'Producer:AudioGen[0]',
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

    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({ revision: 'rev-001', manifestPath: null })
    );

    const eventLogEntry = {
      artifactId: 'Artifact:ImageGen.GeneratedImage[0]',
      producedBy: 'Producer:ImageGen[0]',
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
        producedBy: 'Producer:ImageGen[0]',
        producerNodeId: 'Producer:ImageGen',
        hash: 'loopedHash123',
      })
    );
  });

  it('returns event log artifacts when no current.json exists', async () => {
    const eventLogEntry = {
      artifactId: 'Artifact:Producer.Output',
      revision: 'rev-001',
      inputsHash: 'producer-inputs',
      output: {
        blob: { hash: 'hash789', size: 250, mimeType: 'text/plain' },
      },
      status: 'succeeded',
      producedBy: 'Producer:Producer[0]',
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
    // Create current.json with empty manifest
    await fs.writeFile(
      path.join(movieDir, 'current.json'),
      JSON.stringify({
        revision: 'rev-001',
        manifestPath: 'manifests/rev-001.json',
      })
    );

    await fs.mkdir(path.join(movieDir, 'manifests'), { recursive: true });
    await fs.writeFile(
      path.join(movieDir, 'manifests', 'rev-001.json'),
      JSON.stringify({ artifacts: {}, createdAt: '2024-01-01T00:00:00Z' })
    );

    // Event log entry without mimeType
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
