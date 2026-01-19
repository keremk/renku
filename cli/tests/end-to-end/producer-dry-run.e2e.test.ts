import { resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runGenerate } from '../../src/commands/generate.js';
import { setupTempCliConfig, readPlan, expectFileExists } from './helpers.js';
import { CLI_FIXTURES_PRODUCERS, CLI_FIXTURES_INPUTS } from '../test-catalog-paths.js';

const PRODUCER_PATH = resolve(CLI_FIXTURES_PRODUCERS, 'text-to-video-producer.yaml');
const MINIMAL_INPUTS_PATH = resolve(CLI_FIXTURES_INPUTS, 'producer-minimal-inputs.yaml');

describe('Producer dry-run (kind: producer)', () => {
  let tempConfig: Awaited<ReturnType<typeof setupTempCliConfig>>;

  beforeEach(async () => {
    tempConfig = await setupTempCliConfig();
  });

  afterEach(() => {
    tempConfig.restoreEnv();
  });

  it('should succeed with minimal inputs when using producer YAML', async () => {
    // Execute dry-run with producer YAML as blueprint
    const result = await runGenerate({
      blueprint: PRODUCER_PATH,
      inputsPath: MINIMAL_INPUTS_PATH,
      dryRun: true,
      nonInteractive: true,
      logLevel: 'info',
      storageOverride: {
        root: tempConfig.tempRoot,
        basePath: 'builds',
      },
    });

    // Verify dry-run succeeded
    expect(result.isDryRun).toBe(true);
    expect(result.build?.status).toBe('succeeded');
    expect(result.build?.jobCount).toBe(1);

    // Verify plan was created
    await expectFileExists(result.planPath);

    // Verify plan structure
    const plan = await readPlan(result.planPath);
    expect(plan.layers).toHaveLength(1);
    expect(plan.layers[0]).toHaveLength(1);

    // Verify job details
    const job = plan.layers[0][0];
    expect(job.producer).toBe('TextToVideoProducer');
    expect(job.provider).toBe('replicate');
    expect(job.providerModel).toBe('bytedance/seedance-1-pro-fast');

    // Verify only required inputs were bound (Prompt)
    expect(job.context.inputBindings.Prompt).toBe('Input:Prompt');
  });

  it('should NOT require all YAML-defined inputs for producers', async () => {
    // This test verifies that producer YAML files skip YAML-based required validation
    // Only JSON schema required fields (like Prompt) are needed

    // The minimal inputs file has ONLY Prompt - none of the other inputs
    // like NegativePrompt, Duration, NumFrames, etc.

    // If this test passes, it means the kind:producer logic correctly
    // skips the YAML required validation

    const result = await runGenerate({
      blueprint: PRODUCER_PATH,
      inputsPath: MINIMAL_INPUTS_PATH,
      dryRun: true,
      nonInteractive: true,
      logLevel: 'info',
      storageOverride: {
        root: tempConfig.tempRoot,
        basePath: 'builds',
      },
    });

    expect(result.isDryRun).toBe(true);
    expect(result.build?.status).toBe('succeeded');
  });
});
