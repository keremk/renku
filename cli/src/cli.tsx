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
import { runClean } from './commands/clean.js';
import { runExport } from './commands/export.js';
import { runProducersList } from './commands/producers-list.js';
import { formatPrice, type ProducerModelEntry } from '@renku/providers';
import { runBlueprintsList } from './commands/blueprints-list.js';
import { runBlueprintsDescribe } from './commands/blueprints-describe.js';
import { runViewerStart, runViewerStop, runViewerView } from './commands/viewer.js';
import { runBlueprintsValidate } from './commands/blueprints-validate.js';
import { runMcpServer } from './commands/mcp.js';
import type { BuildSummary, JobSummary } from './lib/build.js';
import { readCliConfig } from './lib/cli-config.js';
import {
  getBundledBlueprintsRoot,
  getCliBlueprintsRoot,
  resolveBlueprintSpecifier,
} from './lib/config-assets.js';
import { type LogLevel, type Logger as CoreLogger } from '@renku/core';
import { detectViewerAddress } from './lib/viewer-network.js';


const cli = meow(
  `\nUsage\n  $ renku <command> [options]\n\nCommands\n  install             Guided setup (alias for init)\n  init                Initialize Renku CLI configuration (requires --root-folder/--root)\n  generate            Create or continue a movie generation\n  export              Export a movie to MP4 video format\n  clean               Remove friendly view and build artefacts for a movie\n  viewer:start        Start the bundled viewer server in the foreground\n  viewer:view         Open the viewer for a movie id (starts server if needed)\n  viewer:stop         Stop the background viewer server\n  producers:list      List all available models for producers in a blueprint\n  blueprints:list     List available blueprint YAML files\n  blueprints:describe <path>  Show details for a blueprint YAML file\n  blueprints:validate <path>  Validate a blueprint YAML file\n  mcp                 Run the Renku MCP server over stdio\n\nExamples\n  $ renku init --root-folder=~/media/renku\n  $ renku init --root=~/media/renku          # Short form of --root-folder\n  $ renku generate --inputs=~/movies/my-inputs.yaml --blueprint=audio-only.yaml\n  $ renku generate --inputs=~/movies/my-inputs.yaml --blueprint=audio-only.yaml --concurrency=3\n  $ renku generate --last --up-to-layer=1\n  $ renku export --movie-id=abc123\n  $ renku export --last --width=1920 --height=1080 --fps=30\n  $ renku producers:list --blueprint=image-audio.yaml\n  $ renku blueprints:list\n  $ renku blueprints:describe audio-only.yaml\n  $ renku blueprints:validate image-audio.yaml\n  $ renku clean --movie-id=movie-q123456\n  $ renku viewer:start\n  $ renku viewer:view --movie-id=movie-q123456\n  $ renku viewer:view --last\n  $ renku mcp --defaultBlueprint=image-audio.yaml\n`,
  {
    importMeta: import.meta,
    flags: {
      rootFolder: { type: 'string' },
      root: { type: 'string' },
      movieId: { type: 'string' },
      id: { type: 'string' },
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
      logLevel: { type: 'string' },
      upToLayer: { type: 'number' },
      up: { type: 'number' },
      all: { type: 'boolean' },
      costsOnly: { type: 'boolean' },
      width: { type: 'number' },
      height: { type: 'number' },
      fps: { type: 'number' },
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
    logLevel?: string;
    upToLayer?: number;
    up?: number;
    all?: boolean;
    costsOnly?: boolean;
    width?: number;
    height?: number;
    fps?: number;
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
      if (result.envFileCreated) {
        logger.info(`API keys template created at: ${result.envFilePath}`);
        logger.info(`Edit this file with your API keys, then run: source ${result.envFilePath}`);
      } else {
        logger.info(`API keys file exists at: ${result.envFilePath}`);
      }
      return;
    }
    case 'generate': {
      if (remaining.length > 0) {
        logger.error('Error: generate accepts at most one positional argument for the inquiry prompt.');
        process.exitCode = 1;
        return;
      }
      let logLevel: LogLevel;
      try {
        logLevel = resolveLogLevel(flags.logLevel);
      } catch (error) {
        logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
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

      try {
        const result = await runGenerate({
          movieId: movieIdFlag,
          useLast: Boolean(flags.last),
          inputsPath: inputsFlag,
          blueprint: blueprintFlag,
          dryRun: Boolean(flags.dryRun),
          nonInteractive: Boolean(flags.nonInteractive),
          costsOnly: Boolean(flags.costsOnly),
          concurrency: flags.concurrency,
          upToLayer,
          logLevel,
        });
        const viewerUrl =
          !result.isDryRun && result.friendlyRoot
            ? await resolveViewerUrl(result.storageMovieId)
            : undefined;
        printGenerateSummary(logger, result, viewerUrl);
        if (result.isDryRun && result.build) {
          printDryRunSummary(logger, result.build, result.storagePath);
        }
        return;
      } catch (error) {
        logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
        return;
      }
    }
    case 'producers:list': {
      const blueprintFlag = flags.blueprint ?? flags.bp;
      if (!blueprintFlag) {
        logger.error('Error: --blueprint/--bp is required for producers:list.');
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
      const result = await runProducersList({
        blueprintPath,
      });

      if (result.entries.length === 0) {
        logger.info('No producer definitions found in the blueprint.');
        return;
      }

      // Group entries by producer
      const byProducer = new Map<string, ProducerModelEntry[]>();
      for (const entry of result.entries) {
        const bucket = byProducer.get(entry.producer) ?? [];
        bucket.push(entry);
        byProducer.set(entry.producer, bucket);
      }

      logger.info('Producer model configurations:\n');
      for (const [producer, entries] of byProducer) {
        // Determine model type for producer header (all should be same type)
        const modelType = entries[0]?.modelType ?? 'unknown';
        const modelCount = entries.length;
        const modelWord = modelCount === 1 ? 'model' : 'models';
        logger.info(`${producer} (${modelCount} ${modelType} ${modelWord})`);

        // Calculate column widths for alignment
        const maxProviderLen = Math.max(...entries.map((e) => e.provider.length), 8);
        const maxModelLen = Math.max(...entries.map((e) => e.model.length), 5);

        // Print header
        logger.info(`  ${'Provider'.padEnd(maxProviderLen)}  ${'Model'.padEnd(maxModelLen)}  Price`);

        // Print entries
        for (const entry of entries) {
          const priceStr = formatPrice(entry.price);
          logger.info(`  ${entry.provider.padEnd(maxProviderLen)}  ${entry.model.padEnd(maxModelLen)}  ${priceStr}`);
        }
        logger.info('');
      }

      // Show warnings for missing API tokens
      if (result.missingTokens.size > 0) {
        logger.info(chalk.yellow('⚠️  Missing API tokens:'));
        for (const [provider, message] of result.missingTokens) {
          logger.info(chalk.yellow(`  - ${provider}: ${message}`));
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
    case 'export': {
      const movieIdFlag = flags.movieId ?? flags.id;

      if (!flags.last && !movieIdFlag) {
        logger.error('Error: --movie-id/--id or --last is required for export.');
        process.exitCode = 1;
        return;
      }
      if (flags.last && movieIdFlag) {
        logger.error('Error: use either --last or --movie-id/--id, not both.');
        process.exitCode = 1;
        return;
      }

      try {
        logger.info('Starting export...');
        const result = await runExport({
          movieId: movieIdFlag,
          useLast: Boolean(flags.last),
          width: flags.width,
          height: flags.height,
          fps: flags.fps,
        });
        logger.info('Export completed successfully.');
        logger.info(`  Movie: ${result.movieId}`);
        logger.info(`  Output: ${result.friendlyPath}`);
        logger.info(`  Resolution: ${result.width}x${result.height} @ ${result.fps}fps`);
      } catch (error) {
        logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      }
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
        useLast: flags.last,
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

function resolveLogLevel(levelFlag: string | undefined): LogLevel {
  if (levelFlag === undefined || levelFlag === 'info') {
    return 'info';
  }
  if (levelFlag === 'debug') {
    return 'debug';
  }
  throw new Error('Invalid log level. Use "info" or "debug".');
}

function printGenerateSummary(
  logger: CoreLogger,
  result: Awaited<ReturnType<typeof runGenerate>>,
  viewerUrl?: string,
): void {
  const modeLabel = result.isNew ? 'New movie' : 'Updated movie';
  const statusInfo = result.build
    ? { label: result.isDryRun ? 'Dry run' : 'Build', status: result.build.status, jobs: result.build.jobCount }
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

  // Skip showing paths if the directory was cleaned up
  if (result.cleanedUp) {
    return;
  }

  const detailLines: Array<[string, string]> = [
    [`${chalk.bold('Plan')}`, result.planPath],
    ...(result.manifestPath ? [[`${chalk.bold('Manifest')}`, result.manifestPath] as [string, string]] : []),
    [`${chalk.bold('Builds')}`, result.storagePath],
    ...(result.friendlyRoot ? [[`${chalk.bold('Workspace')}`, result.friendlyRoot] as [string, string]] : []),
    ...(viewerUrl
      ? [[`${chalk.bold('Viewer')}`, viewerUrl] as [string, string]]
      : result.friendlyRoot
        ? [[`${chalk.bold('Viewer')}`, `renku viewer:view --movie-id=${result.storageMovieId}`] as [string, string]]
        : []),
  ];
  const bullet = chalk.dim('•');
  for (const [label, value] of detailLines) {
    logger.info(`${bullet} ${label}: ${value}`);
  }
}

function printDryRunSummary(logger: CoreLogger, summary: BuildSummary, storagePath: string): void {
  const counts = summary.counts;
  const layersLabel = summary.layers === 1 ? 'layer' : 'layers';
  const jobsLabel = summary.jobCount === 1 ? 'job' : 'jobs';
  logger.info(
    `Dry run status: ${summary.status}. ${summary.layers} ${layersLabel}, ${summary.jobCount} ${jobsLabel} (succeeded ${counts.succeeded}, failed ${counts.failed}, skipped ${counts.skipped}).`,
  );

  const jobs = summary.jobs ?? [];
  const layerMap = buildLayerMap(jobs);
  if (layerMap.size === 0) {
    logger.info('Layer breakdown: no jobs scheduled.');
    logger.info(`Mock artefacts and logs stored under: ${storagePath}`);
    return;
  }

  logger.info('Layer breakdown:');
  const sortedLayers = Array.from(layerMap.entries()).sort((a, b) => a[0] - b[0]);
  for (const [layerIndex, layerJobs] of sortedLayers) {
    const layerCounts = { succeeded: 0, failed: 0, skipped: 0 };
    const producerCounts = new Map<string, number>();
    for (const job of layerJobs) {
      layerCounts[job.status] += 1;
      producerCounts.set(job.producer, (producerCounts.get(job.producer) ?? 0) + 1);
    }
    const statusParts = [
      layerCounts.succeeded ? `succeeded ${layerCounts.succeeded}` : undefined,
      layerCounts.failed ? `failed ${layerCounts.failed}` : undefined,
      layerCounts.skipped ? `skipped ${layerCounts.skipped}` : undefined,
    ].filter(Boolean);
    const statusText = statusParts.length > 0 ? ` (${statusParts.join(', ')})` : '';
    logger.info(`  Layer ${layerIndex}: ${layerJobs.length} job(s)${statusText}`);
    const producerParts = Array.from(producerCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([producer, count]) => `${producer} ×${count}`);
    if (producerParts.length > 0) {
      logger.info(`    Producers: ${producerParts.join(', ')}`);
    }
  }

  const failingJob = jobs.find((job) => job.status === 'failed');
  if (failingJob) {
    logger.info('First failure:');
    logger.info(`  Layer ${failingJob.layerIndex} – ${failingJob.producer} (${failingJob.jobId})`);
    if (failingJob.errorMessage) {
      logger.info(`  Error: ${failingJob.errorMessage}`);
    }
  }

  logger.info(`Mock artefacts and logs stored under: ${storagePath}`);
}

function buildLayerMap(jobs: JobSummary[]): Map<number, JobSummary[]> {
  const map = new Map<number, JobSummary[]>();
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

async function resolveViewerUrl(movieId: string): Promise<string | undefined> {
  const detected = await detectViewerAddress({ requireRunning: true });
  if (!detected) {
    return undefined;
  }
  const path = `/movies/${encodeURIComponent(movieId)}`;
  return `http://${detected.address.host}:${detected.address.port}${path}`;
}
