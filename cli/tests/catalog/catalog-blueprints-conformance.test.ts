import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runBlueprintsValidate } from '../../src/commands/blueprints-validate.js';
import { runGenerate } from '../../src/commands/generate.js';
import { writeCliConfig } from '../../src/lib/cli-config.js';
import { CATALOG_BLUEPRINTS_ROOT, CATALOG_ROOT } from '../test-catalog-paths.js';

interface CatalogBlueprintCase {
  name: string;
  blueprintPath: string;
  inputTemplatePath: string;
  runnable: boolean;
  skipReason?: string;
}

interface CatalogFailure {
  blueprint: string;
  phase: string;
  details: string[];
}

const NON_RUNNABLE_CATALOG_BLUEPRINTS = new Map<string, string>([
  [
    'boilerplate',
    'Boilerplate is an intentionally incomplete starter scaffold.',
  ],
]);

const LOG_DEFAULTS = { mode: 'log' as const, logLevel: 'info' as const };

let tempRoot: string;
let tempConfigPath: string;
let originalConfigEnv: string | undefined;

describe('catalog blueprint conformance', () => {
  beforeAll(async () => {
    originalConfigEnv = process.env.RENKU_CLI_CONFIG;
    tempRoot = await mkdtemp(join(tmpdir(), 'renku-catalog-blueprints-'));
    tempConfigPath = join(tempRoot, 'cli-config.json');
    await writeCliConfig(
      {
        storage: {
          root: tempRoot,
          basePath: 'builds',
        },
        catalog: {
          root: CATALOG_ROOT,
        },
        concurrency: 1,
      },
      tempConfigPath
    );
    process.env.RENKU_CLI_CONFIG = tempConfigPath;
  });

  afterAll(async () => {
    if (originalConfigEnv === undefined) {
      delete process.env.RENKU_CLI_CONFIG;
    } else {
      process.env.RENKU_CLI_CONFIG = originalConfigEnv;
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('discovers every catalog blueprint directory with a single top-level blueprint file', async () => {
    const blueprints = await discoverCatalogBlueprints();
    expect(blueprints.length).toBeGreaterThan(0);

    const discoveredNames = new Set(blueprints.map((blueprint) => blueprint.name));
    const staleSkips = Array.from(NON_RUNNABLE_CATALOG_BLUEPRINTS.keys()).filter(
      (name) => !discoveredNames.has(name)
    );
    expect(staleSkips).toEqual([]);

    const runnableBlueprints = blueprints.filter((blueprint) => blueprint.runnable);
    expect(runnableBlueprints.length).toBeGreaterThan(0);
  });

  it('validates, preflights, and dry-runs runnable catalog blueprints', async () => {
    const blueprints = await discoverCatalogBlueprints();
    const failures: CatalogFailure[] = [];

    for (const blueprint of blueprints) {
      await collectStaticValidationFailure(blueprint, failures);
      if (!blueprint.runnable) {
        continue;
      }

      await collectPreflightFailure(blueprint, failures);
      await collectDryRunFailure(blueprint, failures);
    }

    if (failures.length > 0) {
      expect.fail(formatFailures(failures));
    }
  });
});

async function discoverCatalogBlueprints(): Promise<CatalogBlueprintCase[]> {
  const entries = await readdir(CATALOG_BLUEPRINTS_ROOT);
  const blueprints: CatalogBlueprintCase[] = [];

  for (const entry of entries.sort()) {
    const blueprintDir = resolve(CATALOG_BLUEPRINTS_ROOT, entry);
    const dirStat = await stat(blueprintDir);
    if (!dirStat.isDirectory()) {
      continue;
    }

    const files = await readdir(blueprintDir);
    const blueprintFiles = files
      .filter((file) => file.endsWith('.yaml') && file !== 'input-template.yaml')
      .sort();

    if (blueprintFiles.length !== 1) {
      throw new Error(
        `Catalog blueprint "${entry}" must have exactly one top-level blueprint YAML file. Found ${blueprintFiles.length}: ${blueprintFiles.join(', ')}`
      );
    }

    const inputTemplatePath = resolve(blueprintDir, 'input-template.yaml');
    await stat(inputTemplatePath);

    const skipReason = NON_RUNNABLE_CATALOG_BLUEPRINTS.get(entry);
    blueprints.push({
      name: entry,
      blueprintPath: resolve(blueprintDir, blueprintFiles[0]!),
      inputTemplatePath,
      runnable: skipReason === undefined,
      skipReason,
    });
  }

  return blueprints;
}

async function collectStaticValidationFailure(
  blueprint: CatalogBlueprintCase,
  failures: CatalogFailure[]
): Promise<void> {
  const result = await runBlueprintsValidate({
    blueprintPath: blueprint.blueprintPath,
  });

  if (result.valid) {
    return;
  }

  failures.push({
    blueprint: blueprint.name,
    phase: 'static validation',
    details: formatValidationErrorDetails(result),
  });
}

async function collectPreflightFailure(
  blueprint: CatalogBlueprintCase,
  failures: CatalogFailure[]
): Promise<void> {
  try {
    const result = await runGenerate({
      ...LOG_DEFAULTS,
      blueprint: blueprint.blueprintPath,
      inputsPath: blueprint.inputTemplatePath,
      preflightOnly: true,
      nonInteractive: true,
      storageOverride: {
        root: tempRoot,
        basePath: 'builds',
      },
    });

    const details: string[] = [];
    if (result.isPreflightOnly !== true) {
      details.push('Expected isPreflightOnly to be true.');
    }
    if (result.build !== undefined) {
      details.push('Expected preflight to stop before build execution.');
    }
    if (!result.rootOutputBindings || result.rootOutputBindings.length === 0) {
      details.push('Expected preflight to return root output bindings.');
    }
    if (details.length > 0) {
      failures.push({
        blueprint: blueprint.name,
        phase: 'preflight',
        details,
      });
    }
  } catch (error) {
    failures.push({
      blueprint: blueprint.name,
      phase: 'preflight',
      details: [formatUnknown(error)],
    });
  }
}

async function collectDryRunFailure(
  blueprint: CatalogBlueprintCase,
  failures: CatalogFailure[]
): Promise<void> {
  try {
    const result = await runGenerate({
      ...LOG_DEFAULTS,
      blueprint: blueprint.blueprintPath,
      inputsPath: blueprint.inputTemplatePath,
      dryRun: true,
      nonInteractive: true,
      storageOverride: {
        root: tempRoot,
        basePath: 'builds',
      },
    });

    const details: string[] = [];
    if (result.isDryRun !== true) {
      details.push('Expected isDryRun to be true.');
    }
    if (!result.build) {
      details.push('Expected dry-run to return a build summary.');
    }
    if (result.build && result.build.counts.failed > 0) {
      const failedJobs = result.build.jobs
        .filter((job) => job.status === 'failed')
        .map((job) => `${job.jobId}: ${job.errorMessage ?? 'failed'}`);
      details.push(...failedJobs);
    }
    if (result.dryRunValidation) {
      if (result.dryRunValidation.failedCases > 0) {
        details.push(
          `Expected zero failed dry-run validation cases, got ${result.dryRunValidation.failedCases}.`
        );
      }
      details.push(...result.dryRunValidation.failures);
    }
    if (details.length > 0) {
      failures.push({
        blueprint: blueprint.name,
        phase: 'dry-run',
        details,
      });
    }
  } catch (error) {
    failures.push({
      blueprint: blueprint.name,
      phase: 'dry-run',
      details: [formatUnknown(error)],
    });
  }
}

function formatValidationErrorDetails(
  result: Awaited<ReturnType<typeof runBlueprintsValidate>>
): string[] {
  if (result.errors && result.errors.length > 0) {
    return result.errors.map((error) => `${error.code}: ${error.message}`);
  }
  if (result.error) {
    return [result.error];
  }
  return ['Blueprint validation failed without a detailed error.'];
}

function formatFailures(failures: CatalogFailure[]): string {
  const report = failures
    .map(
      (failure) =>
        `${failure.blueprint} / ${failure.phase}:\n  ${failure.details.join('\n  ')}`
    )
    .join('\n\n');
  return `${failures.length} catalog blueprint conformance failure(s):\n\n${report}`;
}

function formatUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}
