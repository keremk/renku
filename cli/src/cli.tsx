#!/usr/bin/env node
/* eslint-env node */
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import meow from 'meow';
import chalk from 'chalk';

sanitizeDebugEnvVar('DEBUG');
sanitizeDebugEnvVar('NODE_DEBUG');
delete process.env.DOTENV_CONFIG_DEBUG;

const __dirname = dirname(fileURLToPath(import.meta.url));
const restoreStdout = silenceStdout();
try {
  const { config: dotenvConfig } = await import('dotenv');
  dotenvConfig({ path: resolve(__dirname, '..', '.env') });
  dotenvConfig({ path: resolve(process.cwd(), '.env'), override: false });
} finally {
  restoreStdout();
}
function sanitizeDebugEnvVar(name: 'DEBUG' | 'NODE_DEBUG'): void {
  const value = process.env[name];
  if (!value) {
    return;
  }
  const sanitized = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !entry.toLowerCase().includes('dotenv'));
  if (sanitized.length > 0) {
    process.env[name] = sanitized.join(',');
  } else {
    delete process.env[name];
  }
}

function silenceStdout(): () => void {
  const stream = process.stdout;
  const originalWrite = stream.write;
  stream.write = (() => true) as typeof stream.write;
  return () => {
    stream.write = originalWrite;
  };
}
import { runInit } from './commands/init.js';
import { runGenerate } from './commands/generate.js';
import { runInspect } from './commands/inspect.js';
import { runClean } from './commands/edit-run.js';
import { runProvidersList } from './commands/providers-list.js';
import { runBlueprintsList } from './commands/blueprints-list.js';
import { runBlueprintsDescribe } from './commands/blueprints-describe.js';
import { runViewerStart, runViewerStop, runViewerView } from './commands/viewer.js';
import { runBlueprintsValidate } from './commands/blueprints-validate.js';
import { runMcpServer } from './commands/mcp.js';
import type { DryRunSummary, DryRunJobSummary } from './lib/dry-run.js';
import type { BuildSummary } from './lib/build.js';
import { readCliConfig } from './lib/cli-config.js';
import {
  getBundledBlueprintsRoot,
  getCliBlueprintsRoot,
  resolveBlueprintSpecifier,
} from './lib/config-assets.js';
import React from 'react';
import { createNotificationBus, type LogLevel, type Logger as CoreLogger } from '@renku/core';
import type { CliLoggerMode } from './lib/logger.js';


type ProviderListOutputEntry = Awaited<ReturnType<typeof runProvidersList>>['entries'][number];

const cli = meow(
  `\nUsage\n  $ renku <command> [options]\n\nCommands\n  install             Guided setup (alias for init)\n  init                Initialize Renku CLI configuration (requires --root-folder/--root)\n  generate            Create or continue a movie generation\n  clean               Remove friendly view and build artefacts for a movie\n  inspect             Export prompts or timeline data for a movie\n  viewer:start        Start the bundled viewer server in the foreground\n  viewer:view         Open the viewer for a movie id (starts server if needed)\n  viewer:stop         Stop the background viewer server\n  providers:list      Show providers defined in a blueprint\n  blueprints:list     List available blueprint YAML files\n  blueprints:describe <path>  Show details for a blueprint YAML file\n  blueprints:validate <path>  Validate a blueprint YAML file\n  mcp                 Run the Renku MCP server over stdio\n\nExamples\n  $ renku init --root-folder=~/media/renku\n  $ renku init --root=~/media/renku          # Short form of --root-folder\n  $ renku generate --inputs=~/movies/my-inputs.yaml --blueprint=audio-only.yaml\n  $ renku generate --inputs=~/movies/my-inputs.yaml --blueprint=audio-only.yaml --concurrency=3\n  $ renku generate --last --up-to-layer=1\n  $ renku providers:list --blueprint=image-audio.yaml\n  $ renku blueprints:list\n  $ renku blueprints:describe audio-only.yaml\n  $ renku blueprints:validate image-audio.yaml\n  $ renku inspect --movie-id=movie-q123456 --prompts\n  $ renku clean --movie-id=movie-q123456\n  $ renku viewer:start\n  $ renku viewer:view --movie-id=movie-q123456\n  $ renku mcp --defaultBlueprint=image-audio.yaml\n`,
  {
    importMeta: import.meta,
    flags: {
      rootFolder: { type: 'string' },
      root: { type: 'string' },
      movieId: { type: 'string' },
      id: { type: 'string' },
      prompts: { type: 'boolean', default: true },
      inputs: { type: 'string' },
      in: { type: 'string' },
      dryRun: { type: 'boolean' },
      nonInteractive: { type: 'boolean' },
      blueprint: { type: 'string' },
      bp: { type: 'string' },
      last: { type: 'boolean' },
      concurrency: { type: 'number' },
      movie: { type: 'string' },
      viewerHost: { type: 'string' },
      viewerPort: { type: 'number' },
      blueprintsDir: { type: 'string' },
      defaultBlueprint: { type: 'string' },
      openViewer: { type: 'boolean' },
      mode: { type: 'string' },
      logLevel: { type: 'string' },
      upToLayer: { type: 'number' },
      up: { type: 'number' },
      all: { type: 'boolean' },
    },
  },
);

async function main(): Promise<void> {
  const [command, ...rest] = cli.input;
  const positionalInquiry = command === 'generate' ? rest[0] : undefined;
  const remaining = positionalInquiry !== undefined ? rest.slice(1) : rest;
  const flags = cli.flags as {
    rootFolder?: string;
    root?: string;
    movieId?: string;
    id?: string;
    prompts?: boolean;
    inputs?: string;
    in?: string;
    dryRun?: boolean;
    nonInteractive?: boolean;
    blueprint?: string;
    bp?: string;
    last?: boolean;
    concurrency?: number;
    movie?: string;
    viewerHost?: string;
    viewerPort?: number;
    blueprintsDir?: string;
    defaultBlueprint?: string;
    openViewer?: boolean;
    mode?: string;
    logLevel?: string;
    upToLayer?: number;
    up?: number;
    all?: boolean;
  };
  const logger = globalThis.console;

  switch (command) {
    case 'install':
    case 'init': {
      const rootFolder = flags.rootFolder ?? flags.root;
      if (!rootFolder) {
        logger.error('Error: --root-folder (or --root) is required.');
        logger.error('Example: renku init --root-folder=~/renku-data');
        logger.error('Or:      renku init --root ~/renku-data');
        process.exitCode = 1;
        return;
      }
      const result = await runInit({
        rootFolder,
      });
      logger.info(`All set, successfully initialized Renku!`)
      logger.info(`Workspace root is at: ${result.rootFolder}`);
      logger.info(`Config stored at: ${result.cliConfigPath}`);
      return;
    }
    case 'generate': {
      if (remaining.length > 0) {
        logger.error('Error: generate accepts at most one positional argument for the inquiry prompt.');
        process.exitCode = 1;
        return;
      }
      let mode: CliLoggerMode;
      let logLevel: LogLevel;
      try {
        mode = resolveMode(flags.mode, Boolean(flags.dryRun));
        logLevel = resolveLogLevel(flags.logLevel);
      } catch (error) {
        logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
        return;
      }
      if (mode === 'tui' && flags.nonInteractive) {
        logger.error('Error: --non-interactive is only supported in log mode.');
        process.exitCode = 1;
        return;
      }

      const movieIdFlag = flags.movieId ?? flags.id;
      const blueprintFlag = flags.blueprint ?? flags.bp;
      const inputsFlag = flags.inputs ?? flags.in;
      const upToLayer = flags.upToLayer ?? flags.up;

      if (positionalInquiry !== undefined) {
        logger.error('Error: inline inquiry prompt is no longer supported. Provide it in your inputs.yaml.');
        process.exitCode = 1;
        return;
      }

      if (flags.last && movieIdFlag) {
        logger.error('Error: use either --last or --movie-id/--id, not both.');
        process.exitCode = 1;
        return;
      }

      const targetingExisting = Boolean(flags.last || movieIdFlag);
      if (!targetingExisting) {
        if (!inputsFlag) {
          logger.error('Error: --inputs/--in is required for a new generation.');
          process.exitCode = 1;
          return;
        }
        if (!blueprintFlag) {
          logger.error('Error: --blueprint/--bp is required for a new generation.');
          process.exitCode = 1;
          return;
        }
      }

      const notifications = mode === 'tui' ? createNotificationBus() : undefined;
      let inkApp: import('ink').Instance | undefined;
      let startTui: (() => void) | undefined;

      if (notifications) {
        const { render } = await import('ink');
        const NotificationApp = (await import('./app.js')).default;
        startTui = () => {
          if (inkApp) {
            return;
          }
          inkApp = render(<NotificationApp bus={notifications} />);
        };
      }

      try {
        const result = await runGenerate({
          movieId: movieIdFlag,
          useLast: Boolean(flags.last),
          inputsPath: inputsFlag,
          blueprint: blueprintFlag,
          dryRun: Boolean(flags.dryRun),
          nonInteractive: Boolean(flags.nonInteractive),
          concurrency: flags.concurrency,
          upToLayer,
          mode,
          logLevel,
          notifications,
          onExecutionStart: startTui,
        });
        if (mode === 'log') {
          printGenerateSummary(logger, result);
          if (result.dryRun) {
            printDryRunSummary(logger, result.dryRun, result.storagePath);
          } 
        }
        notifications?.publish({
          type: 'success',
          message: 'Run complete.',
          timestamp: new Date().toISOString(),
        });
        return;
      } catch (error) {
        logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
        notifications?.publish({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        });
        return;
      } finally {
        notifications?.complete();
        inkApp?.unmount();
      }
    }
    case 'providers:list': {
      const blueprintFlag = flags.blueprint ?? flags.bp;
      if (!blueprintFlag) {
        logger.error('Error: --blueprint/--bp is required for providers:list.');
        process.exitCode = 1;
        return;
      }
      const cliConfig = await readCliConfig();
      if (!cliConfig) {
        logger.error('Renku CLI is not initialized. Run "renku init" first.');
        process.exitCode = 1;
        return;
      }
      const blueprintPath = await resolveBlueprintSpecifier(blueprintFlag, {
        cliRoot: cliConfig.storage.root,
      });
      const result = await runProvidersList({
        blueprintPath,
      });

      if (result.entries.length === 0) {
        logger.info('No producer definitions found in the blueprint.');
        return;
      }

      const byProducer = new Map<string, ProviderListOutputEntry[]>();
      for (const entry of result.entries) {
        const bucket = byProducer.get(entry.producer) ?? [];
        bucket.push(entry);
        byProducer.set(entry.producer, bucket);
      }

      logger.info('Provider configurations:');
      for (const [producer, entries] of byProducer) {
        logger.info(`- ${producer}`);
        for (const entry of entries) {
          const statusLabel = entry.status === 'ready' ? 'ready' : `error: ${entry.message ?? 'unavailable'}`;
          logger.info(
            `    ${entry.provider}/${entry.model} (${entry.environment}) -> ${statusLabel}`,
          );
        }
      }
      return;
    }
    case 'blueprints:list': {
      const cliConfig = await readCliConfig();
      const directory = cliConfig
        ? getCliBlueprintsRoot(cliConfig.storage.root)
        : getBundledBlueprintsRoot();
      const result = await runBlueprintsList(directory);

      if (result.blueprints.length === 0) {
        logger.info('No blueprint YAML files found.');
        return;
      }

      logger.info('Available Blueprints:\n');
      for (const blueprint of result.blueprints) {
        logger.info(`  ${blueprint.name}`);
        if (blueprint.description) {
          logger.info(`    ${blueprint.description}`);
        }
        if (blueprint.version) {
          logger.info(`    Version: ${blueprint.version}`);
        }
        logger.info(`    Path: ${blueprint.path}`);
        logger.info(`    Inputs: ${blueprint.inputCount}, Outputs: ${blueprint.outputCount}`);
        logger.info('');
      }
      return;
    }
    case 'blueprints:describe': {
      const blueprintPath = rest[0];
      if (!blueprintPath) {
        logger.error('Error: blueprint path is required for blueprints:describe.');
        logger.error('Usage: renku blueprints:describe <path-to-blueprint.yaml>');
        process.exitCode = 1;
        return;
      }

      try {
        const cliConfig = await readCliConfig();
        const resolvedPath = await resolveBlueprintSpecifier(blueprintPath, {
          cliRoot: cliConfig?.storage.root,
        });
        const result = await runBlueprintsDescribe({ blueprintPath: resolvedPath });

        logger.info(`Blueprint: ${result.name}`);
        if (result.description) {
          logger.info(result.description);
        }
        if (result.version) {
          logger.info(`Version: ${result.version}`);
        }
        logger.info(`Path: ${result.path}\n`);

        logger.info('Inputs:');
        if (result.inputs.length === 0) {
          logger.info('  (none)');
        } else {
          for (const input of result.inputs) {
            const details = [
              `type: ${input.type}`,
              input.required ? 'required' : 'optional',
            ];
            if (input.defaultValue !== undefined) {
              details.push(`default=${JSON.stringify(input.defaultValue)}`);
            }
            logger.info(
              `  • ${input.name} (${details.join(', ')})`,
            );
            if (input.description) {
              logger.info(`    ${input.description}`);
            }
            logger.info('');
          }
        }

        logger.info('Outputs:');
        if (result.outputs.length === 0) {
          logger.info('  (none)');
        } else {
          for (const output of result.outputs) {
            const details = [
              `type: ${output.type}`,
              output.required ? 'required' : 'optional',
            ];
            if (output.countInput) {
              details.push(`countInput=${output.countInput}`);
            }
            logger.info(
              `  • ${output.name} (${details.join(', ')})`,
            );
            if (output.description) {
              logger.info(`    ${output.description}`);
            }
            logger.info('');
          }
        }
      } catch (error) {
        logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
      return;
    }
    case 'blueprints:validate': {
      const blueprintPath = rest[0];
      if (!blueprintPath) {
        logger.error('Error: blueprint file path is required for blueprints:validate.');
        logger.error('Usage: renku blueprints:validate <path-to-blueprint.yaml>');
        process.exitCode = 1;
        return;
      }

      const cliConfig = await readCliConfig();
      const resolvedPath = await resolveBlueprintSpecifier(blueprintPath, {
        cliRoot: cliConfig?.storage.root,
      });
      const result = await runBlueprintsValidate({ blueprintPath: resolvedPath });

      if (result.valid) {
        logger.info(`✓ Blueprint "${result.name ?? result.path}" is valid`);
        logger.info(`Path: ${result.path}`);
        if (typeof result.nodeCount === 'number' && typeof result.edgeCount === 'number') {
          logger.info(`Nodes: ${result.nodeCount}, Edges: ${result.edgeCount}`);
        }
      } else {
        logger.error(`✗ Blueprint validation failed\n`);
        logger.error(`Error: ${result.error}`);
        process.exitCode = 1;
      }
      return;
    }
    case 'inspect': {
      const movieIdFlag = flags.movieId ?? flags.id;
      if (!movieIdFlag) {
        logger.error('Error: --movie-id/--id is required for inspect.');
        process.exitCode = 1;
        return;
      }
      const result = await runInspect({
        movieId: movieIdFlag,
        prompts: flags.prompts,
      });
      if (result.promptsToml) {
        logger.info(result.promptsToml);
      } else {
        logger.info('No prompts found for the specified movie.');
      }
      return;
    }
    case 'clean': {
      const movieId = rest[0] ?? flags.movieId ?? flags.id;
      if (!movieId) {
        logger.error('Error: --movie-id/--id is required for clean (pass as first argument).');
        process.exitCode = 1;
        return;
      }
      await runClean({ movieId, logger });
      return;
    }
    case 'viewer:start': {
      await runViewerStart({
        host: flags.viewerHost,
        port: flags.viewerPort,
        logger,
      });
      return;
    }
    case 'viewer:view': {
      await runViewerView({
        movieId: flags.movieId ?? flags.id ?? flags.movie,
        host: flags.viewerHost,
        port: flags.viewerPort,
        logger,
      });
      return;
    }
    case 'viewer:stop': {
      await runViewerStop({ logger });
      return;
    }
    case 'mcp': {
      await runMcpServer({
        blueprintsDir: flags.blueprintsDir,
        defaultBlueprint: flags.defaultBlueprint,
        openViewer: flags.openViewer,
        logger,
      });
      return;
    }
    default: {
      cli.showHelp();
    }
  }
}

void main();

function resolveMode(modeFlag: string | undefined, dryRun: boolean): CliLoggerMode {
  if (modeFlag === 'tui' || modeFlag === 'log') {
    return modeFlag;
  }
  if (modeFlag !== undefined) {
    throw new Error('Invalid mode. Use "tui" or "log".');
  }
  return dryRun ? 'log' : 'tui';
}

function resolveLogLevel(levelFlag: string | undefined): LogLevel {
  if (levelFlag === undefined || levelFlag === 'info') {
    return 'info';
  }
  if (levelFlag === 'debug') {
    return 'debug';
  }
  throw new Error('Invalid log level. Use "info" or "debug".');
}

function printGenerateSummary(logger: CoreLogger, result: Awaited<ReturnType<typeof runGenerate>>): void {
  const modeLabel = result.isNew ? 'New movie' : 'Updated movie';
  const statusInfo = result.dryRun
    ? { label: 'Dry run', status: result.dryRun.status, jobs: result.dryRun.jobCount }
    : result.build
      ? { label: 'Build', status: result.build.status, jobs: result.build.jobCount }
      : undefined;
  const colorizeStatus =
    statusInfo?.status === 'succeeded'
      ? chalk.green
      : statusInfo?.status === 'failed'
        ? chalk.red
        : (text: string) => text;
  const jobsLabel =
    statusInfo && typeof statusInfo.jobs === 'number'
      ? ` • ${statusInfo.jobs} job${statusInfo.jobs === 1 ? '' : 's'}`
      : '';

  logger.info('');
  logger.info(chalk.bold(`${modeLabel}: ${chalk.blue(result.storageMovieId)}`));
  logger.info(chalk.dim(`Revision ${result.targetRevision}`));
  if (statusInfo) {
    logger.info(colorizeStatus(`${statusInfo.label}: ${statusInfo.status}${jobsLabel}\n`));
  } else {
    logger.info(chalk.yellow('No execution performed.\n'));
  }

  const detailLines: Array<[string, string]> = [
    [`${chalk.bold('Plan')}`, result.planPath],
    ...(result.manifestPath ? [[`${chalk.bold('Manifest')}`, result.manifestPath] as [string, string]] : []),
    [`${chalk.bold('Builds')}`, result.storagePath],
    ...(result.friendlyRoot ? [[`${chalk.bold('Workspace')}`, result.friendlyRoot] as [string, string]] : []),
  ];
  const bullet = chalk.dim('•');
  for (const [label, value] of detailLines) {
    logger.info(`${bullet} ${label}: ${value}`);
  }
}

function printDryRunSummary(logger: CoreLogger, summary: DryRunSummary, storagePath: string): void {
  const counts = summary.statusCounts;
  const layersLabel = summary.layers === 1 ? 'layer' : 'layers';
  const jobsLabel = summary.jobCount === 1 ? 'job' : 'jobs';
  logger.info(
    `Dry run status: ${summary.status}. ${summary.layers} ${layersLabel}, ${summary.jobCount} ${jobsLabel} (succeeded ${counts.succeeded}, failed ${counts.failed}, skipped ${counts.skipped}).`,
  );

  const layerMap = buildLayerMap(summary.jobs);
  if (layerMap.size === 0) {
    logger.info('Layer breakdown: no jobs scheduled.');
    logger.info(`Mock artefacts and logs stored under: ${storagePath}`);
    return;
  }

  logger.info('Layer breakdown:');
  const sortedLayers = Array.from(layerMap.entries()).sort((a, b) => a[0] - b[0]);
  for (const [layerIndex, jobs] of sortedLayers) {
    const layerCounts = { succeeded: 0, failed: 0, skipped: 0 };
    const producerCounts = new Map<string, number>();
    for (const job of jobs) {
      layerCounts[job.status] += 1;
      producerCounts.set(job.producer, (producerCounts.get(job.producer) ?? 0) + 1);
    }
    const statusParts = [
      layerCounts.succeeded ? `succeeded ${layerCounts.succeeded}` : undefined,
      layerCounts.failed ? `failed ${layerCounts.failed}` : undefined,
      layerCounts.skipped ? `skipped ${layerCounts.skipped}` : undefined,
    ].filter(Boolean);
    const statusText = statusParts.length > 0 ? ` (${statusParts.join(', ')})` : '';
    logger.info(`  Layer ${layerIndex}: ${jobs.length} job(s)${statusText}`);
    const producerParts = Array.from(producerCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([producer, count]) => `${producer} ×${count}`);
    if (producerParts.length > 0) {
      logger.info(`    Producers: ${producerParts.join(', ')}`);
    }
  }

  const failingJob = summary.jobs.find((job) => job.status === 'failed');
  if (failingJob) {
    logger.info('First failure:');
    logger.info(`  Layer ${failingJob.layerIndex} – ${failingJob.producer} (${failingJob.jobId})`);
    if (failingJob.errorMessage) {
      logger.info(`  Error: ${failingJob.errorMessage}`);
    }
  }

  logger.info(`Mock artefacts and logs stored under: ${storagePath}`);
}

function buildLayerMap(jobs: DryRunJobSummary[]): Map<number, DryRunJobSummary[]> {
  const map = new Map<number, DryRunJobSummary[]>();
  for (const job of jobs) {
    const bucket = map.get(job.layerIndex);
    if (bucket) {
      bucket.push(job);
    } else {
      map.set(job.layerIndex, [job]);
    }
  }
  return map;
}
