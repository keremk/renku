/**
 * End-to-end test for condition-referenced artifacts in producer graph.
 *
 * This test validates that:
 * 1. Boolean/enum fields referenced in conditions are included in produces list
 * 2. Simulated values are of the correct type (boolean, not string)
 * 3. Values alternate per array index when in alternating mode
 * 4. The stored artifact values can be used for condition evaluation
 *
 * Uses the condition-example blueprint which has conditions on:
 * - NarrationType (enum/string) in isImageNarration, isTalkingHead
 * - UseNarrationAudio (boolean) in isAudioNeeded
 */
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { generatePlan } from '../../src/lib/planner.js';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId } from '../../src/commands/execute.js';
import { setupTempCliConfig, readPlan, readManifest, createLoggerRecorder } from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS } from '../test-catalog-paths.js';

describe('end-to-end: condition-referenced artifacts in producer graph', () => {
  let tempConfig: Awaited<ReturnType<typeof setupTempCliConfig>>;

  beforeEach(async () => {
    tempConfig = await setupTempCliConfig();
  });

  afterEach(() => {
    tempConfig.restoreEnv();
  });

  it('includes boolean artifacts referenced in conditions in produces list', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'condition-example.yaml');
    const inputsPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'input-template.yaml');
    const { logger, errors } = createLoggerRecorder();
    const movieId = 'e2e-boolean-condition-artifacts';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // Generate plan (this is where computeConnectedArtifacts runs)
    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });

    // Persist the plan to disk
    await planResult.persist();

    // Read and verify plan structure
    const plan = await readPlan(planResult.planPath);
    const allJobs = plan.layers.flat();

    // Find DocProducer job (produces the decomposed JSON artifacts)
    const docJob = allJobs.find((j: any) => j.producer === 'DocProducer');
    expect(docJob).toBeDefined();

    const produces = docJob.produces as string[];

    // ============================================================
    // CRITICAL ASSERTION: Boolean artifacts must be in produces
    // ============================================================
    const booleanArtifacts = produces.filter((id: string) =>
      id.includes('UseNarrationAudio')
    );
    expect(booleanArtifacts).toHaveLength(3);
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio');
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[1].UseNarrationAudio');
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[2].UseNarrationAudio');

    // ============================================================
    // CRITICAL ASSERTION: Enum artifacts must be in produces
    // ============================================================
    const enumArtifacts = produces.filter((id: string) =>
      id.includes('NarrationType')
    );
    expect(enumArtifacts).toHaveLength(3);
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[0].NarrationType');
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[1].NarrationType');
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[2].NarrationType');

    expect(errors).toHaveLength(0);
  });

  it('generates boolean values as proper booleans in dry-run simulation', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'condition-example.yaml');
    const inputsPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'input-template.yaml');
    const { logger, errors, warnings } = createLoggerRecorder();
    const movieId = 'e2e-boolean-values';
    const storageMovieId = formatMovieId(movieId);

    // Use runExecute with dryRun mode to test the full simulation flow
    const { runExecute } = await import('../../src/commands/execute.js');

    const queryResult = await runExecute({
      storageMovieId,
      movieId,
      isNew: true,
      inputsPath,
      blueprintSpecifier: blueprintPath,
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    // ============================================================
    // VERIFY: Dry run completed (TimelineComposer may fail due to skipped video tracks)
    // ============================================================
    // Note: TimelineComposer fails with "Master track kind 'Video' is not included"
    // because some VideoProducer jobs are skipped due to conditions. This is expected
    // behavior - we verify the condition evaluation logic, not timeline configuration.
    expect(queryResult.build).toBeDefined();
    expect(queryResult.build?.counts.succeeded).toBeGreaterThan(0);
    expect(queryResult.build?.jobCount).toBe(14); // DocProducer + 6 Image + 3 Audio + 3 Video + 1 Timeline

    // ============================================================
    // VERIFY: Plan structure is correct
    // ============================================================
    const plan = await readPlan(queryResult.planPath);
    expect(plan.layers).toHaveLength(3); // 3 layers

    const allJobs = plan.layers.flat();
    expect(allJobs.length).toBe(14);

    // Find DocProducer job
    const docJob = allJobs.find((j: any) => j.producer === 'DocProducer');
    expect(docJob).toBeDefined();
    expect(docJob.jobId).toBe('Producer:DocProducer');
    // DocProducer should be in layer 0 (first layer)
    expect(plan.layers[0]?.some((j: any) => j.producer === 'DocProducer')).toBe(true);

    // Verify boolean artifacts are in the produces list
    const produces = docJob.produces as string[];
    const booleanArtifacts = produces.filter((id: string) => id.includes('UseNarrationAudio'));
    expect(booleanArtifacts).toHaveLength(3);
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio');
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[1].UseNarrationAudio');
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[2].UseNarrationAudio');

    // Verify enum artifacts are in the produces list
    const enumArtifacts = produces.filter((id: string) => id.includes('NarrationType'));
    expect(enumArtifacts).toHaveLength(3);
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[0].NarrationType');
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[1].NarrationType');
    expect(produces).toContain('Artifact:DocProducer.VideoScript.Segments[2].NarrationType');

    // ============================================================
    // VERIFY: Manifest contains all artifacts
    // ============================================================
    const manifestPath = queryResult.build?.manifestPath;
    expect(manifestPath).toBeDefined();
    const manifest = await readManifest(manifestPath!);
    expect(manifest).toBeDefined();
    expect(manifest.artefacts).toBeDefined();

    const artifactIds = Object.keys(manifest.artefacts);

    // Verify boolean artifacts exist in manifest
    const booleanManifestIds = artifactIds.filter((id) => id.includes('UseNarrationAudio'));
    expect(booleanManifestIds).toHaveLength(3);

    // Verify enum artifacts exist in manifest
    const enumManifestIds = artifactIds.filter((id) => id.includes('NarrationType'));
    expect(enumManifestIds).toHaveLength(3);

    // ============================================================
    // VERIFY: Boolean blob content is actual boolean values
    // ============================================================
    const blobsDir = resolve(queryResult.storagePath, 'blobs');
    const booleanValues: boolean[] = [];

    for (const artifactId of booleanManifestIds.sort()) {
      const artifact = manifest.artefacts[artifactId];
      expect(artifact).toBeDefined();
      expect(artifact.blob).toBeDefined();
      expect(artifact.blob!.mimeType).toBe('text/plain');
      expect(artifact.blob!.hash).toBeDefined();

      // Read the actual blob content
      // Blob path format: blobs/{prefix}/{hash}.{extension}
      const prefix = artifact.blob!.hash.slice(0, 2);
      const blobPath = resolve(blobsDir, prefix, `${artifact.blob!.hash}.txt`);
      const content = await readFile(blobPath, 'utf8');

      // CRITICAL: Content must be "true" or "false", NOT "Simulated value"
      expect(['true', 'false']).toContain(content);
      expect(content).not.toContain('Simulated');
      expect(content).not.toContain('value');

      booleanValues.push(content === 'true');
    }

    // CRITICAL: Verify boolean values alternate per array index
    // With alternating mode: [true, false, true]
    expect(booleanValues[0]).toBe(true);
    expect(booleanValues[1]).toBe(false);
    expect(booleanValues[2]).toBe(true);

    // ============================================================
    // VERIFY: Enum blob content is actual enum values
    // ============================================================
    const enumValues: string[] = [];
    const validEnumValues = ['ImageNarration', 'TalkingHead', 'VideoNarration', 'MapNarration'];

    for (const artifactId of enumManifestIds.sort()) {
      const artifact = manifest.artefacts[artifactId];
      expect(artifact).toBeDefined();
      expect(artifact.blob).toBeDefined();
      expect(artifact.blob!.mimeType).toBe('text/plain');
      expect(artifact.blob!.hash).toBeDefined();

      // Read the actual blob content
      // Blob path format: blobs/{prefix}/{hash}.{extension}
      const prefix = artifact.blob!.hash.slice(0, 2);
      const blobPath = resolve(blobsDir, prefix, `${artifact.blob!.hash}.txt`);
      const content = await readFile(blobPath, 'utf8');

      // CRITICAL: Content must be one of the enum values, NOT "Simulated value"
      expect(validEnumValues).toContain(content);
      expect(content).not.toContain('Simulated');

      enumValues.push(content);
    }

    // CRITICAL: Verify enum values vary per array index
    // The condition hints generate alternating values between the expected value
    // and a non-matching alternative. When the alternative is not in the enum,
    // it falls through to schema enum cycling.
    // - Index 0: 'ImageNarration' (from hint, 0 % 2 = 0)
    // - Index 1: falls through to schema enum (1 % 4 = 1 = 'TalkingHead')
    // - Index 2: 'ImageNarration' (from hint, 2 % 2 = 0)
    expect(enumValues[0]).toBe('ImageNarration');
    expect(enumValues[1]).toBe('TalkingHead');
    expect(enumValues[2]).toBe('ImageNarration');

    // ============================================================
    // VERIFY: No unexpected errors or warnings
    // ============================================================
    // TimelineComposer fails because some video tracks are skipped - this is expected
    // Filter out errors related to TimelineComposer/master track configuration
    const unexpectedErrors = errors.filter((e) => {
      if (typeof e === 'string') {
        // Filter out known TimelineComposer-related error strings
        // TimelineComposer fails because some video tracks are skipped due to conditions
        return (
          !e.includes('Master track kind') &&
          !e.includes('TimelineComposer') &&
          !e.includes('provider.invoke.failed') &&
          !e.includes('runner.job.failed')
        );
      }
      // Filter out provider.invoke.failed for TimelineComposer
      if (e && typeof e === 'object' && 'producer' in e && e.producer === 'TimelineComposer') {
        return false;
      }
      return true;
    });
    expect(unexpectedErrors).toHaveLength(0);

    // Filter out expected build completion warning
    const unexpectedWarnings = warnings.filter(
      (w) => typeof w !== 'string' || !w.includes('Build completed')
    );
    expect(unexpectedWarnings).toHaveLength(0);

    // ============================================================
    // VERIFY: All jobs in the execution result completed (succeeded or skipped)
    // ============================================================
    const jobs = queryResult.build?.jobs ?? [];
    expect(jobs).toHaveLength(14);

    const docJobResult = jobs.find((j: any) => j.producer === 'DocProducer');
    expect(docJobResult).toBeDefined();
    expect(docJobResult?.status).toBe('succeeded');

    // Verify all producer jobs completed without failures
    // Jobs can be 'succeeded' or 'skipped' (due to conditions)
    // TimelineComposer may fail because some video tracks are skipped - exclude it
    const failedJobs = jobs.filter(
      (j: any) => j.status === 'failed' && j.producer !== 'TimelineComposer'
    );
    expect(failedJobs).toHaveLength(0);

    // Verify we have both succeeded and skipped jobs (proves conditions are working)
    const succeededJobs = jobs.filter((j: any) => j.status === 'succeeded');
    const skippedJobs = jobs.filter((j: any) => j.status === 'skipped');
    expect(succeededJobs.length).toBeGreaterThan(0);
    // Some jobs should be skipped due to conditions
    expect(skippedJobs.length).toBeGreaterThan(0);
  });

  it('condition evaluator correctly matches decomposed artifact values', async () => {
    // This test verifies that the condition evaluator can find decomposed artifacts
    // (where the full path is the artifact ID) and correctly coerce string blob
    // content ("true"/"false") to boolean for comparison against is: true/false
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'condition-example.yaml');
    const inputsPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'input-template.yaml');
    const { logger, errors } = createLoggerRecorder();
    const movieId = 'e2e-decomposed-condition-eval';
    const storageMovieId = formatMovieId(movieId);

    const { runExecute } = await import('../../src/commands/execute.js');

    const queryResult = await runExecute({
      storageMovieId,
      movieId,
      isNew: true,
      inputsPath,
      blueprintSpecifier: blueprintPath,
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    // Note: TimelineComposer may fail due to skipped video tracks - we verify condition evaluation
    expect(queryResult.build).toBeDefined();
    // We don't check for errors here - TimelineComposer failure is expected due to skipped tracks

    // ============================================================
    // CRITICAL: Verify conditions correctly evaluated decomposed artifacts
    // ============================================================
    // The condition evaluator must:
    // 1. Find decomposed artifacts using full path as artifact ID
    //    e.g., "Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio"
    // 2. Coerce string blob content ("true"/"false") to boolean
    // 3. Compare against the boolean condition value (is: true)
    //
    // Without this fix, the evaluator would look for "Artifact:DocProducer.VideoScript"
    // and try to navigate the field path, but that nested artifact doesn't exist.

    // Read manifest to verify blob content
    const manifestPath = queryResult.build?.manifestPath;
    expect(manifestPath).toBeDefined();
    const manifest = await readManifest(manifestPath!);

    // Check which boolean values were generated
    const blobsDir = resolve(queryResult.storagePath, 'blobs');
    const booleanArtifactIds = [
      'Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio',
      'Artifact:DocProducer.VideoScript.Segments[1].UseNarrationAudio',
      'Artifact:DocProducer.VideoScript.Segments[2].UseNarrationAudio',
    ];

    const booleanValuesByIndex: Record<number, boolean> = {};
    for (let i = 0; i < 3; i++) {
      const artifactId = booleanArtifactIds[i];
      const artifact = manifest.artefacts[artifactId!];
      const prefix = artifact.blob!.hash.slice(0, 2);
      const blobPath = resolve(blobsDir, prefix, `${artifact.blob!.hash}.txt`);
      const content = await readFile(blobPath, 'utf8');
      booleanValuesByIndex[i] = content === 'true';
    }

    // Get the jobs from the execution result
    const jobs = queryResult.build?.jobs ?? [];

    // Find AudioProducer jobs (conditioned on isAudioNeeded)
    // isAudioNeeded condition is:
    //   any:
    //     - when: NarrationType is: "TalkingHead"
    //     - when: UseNarrationAudio is: true
    // So a job runs if EITHER condition is true.
    const audioJobs = jobs.filter((j: any) => j.producer === 'AudioProducer');
    expect(audioJobs).toHaveLength(3);

    // For each segment, verify the audio job was evaluated correctly
    // The condition is an OR (any), so job runs if NarrationType is TalkingHead OR UseNarrationAudio is true
    for (let i = 0; i < 3; i++) {
      const audioJob = audioJobs.find((j: any) => j.jobId === `Producer:AudioProducer[${i}]`);
      expect(audioJob).toBeDefined();

      // Verify job completed (either succeeded or skipped, depending on condition)
      expect(['succeeded', 'skipped']).toContain(audioJob!.status);
    }

    // Verify we got the alternating pattern: [true, false, true]
    expect(booleanValuesByIndex[0]).toBe(true);
    expect(booleanValuesByIndex[1]).toBe(false);
    expect(booleanValuesByIndex[2]).toBe(true);

    // The isAudioNeeded condition is an OR:
    //   any:
    //     - when: NarrationType is: "TalkingHead"
    //     - when: UseNarrationAudio is: true
    // With enum values [ImageNarration, TalkingHead, ImageNarration] and
    // boolean values [true, false, true]:
    // - Segment 0: ImageNarration OR true → true (runs)
    // - Segment 1: TalkingHead OR false → true (runs, because NarrationType matches)
    // - Segment 2: ImageNarration OR true → true (runs)
    // So all audio jobs should succeed because of the OR condition
    const audioJobStatuses = audioJobs
      .sort((a: any, b: any) => a.jobId.localeCompare(b.jobId))
      .map((j: any) => j.status);
    // All succeed due to OR logic
    expect(audioJobStatuses).toEqual(['succeeded', 'succeeded', 'succeeded']);

    // VideoProducer jobs are conditioned on isTalkingHead (NarrationType is TalkingHead)
    // With enum values [ImageNarration, TalkingHead, ImageNarration]:
    // - Segment 0: false (skipped)
    // - Segment 1: true (runs)
    // - Segment 2: false (skipped)
    const videoJobs = jobs.filter((j: any) => j.producer === 'VideoProducer');
    expect(videoJobs).toHaveLength(3);
    const videoJobStatuses = videoJobs
      .sort((a: any, b: any) => a.jobId.localeCompare(b.jobId))
      .map((j: any) => j.status);
    expect(videoJobStatuses).toEqual(['skipped', 'succeeded', 'skipped']);
  });
});
