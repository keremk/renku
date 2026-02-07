import { resolve, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import {
  createEventLog,
  createManifestService,
  createRunner,
  createStorageContext,
  initializeMovieStorage,
  type ProduceRequest,
  type ProduceResult,
  type ProduceFn,
} from '@gorenku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { formatMovieId, runExecute } from '../../src/commands/execute.js';
import { generatePlan } from '../../src/lib/planner.js';
import {
  createLoggerRecorder,
  readPlan,
  setupTempCliConfig,
} from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS, CLI_FIXTURES_INPUTS } from '../test-catalog-paths.js';

describe('end-to-end: JSON virtual artifact blueprint', () => {
  let tempRoot = '';
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    tempRoot = config.tempRoot;
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('dry-run generates correct jobs with virtual artifact connections', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'json-blueprints', 'json-blueprints.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'json-blueprints-inputs.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    const movieId = 'e2e-json-blueprints-dry';
    const storageMovieId = formatMovieId(movieId);

    // Run dry-run execution
    const result = await runExecute({
      storageMovieId,
      isNew: true,
      inputsPath,
      blueprintSpecifier: blueprintPath,
      dryRun: true,
      nonInteractive: true,
      logger,
    });

    // Debug: Log errors and warnings if build failed
    if (result.build?.status !== 'succeeded') {
      console.log('Build result:', JSON.stringify(result.build, null, 2));
      console.log('Errors:', errors);
      console.log('Warnings:', warnings);
    }

    // Verify dry-run succeeded
    expect(result.build?.status).toBe('succeeded');

    // Read the plan
    const plan = await readPlan(result.planPath);
    const allJobs = plan.layers.flat();

    // Verify job counts: 1 DocProducer + 4 ImageProducers (2 segments × 2 images) + 1 TimelineComposer
    const docJobs = allJobs.filter((j: any) => j.producer === 'DocProducer');
    const imageJobs = allJobs.filter((j: any) => j.producer === 'ImageProducer');
    const timelineJobs = allJobs.filter((j: any) => j.producer === 'TimelineComposer');

    expect(docJobs).toHaveLength(1);
    expect(imageJobs).toHaveLength(4);
    expect(timelineJobs).toHaveLength(1);
    expect(result.build?.jobCount).toBe(6);

    // CRITICAL: Verify DocProducer's produces list contains ALL decomposed virtual artifacts
    // Each leaf value should be stored as a separate blob file
    const docJob = docJobs[0];
    expect(docJob.produces).toBeDefined();
    expect(docJob.produces.length).toBeGreaterThanOrEqual(4); // At least 4 ImagePrompts (2 segments × 2 images)

    // Verify specific virtual artifact IDs are in produces list
    expect(docJob.produces.some((id: string) => id.includes('Segments[0].ImagePrompts[0]'))).toBe(true);
    expect(docJob.produces.some((id: string) => id.includes('Segments[0].ImagePrompts[1]'))).toBe(true);
    expect(docJob.produces.some((id: string) => id.includes('Segments[1].ImagePrompts[0]'))).toBe(true);
    expect(docJob.produces.some((id: string) => id.includes('Segments[1].ImagePrompts[1]'))).toBe(true);

    // Verify ImageProducer jobs reference virtual artifacts in their input bindings
    for (const job of imageJobs) {
      const promptBinding = job.context?.inputBindings?.Prompt;
      expect(promptBinding).toBeDefined();
      expect(promptBinding).toMatch(/^Artifact:DocProducer\.VideoScript\.Segments\[\d+\]\.ImagePrompts\[\d+\]$/);
    }

    // Verify specific ImageProducer job indices
    const jobIndices = imageJobs.map((j: any) => j.jobId);
    expect(jobIndices.some((id: string) => id.includes('[0][0]'))).toBe(true);
    expect(jobIndices.some((id: string) => id.includes('[0][1]'))).toBe(true);
    expect(jobIndices.some((id: string) => id.includes('[1][0]'))).toBe(true);
    expect(jobIndices.some((id: string) => id.includes('[1][1]'))).toBe(true);

    // Verify errors is empty (warnings may include dimension propagation info)
    expect(errors).toHaveLength(0);
  });

  it('re-runs only affected ImageProducer when virtual artifact is overridden', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'json-blueprints', 'json-blueprints.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'json-blueprints-inputs.yaml');
    const { logger, warnings, errors } = createLoggerRecorder();
    const { logger: editLogger, warnings: editWarnings, errors: editErrors } = createLoggerRecorder();
    const movieId = 'e2e-json-blueprints-dirty';
    const storageMovieId = formatMovieId(movieId);

    // Read CLI config for storage settings
    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // ============================================================
    // PHASE 1: Initial run to produce all artifacts (Core API)
    // ============================================================

    // Generate initial plan
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

    // Verify initial plan structure
    const initialPlan = await readPlan(planResult.planPath);
    const initialJobs = initialPlan.layers.flat();
    expect(initialJobs).toHaveLength(6); // 1 DocProducer + 4 ImageProducers + 1 TimelineComposer

    const docJob = initialJobs.find((j: any) => j.producer === 'DocProducer');
    const imageJobs = initialJobs.filter((j: any) => j.producer === 'ImageProducer');
    const timelineJob = initialJobs.find((j: any) => j.producer === 'TimelineComposer');
    expect(docJob).toBeDefined();
    expect(imageJobs).toHaveLength(4);
    expect(timelineJob).toBeDefined();

    // Create storage and services for core runner
    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    // Create custom produce function that returns stub data
    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => ({
            artefactId,
            blob: {
              data: `original-data-for-${artefactId}`,
              mimeType: 'text/plain',
            },
          })),
      };
    });

    // Execute initial run with core runner
    const runner = createRunner();
    const firstRunResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      manifest: planResult.manifest,
      storage,
      eventLog,
      manifestService,
      produce,
      logger,
    });

    // Verify first run succeeded
    expect(firstRunResult.status).toBe('succeeded');
    expect(firstRunResult.jobs).toHaveLength(6); // 1 DocProducer + 4 ImageProducers + 1 TimelineComposer

    // Build and save manifest after first run
    const manifest1 = await firstRunResult.buildManifest();
    await manifestService.saveManifest(manifest1, {
      movieId: storageMovieId,
      previousHash: planResult.manifestHash,
      clock: { now: () => new Date().toISOString() },
    });

    // Verify all artifacts are in manifest
    expect(Object.keys(manifest1.artefacts).length).toBeGreaterThanOrEqual(5);

    // ============================================================
    // PHASE 2: Create override inputs.yaml with virtual artifact override
    // ============================================================

    // Create a test prompt override file
    const overridePromptContent = 'A beautiful sunrise over the lunar landscape';
    const overridePromptPath = join(tempRoot, 'override-prompt.txt');
    await writeFile(overridePromptPath, overridePromptContent, 'utf8');

    // Create inputs with virtual artifact override
    // The key targets the virtual artifact: DocProducer.VideoScript.Segments[0].ImagePrompts[0]
    const overrideInputsPath = join(tempRoot, 'override-inputs.yaml');
    await writeFile(
      overrideInputsPath,
      stringifyYaml({
        inputs: {
          InquiryPrompt: 'The history of the moon landing',
          Duration: 30,
          NumOfSegments: 2,
          NumOfImagesPerSegment: 2,
          Style: 'Photorealistic documentary style',
          AspectRatio: '16:9',
          Size: '1K',
          // Override virtual artifact: Segments[0].ImagePrompts[0]
          'DocProducer.VideoScript.Segments[0].ImagePrompts[0]': `file:${overridePromptPath}`,
        },
        models: [
          {
            model: 'gpt-5.2',
            provider: 'openai',
            producerId: 'DocProducer',
            // Include outputSchema so virtual artifact edges are created
            promptFile: resolve(CLI_FIXTURES_BLUEPRINTS, 'json-blueprints', 'documentary', 'documentary.toml'),
            outputSchema: resolve(CLI_FIXTURES_BLUEPRINTS, 'json-blueprints', 'documentary', 'documentary-output.json'),
            config: { text_format: 'json_schema' },
          },
          {
            model: 'bytedance/seedream-4',
            provider: 'replicate',
            producerId: 'ImageProducer',
            inputs: { Prompt: 'prompt', AspectRatio: 'aspect_ratio' },
          },
          {
            model: 'timeline/ordered',
            provider: 'renku',
            producerId: 'TimelineComposer',
            config: {
              timeline: {
                tracks: ['Image'],
                masterTracks: ['Image'],
                numTracks: 1,
                imageClip: { artifact: 'ImageSegments[Image]' },
              },
            },
          },
        ],
      }),
      'utf8',
    );

    // ============================================================
    // PHASE 3: Run edit with override inputs (dry-run to test planning)
    // ============================================================

    const editResult = await runExecute({
      storageMovieId,
      isNew: false,
      inputsPath: overrideInputsPath,
      dryRun: true,
      nonInteractive: true,
      logger: editLogger,
    });

    // Verify edit dry-run succeeded
    expect(editResult.build?.status).toBe('succeeded');

    // Read the edit plan
    const editPlan = await readPlan(editResult.planPath);
    const editJobs = editPlan.layers.flat();

    // CRITICAL VERIFICATION:
    // - DocProducer should NOT be in the plan (artifact was overridden, not its inputs)
    // - ImageProducer[0][0] should be in the plan (consumes overridden Segments[0].ImagePrompts[0])
    // - ImageProducer[0][1], [1][0], [1][1] should NOT be in the plan (not affected)
    // - TimelineComposer SHOULD re-run (depends on ImageProducer outputs)

    const editDocJobs = editJobs.filter((j: any) => j.producer === 'DocProducer');
    const editImageJobs = editJobs.filter((j: any) => j.producer === 'ImageProducer');
    const editTimelineJobs = editJobs.filter((j: any) => j.producer === 'TimelineComposer');

    expect(editDocJobs).toHaveLength(0); // DocProducer should NOT re-run
    expect(editImageJobs).toHaveLength(1); // Only ImageProducer[0][0] should re-run
    expect(editTimelineJobs).toHaveLength(1); // TimelineComposer re-runs (depends on changed image)

    // Verify the only image job is for segment 0, image 0
    const imageJob00 = editImageJobs[0];
    expect(imageJob00.jobId).toContain('[0][0]');

    // CRITICAL: Verify unaffected ImageProducers are NOT in the plan
    const allEditJobIds = editJobs.map((j: any) => j.jobId);
    expect(allEditJobIds.some((id: string) => id.includes('ImageProducer') && id.includes('[0][1]'))).toBe(false);
    expect(allEditJobIds.some((id: string) => id.includes('ImageProducer') && id.includes('[1][0]'))).toBe(false);
    expect(allEditJobIds.some((id: string) => id.includes('ImageProducer') && id.includes('[1][1]'))).toBe(false);

    // Verify correct job count: 1 ImageProducer + 1 TimelineComposer
    expect(editResult.build?.jobCount).toBe(2);

    // ============================================================
    // PHASE 4: Verify no warnings/errors during edit planning
    // ============================================================
    expect(editWarnings).toHaveLength(0);
    expect(editErrors).toHaveLength(0);
  });

  it('re-runs different ImageProducer when different virtual artifact is overridden', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'json-blueprints', 'json-blueprints.yaml');
    const inputsPath = resolve(CLI_FIXTURES_INPUTS, 'json-blueprints-inputs.yaml');
    const { logger } = createLoggerRecorder();
    const { logger: editLogger, warnings: editWarnings, errors: editErrors } = createLoggerRecorder();
    const movieId = 'e2e-json-blueprints-dirty2';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    // PHASE 1: Initial run to produce all artifacts
    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      notifications: undefined,
    });
    await planResult.persist();

    const storage = createStorageContext({
      kind: 'local',
      rootDir: cliConfig.storage.root,
      basePath: cliConfig.storage.basePath,
    });
    await initializeMovieStorage(storage, storageMovieId);
    const eventLog = createEventLog(storage);
    const manifestService = createManifestService(storage);

    const produce: ProduceFn = vi.fn(async (request: ProduceRequest): Promise<ProduceResult> => {
      return {
        jobId: request.job.jobId,
        status: 'succeeded',
        artefacts: request.job.produces
          .filter((id: string) => id.startsWith('Artifact:'))
          .map((artefactId: string) => ({
            artefactId,
            blob: { data: `data-for-${artefactId}`, mimeType: 'text/plain' },
          })),
      };
    });

    const runner = createRunner();
    const firstRunResult = await runner.execute(planResult.plan, {
      movieId: storageMovieId,
      manifest: planResult.manifest,
      storage,
      eventLog,
      manifestService,
      produce,
      logger,
    });
    expect(firstRunResult.status).toBe('succeeded');

    const manifest1 = await firstRunResult.buildManifest();
    await manifestService.saveManifest(manifest1, {
      movieId: storageMovieId,
      previousHash: planResult.manifestHash,
      clock: { now: () => new Date().toISOString() },
    });

    // PHASE 2: Override a DIFFERENT virtual artifact: Segments[1].ImagePrompts[1]
    const overridePromptPath = join(tempRoot, 'override-prompt2.txt');
    await writeFile(overridePromptPath, 'A dramatic shot of astronauts on the moon', 'utf8');

    const overrideInputsPath = join(tempRoot, 'override-inputs2.yaml');
    await writeFile(
      overrideInputsPath,
      stringifyYaml({
        inputs: {
          InquiryPrompt: 'The history of the moon landing',
          Duration: 30,
          NumOfSegments: 2,
          NumOfImagesPerSegment: 2,
          Style: 'Photorealistic documentary style',
          AspectRatio: '16:9',
          Size: '1K',
          // Override DIFFERENT virtual artifact: Segments[1].ImagePrompts[1]
          'DocProducer.VideoScript.Segments[1].ImagePrompts[1]': `file:${overridePromptPath}`,
        },
        models: [
          {
            model: 'gpt-5.2',
            provider: 'openai',
            producerId: 'DocProducer',
            promptFile: resolve(CLI_FIXTURES_BLUEPRINTS, 'json-blueprints', 'documentary', 'documentary.toml'),
            outputSchema: resolve(CLI_FIXTURES_BLUEPRINTS, 'json-blueprints', 'documentary', 'documentary-output.json'),
            config: { text_format: 'json_schema' },
          },
          {
            model: 'bytedance/seedream-4',
            provider: 'replicate',
            producerId: 'ImageProducer',
            inputs: { Prompt: 'prompt', AspectRatio: 'aspect_ratio' },
          },
          {
            model: 'timeline/ordered',
            provider: 'renku',
            producerId: 'TimelineComposer',
            config: {
              timeline: {
                tracks: ['Image'],
                masterTracks: ['Image'],
                numTracks: 1,
                imageClip: { artifact: 'ImageSegments[Image]' },
              },
            },
          },
        ],
      }),
      'utf8',
    );

    // PHASE 3: Run edit - should only re-run ImageProducer[1][1] + TimelineComposer
    const editResult = await runExecute({
      storageMovieId,
      isNew: false,
      inputsPath: overrideInputsPath,
      dryRun: true,
      nonInteractive: true,
      logger: editLogger,
    });

    expect(editResult.build?.status).toBe('succeeded');

    const editPlan = await readPlan(editResult.planPath);
    const editJobs = editPlan.layers.flat();

    const editDocJobs = editJobs.filter((j: any) => j.producer === 'DocProducer');
    const editImageJobs = editJobs.filter((j: any) => j.producer === 'ImageProducer');
    const editTimelineJobs = editJobs.filter((j: any) => j.producer === 'TimelineComposer');

    // DocProducer should NOT re-run
    expect(editDocJobs).toHaveLength(0);
    // Only ImageProducer[1][1] should re-run (different from first test!)
    expect(editImageJobs).toHaveLength(1);
    expect(editImageJobs[0].jobId).toContain('[1][1]');
    // TimelineComposer re-runs
    expect(editTimelineJobs).toHaveLength(1);

    // Verify OTHER ImageProducers are NOT in the plan
    const allEditJobIds = editJobs.map((j: any) => j.jobId);
    expect(allEditJobIds.some((id: string) => id.includes('ImageProducer') && id.includes('[0][0]'))).toBe(false);
    expect(allEditJobIds.some((id: string) => id.includes('ImageProducer') && id.includes('[0][1]'))).toBe(false);
    expect(allEditJobIds.some((id: string) => id.includes('ImageProducer') && id.includes('[1][0]'))).toBe(false);

    expect(editResult.build?.jobCount).toBe(2);
    expect(editWarnings).toHaveLength(0);
    expect(editErrors).toHaveLength(0);
  });
});
