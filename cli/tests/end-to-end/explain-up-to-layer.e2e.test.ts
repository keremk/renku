import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { formatMovieId } from '../../src/commands/execute.js';
import { getDefaultCliConfigPath, readCliConfig } from '../../src/lib/cli-config.js';
import { generatePlan } from '../../src/lib/planner.js';
import { createLoggerRecorder, expectFileExists, readPlan, setupTempCliConfig } from './helpers.js';
import { CLI_FIXTURES_BLUEPRINTS } from '../test-catalog-paths.js';

describe('end-to-end: cli planner forwards up-to-layer', () => {
  let restoreEnv: () => void = () => {};

  beforeEach(async () => {
    const config = await setupTempCliConfig();
    restoreEnv = config.restoreEnv;
  });

  afterEach(() => {
    restoreEnv();
  });

  it('limits generated plan to layer 0 when reRunFrom=0 and upToLayer=0', async () => {
    const blueprintPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'condition-example.yaml');
    const inputsPath = resolve(CLI_FIXTURES_BLUEPRINTS, 'condition-example', 'input-template.yaml');
    const { logger, errors } = createLoggerRecorder();
    const movieId = 'e2e-explain-up-to-layer';
    const storageMovieId = formatMovieId(movieId);

    const configPath = getDefaultCliConfigPath();
    const cliConfig = await readCliConfig(configPath);
    if (!cliConfig) {
      throw new Error('CLI config not initialized');
    }

    const planResult = await generatePlan({
      cliConfig,
      movieId: storageMovieId,
      isNew: true,
      inputsPath,
      usingBlueprint: blueprintPath,
      logger,
      reRunFrom: 0,
      upToLayer: 0,
    });

    await planResult.persist();
    await expectFileExists(planResult.planPath);

    const plan = await readPlan(planResult.planPath);
    expect(plan.layers).toHaveLength(1);
    const jobs = plan.layers.flat();
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((job: any) => job.producer === 'DocProducer')).toBe(true);
    expect(errors).toHaveLength(0);
  });
});
