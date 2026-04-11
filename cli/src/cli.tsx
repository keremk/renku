#!/usr/bin/env node
/* eslint-env node */
import process from 'node:process';
import meow from 'meow';
import chalk from 'chalk';

sanitizeDebugEnvVar('DEBUG');
sanitizeDebugEnvVar('NODE_DEBUG');
delete process.env.DOTENV_CONFIG_DEBUG;

const restoreStdout = silenceStdout();
try {
	const { loadEnv } = await import('@gorenku/core');
	loadEnv(import.meta.url);
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
		.filter(
			(entry) => entry.length > 0 && !entry.toLowerCase().includes('dotenv')
		);
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
import { runUpdate } from './commands/update.js';
import { runUse } from './commands/use.js';
import { runGenerate } from './commands/generate.js';
import { runClean } from './commands/clean.js';
import { runList } from './commands/list.js';
import { runExport } from './commands/export.js';
import { runProducersList } from './commands/producers-list.js';
import { runCreateInputTemplate } from './commands/create-input-template.js';
import { runNewBlueprint } from './commands/new-blueprint.js';
import { runNewVideo } from './commands/new-video.js';
import { formatPrice, type ProducerModelEntry } from '@gorenku/providers';
import { runLaunch, runShutdown } from './commands/launch.js';
import { runExplain } from './commands/explain.js';
import { runBlueprintsValidate } from './commands/blueprints-validate.js';
import { runBlueprintsDryRunProfile } from './commands/blueprints-dry-run-profile.js';
import { runMcpServer } from './commands/mcp.js';
import { runExportDavinci } from './commands/export-davinci.js';
import type { BuildSummary, JobSummary } from './lib/build.js';
import { readCliConfig } from './lib/cli-config.js';
import { resolveBlueprintSpecifier } from './lib/config-assets.js';
import {
	type BlueprintDryRunValidationResult,
	type LogLevel,
	type Logger as CoreLogger,
	isRenkuError,
	formatError,
} from '@gorenku/core';
import { detectViewerAddress } from './lib/viewer-network.js';

const cli = meow(
	`\nUsage\n  $ renku <command> [options]\n\nCommands\n  install             Guided setup (alias for init)\n  init                Initialize a new Renku workspace (requires --root)\n  update              Update the catalog in the active workspace\n  use                 Switch to an existing workspace (requires --root)\n  generate            Create or continue a movie generation\n  new:blueprint       Create a new blueprint folder with scaffold files\n  new:video           Create a new build for a blueprint (optionally named)\n  create:input-template  Create an inputs YAML template for a blueprint\n  export              Export a movie to MP4/MP3 (--exporter=remotion|ffmpeg)\n  export:davinci      Export timeline to OTIO format for DaVinci Resolve\n  explain             Explain why jobs were scheduled in a saved plan\n  clean               Remove dry-run builds (--all to include completed builds)\n  list                List builds in current project (shows dry-run vs completed)\n  launch [blueprint-name]  Open Renku app (optional blueprint deep-link by name)\n  shutdown            Stop the background viewer server\n  producers:list      List all available models for producers in a blueprint\n  blueprints:validate <path>  Validate a blueprint YAML file\n  blueprints:dry-run-profile <path>  Generate a dry-run profile file\n  mcp                 Run the Renku MCP server over stdio\n\nExamples\n  $ renku init --root=~/media/renku\n  $ renku update                             # Update catalog in active workspace\n  $ renku use --root=~/media/other-workspace # Switch to another workspace\n  $ renku new:blueprint history-video      # Create a new blueprint folder\n  $ renku new:blueprint my-video --using=ken-burns  # Copy from catalog blueprint\n  $ renku create:input-template --blueprint=documentary-talking-head.yaml\n  $ renku new:video "Draft v1"            # Auto-detect blueprint in cwd\n  $ renku new:video --blueprint=audio-only.yaml "Cut A"\n  $ renku generate --inputs=~/movies/my-inputs.yaml --blueprint=audio-only.yaml\n  $ renku generate --inputs=~/movies/my-inputs.yaml --blueprint=audio-only.yaml --concurrency=3\n  $ renku generate --movie-id=movie-abc123 --up-to-layer=1 --inputs=./inputs.yaml\n  $ renku generate --movie-id=movie-abc123 --regen=Artifact:AudioProducer.GeneratedAudio[0] --inputs=./inputs.yaml\n  $ renku generate --movie-id=movie-abc123 --regen=Producer:AudioProducer --inputs=./inputs.yaml\n  $ renku generate --movie-id=movie-abc123 --pid=Producer:AudioProducer:1 --inputs=./inputs.yaml\n  $ renku generate --movie-id=movie-abc123 --pin=Artifact:ScriptProducer.NarrationScript[0] --inputs=./inputs.yaml\n  $ renku generate --movie-id=movie-abc123 --inputs=./inputs.yaml --explain  # Show why each job is scheduled\n  $ renku explain --movie-id=movie-abc123    # Explain a specific movie's plan\n  $ renku export --movie-id=abc123\n  $ renku export --movie-id=abc123 --width=1920 --height=1080 --fps=30\n  $ renku export --movie-id=abc123 --exporter=ffmpeg\n  $ renku export:davinci --movie-id=abc123    # Export to OTIO for DaVinci Resolve\n  $ renku export:davinci --id=abc123 --fps=24 # Export specific movie at 24fps\n  $ renku producers:list --blueprint=image-audio.yaml\n  $ renku blueprints:validate image-audio.yaml\n  $ renku blueprints:dry-run-profile image-audio.yaml\n  $ renku generate --inputs=./inputs.yaml --blueprint=image-audio.yaml --dry-run --profile=./image-audio.dry-run-profile.yaml\n  $ renku list                           # List builds in current project\n  $ renku clean                          # Clean dry-run builds only\n  $ renku clean --all                    # Clean all builds including completed\n  $ renku clean --movie-id=movie-q123456 # Clean specific movie\n  $ renku launch                         # Open home + onboarding flow\n  $ renku launch style-cartoon          # Open specific blueprint by name\n  $ renku shutdown                       # Stop background viewer server\n  $ renku mcp --defaultBlueprint=image-audio.yaml\n`,
	{
		importMeta: import.meta,
		flags: {
			root: { type: 'string' },
			movieId: { type: 'string' },
			id: { type: 'string' },
			inputs: { type: 'string' },
			in: { type: 'string' },
			dryRun: { type: 'boolean' },
			nonInteractive: { type: 'boolean' },
			blueprint: { type: 'string' },
			bp: { type: 'string' },
			concurrency: { type: 'number' },
			movie: { type: 'string' },
			viewerHost: { type: 'string' },
			port: { type: 'number' },
			blueprintsDir: { type: 'string' },
			defaultBlueprint: { type: 'string' },
			openViewer: { type: 'boolean' },
			logLevel: { type: 'string' },
			upToLayer: { type: 'number' },
			up: { type: 'number' },
			regen: { type: 'string', isMultiple: true },
			producerId: { type: 'string', isMultiple: true },
			pid: { type: 'string', isMultiple: true },
			pin: { type: 'string', isMultiple: true },
			all: { type: 'boolean' },
			costsOnly: { type: 'boolean' },
			explain: { type: 'boolean' },
			width: { type: 'number' },
			height: { type: 'number' },
			fps: { type: 'number' },
			exporter: { type: 'string' },
			output: { type: 'string' },
			using: { type: 'string' },
			dryRunProfile: { type: 'string' },
			profile: { type: 'string' },
		},
	}
);

async function main(): Promise<void> {
	const [command, ...rest] = cli.input;
	const positionalInquiry = command === 'generate' ? rest[0] : undefined;
	const remaining = positionalInquiry !== undefined ? rest.slice(1) : rest;
	const flags = cli.flags as {
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
		concurrency?: number;
		movie?: string;
		viewerHost?: string;
		port?: number;
		blueprintsDir?: string;
		defaultBlueprint?: string;
		openViewer?: boolean;
		logLevel?: string;
		upToLayer?: number;
		up?: number;
		regen?: string[];
		producerId?: string[];
		pid?: string[];
		pin?: string[];
		all?: boolean;
		costsOnly?: boolean;
		explain?: boolean;
		width?: number;
		height?: number;
		fps?: number;
		exporter?: string;
		output?: string;
		using?: string;
		dryRunProfile?: string;
		profile?: string;
	};
	const logger = globalThis.console;

	switch (command) {
		case 'install':
		case 'init': {
			const rootFolder = flags.root;
			if (!rootFolder) {
				logger.error('Error: --root is required.');
				logger.error('Example: renku init --root=~/renku-data');
				process.exitCode = 1;
				return;
			}
			const result = await runInit({
				rootFolder,
			});
			logger.info(`All set, successfully initialized Renku!`);
			logger.info(`Workspace root is at: ${result.rootFolder}`);
			logger.info(`Config stored at: ${result.cliConfigPath}`);
			if (result.envFileCreated) {
				logger.info(`API keys template created at: ${result.envFilePath}`);
				logger.info(
					`Edit this file with your API keys, then run: source ${result.envFilePath}`
				);
			} else {
				logger.info(`API keys file exists at: ${result.envFilePath}`);
			}
			return;
		}
		case 'update': {
			try {
				const result = await runUpdate();
				logger.info('Catalog updated successfully.');
				logger.info(`Catalog path: ${result.catalogRoot}`);
			} catch (error) {
				if (isRenkuError(error)) {
					logger.error(formatError(error));
				} else {
					logger.error(
						`Error: ${error instanceof Error ? error.message : String(error)}`
					);
				}
				process.exitCode = 1;
			}
			return;
		}
		case 'use': {
			const rootFolder = flags.root;
			if (!rootFolder) {
				logger.error('Error: --root is required.');
				logger.error('Example: renku use --root=~/media/renku');
				process.exitCode = 1;
				return;
			}
			try {
				const result = await runUse({ rootFolder });
				logger.info('Switched to workspace successfully.');
				logger.info(`Workspace root: ${result.rootFolder}`);
				logger.info(`Catalog path: ${result.catalogRoot}`);
			} catch (error) {
				if (isRenkuError(error)) {
					logger.error(formatError(error));
				} else {
					logger.error(
						`Error: ${error instanceof Error ? error.message : String(error)}`
					);
				}
				process.exitCode = 1;
			}
			return;
		}
		case 'generate': {
			if (remaining.length > 0) {
				logger.error(
					'Error: generate accepts at most one positional argument for the inquiry prompt.'
				);
				process.exitCode = 1;
				return;
			}
			let logLevel: LogLevel;
			try {
				logLevel = resolveLogLevel(flags.logLevel);
			} catch (error) {
				logger.error(
					`Error: ${error instanceof Error ? error.message : String(error)}`
				);
				process.exitCode = 1;
				return;
			}

			const movieIdFlag = flags.movieId ?? flags.id;
			const blueprintFlag = flags.blueprint ?? flags.bp;
			const inputsFlag = flags.inputs ?? flags.in;
			const dryRunProfileFlag = flags.dryRunProfile ?? flags.profile;
			const upToLayer = flags.upToLayer ?? flags.up;
			const regenerateFlags = [...(flags.regen ?? [])];
			const producerIdFlags = [
				...(flags.producerId ?? []),
				...(flags.pid ?? []),
			];
			const pinFlags = [...(flags.pin ?? [])];

			if (positionalInquiry !== undefined) {
				logger.error(
					'Error: inline inquiry prompt is no longer supported. Provide it in your inputs.yaml.'
				);
				process.exitCode = 1;
				return;
			}

			const targetingExisting = Boolean(movieIdFlag);

			const resolvedInputsPath = inputsFlag;

			if (dryRunProfileFlag && !flags.dryRun) {
				logger.error('Error: --dry-run-profile/--profile requires --dry-run.');
				process.exitCode = 1;
				return;
			}

			if (!targetingExisting) {
				if (!blueprintFlag) {
					logger.error(
						'Error: --blueprint/--bp is required for a new generation.'
					);
					process.exitCode = 1;
					return;
				}

				// Inputs are required for new generation
				if (!inputsFlag) {
					logger.error(
						'Error: --inputs/--in is required for a new generation.'
					);
					logger.error(
						'Use "renku create:input-template --bp=<blueprint>" to create an inputs file.'
					);
					process.exitCode = 1;
					return;
				}
			}

			try {
				const result = await runGenerate({
					movieId: movieIdFlag,
					inputsPath: resolvedInputsPath,
					blueprint: blueprintFlag,
					dryRun: Boolean(flags.dryRun),
					nonInteractive: Boolean(flags.nonInteractive),
					costsOnly: Boolean(flags.costsOnly),
					explain: Boolean(flags.explain),
					concurrency: flags.concurrency,
					upToLayer,
					regenerateIds:
						regenerateFlags.length > 0 ? regenerateFlags : undefined,
					producerIds:
						producerIdFlags.length > 0 ? producerIdFlags : undefined,
					pinIds: pinFlags.length > 0 ? pinFlags : undefined,
					dryRunProfilePath: dryRunProfileFlag,
					logLevel,
				});
				const viewerUrl =
					!result.isDryRun && result.artifactsRoot
						? await resolveViewerUrl(result.storageMovieId)
						: undefined;
				printGenerateSummary(logger, result, viewerUrl);
				if (result.isDryRun && result.build) {
					printDryRunSummary(logger, result.build, result.storagePath);
				}
				if (result.isDryRun && result.dryRunValidation) {
					printDryRunValidationSummary(logger, result.dryRunValidation);
				}
				return;
			} catch (error) {
				if (isRenkuError(error)) {
					logger.error(formatError(error));
				} else {
					logger.error(
						`Error: ${error instanceof Error ? error.message : String(error)}`
					);
				}
				process.exitCode = 1;
				return;
			}
		}
		case 'new:blueprint': {
			const blueprintName = rest[0];
			if (!blueprintName) {
				logger.error('Error: blueprint name is required for new:blueprint.');
				logger.error('Usage: renku new:blueprint <name>');
				logger.error('Example: renku new:blueprint history-video');
				process.exitCode = 1;
				return;
			}

			// Get catalog root if --using is provided
			let catalogRoot: string | undefined;
			if (flags.using) {
				const cliConfig = await readCliConfig();
				if (!cliConfig) {
					logger.error('Renku CLI is not initialized. Run "renku init" first.');
					process.exitCode = 1;
					return;
				}
				catalogRoot = cliConfig.catalog?.root;
				if (!catalogRoot) {
					logger.error(
						'Catalog root not configured. Run "renku init" to set up the workspace.'
					);
					process.exitCode = 1;
					return;
				}
			}

			try {
				const result = await runNewBlueprint({
					name: blueprintName,
					outputDir: flags.output,
					using: flags.using,
					catalogRoot,
				});
				if (result.copiedFromCatalog) {
					logger.info(
						`Blueprint folder created from catalog: ${result.folderPath}`
					);
					logger.info(`  Copied from: ${flags.using}`);
				} else {
					logger.info(`Blueprint folder created: ${result.folderPath}`);
				}
				logger.info(`  Blueprint file: ${result.blueprintPath}`);
				logger.info(`  Input template: ${result.inputTemplatePath}`);
			} catch (error) {
				if (isRenkuError(error)) {
					logger.error(formatError(error));
				} else {
					logger.error(
						`Error: ${error instanceof Error ? error.message : String(error)}`
					);
				}
				process.exitCode = 1;
			}
			return;
		}
		case 'new:video': {
			const displayName = rest.length > 0 ? rest.join(' ').trim() : undefined;
			const blueprintFlag = flags.blueprint ?? flags.bp;

			try {
				const result = await runNewVideo({
					blueprint: blueprintFlag,
					displayName,
				});
				logger.info(`Build created: ${result.movieId}`);
				logger.info(`  Blueprint: ${result.blueprintPath}`);
				logger.info(`  Build folder: ${result.buildDir}`);
				logger.info(`  Inputs: ${result.inputsPath}`);
			} catch (error) {
				if (isRenkuError(error)) {
					logger.error(formatError(error));
				} else {
					logger.error(
						`Error: ${error instanceof Error ? error.message : String(error)}`
					);
				}
				process.exitCode = 1;
			}
			return;
		}
		case 'create:input-template': {
			const blueprintFlag = flags.blueprint ?? flags.bp;
			if (!blueprintFlag) {
				logger.error(
					'Error: --blueprint/--bp is required for create:input-template.'
				);
				process.exitCode = 1;
				return;
			}
			const cliConfig = await readCliConfig();
			if (!cliConfig) {
				logger.error('Renku CLI is not initialized. Run "renku init" first.');
				process.exitCode = 1;
				return;
			}

			const result = await runCreateInputTemplate({
				blueprint: blueprintFlag,
				cliConfig,
				logger,
				outputDir: flags.output,
			});

			if (result.success) {
				logger.info(`Input template created: ${result.inputsPath}`);
			} else if (result.cancelled) {
				logger.info('Cancelled.');
			} else {
				logger.error(`Failed: ${result.error}`);
				process.exitCode = 1;
			}
			return;
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
				const maxProviderLen = Math.max(
					...entries.map((e) => e.provider.length),
					8
				);
				const maxModelLen = Math.max(...entries.map((e) => e.model.length), 5);

				// Print header
				logger.info(
					`  ${'Provider'.padEnd(maxProviderLen)}  ${'Model'.padEnd(maxModelLen)}  Price`
				);

				// Print entries
				for (const entry of entries) {
					const priceStr = formatPrice(entry.price);
					logger.info(
						`  ${entry.provider.padEnd(maxProviderLen)}  ${entry.model.padEnd(maxModelLen)}  ${priceStr}`
					);
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
		case 'blueprints:validate': {
			const blueprintPath = rest[0];
			if (!blueprintPath) {
				logger.error(
					'Error: blueprint file path is required for blueprints:validate.'
				);
				logger.error(
					'Usage: renku blueprints:validate <path-to-blueprint.yaml>'
				);
				process.exitCode = 1;
				return;
			}

			const cliConfig = await readCliConfig();
			const resolvedPath = await resolveBlueprintSpecifier(blueprintPath, {
				cliRoot: cliConfig?.storage.root,
			});
			const result = await runBlueprintsValidate({
				blueprintPath: resolvedPath,
			});

			if (result.valid) {
				logger.info(`✓ Blueprint "${result.name ?? result.path}" is valid`);
				logger.info(`Path: ${result.path}`);
				if (
					typeof result.nodeCount === 'number' &&
					typeof result.edgeCount === 'number'
				) {
					logger.info(`Nodes: ${result.nodeCount}, Edges: ${result.edgeCount}`);
				}
				printBlueprintValidationWarnings(logger, result.warnings);
			} else {
				logger.error(`✗ Blueprint validation failed\n`);
				logger.error(`Error: ${result.error}`);
				printBlueprintValidationWarnings(logger, result.warnings);
				process.exitCode = 1;
			}
			return;
		}
		case 'blueprints:dry-run-profile': {
			const blueprintPath = rest[0];
			if (!blueprintPath) {
				logger.error(
					'Error: blueprint file path is required for blueprints:dry-run-profile.'
				);
				logger.error(
					'Usage: renku blueprints:dry-run-profile <path-to-blueprint.yaml> [--output=<path>]'
				);
				process.exitCode = 1;
				return;
			}

			const cliConfig = await readCliConfig();
			const resolvedPath = await resolveBlueprintSpecifier(blueprintPath, {
				cliRoot: cliConfig?.storage.root,
			});

			try {
				const result = await runBlueprintsDryRunProfile({
					blueprintPath: resolvedPath,
					outputPath: flags.output,
				});
				logger.info(
					`✓ Dry-run profile generated for "${result.blueprintPath}"`
				);
				logger.info(`Output: ${result.outputPath}`);
				logger.info(
					`Condition fields: ${result.conditionFieldCount}, cases: ${result.caseCount}`
				);
			} catch (error) {
				logger.error(
					`Error: ${error instanceof Error ? error.message : String(error)}`
				);
				process.exitCode = 1;
			}
			return;
		}
		case 'list': {
			await runList({ logger });
			return;
		}
		case 'explain': {
			const movieIdFlag = flags.movieId ?? flags.id;
			if (!movieIdFlag) {
				logger.error('Error: --movie-id/--id is required for explain.');
				process.exitCode = 1;
				return;
			}

			try {
				await runExplain({
					movieId: movieIdFlag,
					logger,
				});
			} catch (error) {
				logger.error(
					`Error: ${error instanceof Error ? error.message : String(error)}`
				);
				process.exitCode = 1;
			}
			return;
		}
		case 'clean': {
			const movieId = rest[0] ?? flags.movieId ?? flags.id;
			await runClean({
				movieId: movieId || undefined,
				all: flags.all,
				dryRun: flags.dryRun,
				nonInteractive: flags.nonInteractive,
				logger,
			});
			return;
		}
		case 'export': {
			const movieIdFlag = flags.movieId ?? flags.id;
			const inputsFlag = flags.inputs ?? flags.in;

			if (!movieIdFlag) {
				logger.error('Error: --movie-id/--id is required for export.');
				process.exitCode = 1;
				return;
			}

			// Validate exporter flag
			const exporterFlag = flags.exporter;
			if (
				exporterFlag &&
				exporterFlag !== 'remotion' &&
				exporterFlag !== 'ffmpeg'
			) {
				logger.error('Error: --exporter must be "remotion" or "ffmpeg".');
				process.exitCode = 1;
				return;
			}

			try {
				const exporterType = exporterFlag === 'ffmpeg' ? 'ffmpeg' : 'remotion';
				logger.info(`Starting export with ${exporterType} exporter...`);
				const result = await runExport({
					movieId: movieIdFlag,
					width: flags.width,
					height: flags.height,
					fps: flags.fps,
					exporter: exporterType,
					inputsPath: inputsFlag,
				});
				logger.info('Export completed successfully.');
				logger.info(`  Movie: ${result.movieId}`);
				logger.info(`  Output: ${result.artifactsPath}`);
				logger.info(`  Exporter: ${result.exporter}`);
				logger.info(
					`  Resolution: ${result.width}x${result.height} @ ${result.fps}fps`
				);
			} catch (error) {
				logger.error(
					`Error: ${error instanceof Error ? error.message : String(error)}`
				);
				process.exitCode = 1;
			}
			return;
		}
		case 'export:davinci': {
			const movieIdFlag = flags.movieId ?? flags.id;

			if (!movieIdFlag) {
				logger.error('Error: --movie-id/--id is required for export:davinci.');
				process.exitCode = 1;
				return;
			}

			try {
				logger.info('Exporting timeline to OTIO format for DaVinci Resolve...');
				const result = await runExportDavinci({
					movieId: movieIdFlag,
					fps: flags.fps,
				});
				logger.info('Export completed successfully.');
				logger.info(`  Movie: ${result.movieId}`);
				logger.info(`  Output: ${result.artifactsPath}`);
				logger.info(`  FPS: ${result.fps}`);
				logger.info(
					`  Tracks: ${result.stats.trackCount} (${result.stats.videoTrackCount} video, ${result.stats.audioTrackCount} audio)`
				);
				logger.info(`  Clips: ${result.stats.clipCount}`);
				logger.info(`  Duration: ${result.stats.duration.toFixed(1)}s`);
				logger.info('');
				logger.info('To import in DaVinci Resolve:');
				logger.info('  1. Open DaVinci Resolve → Edit page');
				logger.info('  2. Right-click Media Pool → Timelines → Import → OTIO');
				logger.info(`  3. Select: ${result.artifactsPath}`);
			} catch (error) {
				logger.error(
					`Error: ${error instanceof Error ? error.message : String(error)}`
				);
				process.exitCode = 1;
			}
			return;
		}
		case 'launch': {
			if (rest.length > 1) {
				logger.error(
					'Error: launch accepts at most one positional argument (blueprint name).'
				);
				process.exitCode = 1;
				return;
			}

			await runLaunch({
				blueprintName: rest[0],
				host: flags.viewerHost,
				port: flags.port,
				logger,
			});
			return;
		}
		case 'shutdown': {
			await runShutdown({ logger });
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
	viewerUrl?: string
): void {
	const modeLabel = result.isNew ? 'New movie' : 'Updated movie';
	const statusInfo = result.build
		? {
				label: result.isDryRun ? 'Dry run' : 'Build',
				status: result.build.status,
				jobs: result.build.jobCount,
			}
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
		logger.info(
			colorizeStatus(`${statusInfo.label}: ${statusInfo.status}${jobsLabel}\n`)
		);
	} else {
		logger.info(chalk.yellow('No execution performed.\n'));
	}

	// Skip showing paths if the directory was cleaned up
	if (result.cleanedUp) {
		return;
	}

	const detailLines: Array<[string, string]> = [
		[`${chalk.bold('Plan')}`, result.planPath],
		...(result.manifestPath
			? [[`${chalk.bold('Manifest')}`, result.manifestPath] as [string, string]]
			: []),
		[`${chalk.bold('Builds')}`, result.storagePath],
		...(result.artifactsRoot
			? [
					[`${chalk.bold('Artifacts')}`, result.artifactsRoot] as [
						string,
						string,
					],
				]
			: []),
		...(viewerUrl
			? [[`${chalk.bold('Viewer')}`, viewerUrl] as [string, string]]
			: result.artifactsRoot
				? [[`${chalk.bold('Viewer')}`, `renku launch`] as [string, string]]
				: []),
	];
	const bullet = chalk.dim('•');
	for (const [label, value] of detailLines) {
		logger.info(`${bullet} ${label}: ${value}`);
	}

	// Show final output path prominently at the end
	if (result.finalOutputPath) {
		logger.info('');
		logger.info(chalk.green.bold(`Output: ${result.finalOutputPath}`));
	}
}

function printDryRunSummary(
	logger: CoreLogger,
	summary: BuildSummary,
	storagePath: string
): void {
	const counts = summary.counts;
	const layersLabel = summary.layers === 1 ? 'layer' : 'layers';
	const jobsLabel = summary.jobCount === 1 ? 'job' : 'jobs';
	logger.info(
		`Dry run status: ${summary.status}. ${summary.layers} ${layersLabel}, ${summary.jobCount} ${jobsLabel} (succeeded ${counts.succeeded}, failed ${counts.failed}, skipped ${counts.skipped}).`
	);

	const jobs = summary.jobs ?? [];
	const layerMap = buildLayerMap(jobs);
	if (layerMap.size === 0) {
		logger.info('Layer breakdown: no jobs scheduled.');
		logger.info(`Mock artefacts and logs stored under: ${storagePath}`);
		return;
	}

	logger.info('Layer breakdown:');
	const sortedLayers = Array.from(layerMap.entries()).sort(
		(a, b) => a[0] - b[0]
	);
	for (const [layerIndex, layerJobs] of sortedLayers) {
		const layerCounts = { succeeded: 0, failed: 0, skipped: 0 };
		const producerCounts = new Map<string, number>();
		for (const job of layerJobs) {
			layerCounts[job.status] += 1;
			producerCounts.set(
				job.producer,
				(producerCounts.get(job.producer) ?? 0) + 1
			);
		}
		const statusParts = [
			layerCounts.succeeded ? `succeeded ${layerCounts.succeeded}` : undefined,
			layerCounts.failed ? `failed ${layerCounts.failed}` : undefined,
			layerCounts.skipped ? `skipped ${layerCounts.skipped}` : undefined,
		].filter(Boolean);
		const statusText =
			statusParts.length > 0 ? ` (${statusParts.join(', ')})` : '';
		logger.info(
			`  Layer ${layerIndex}: ${layerJobs.length} job(s)${statusText}`
		);
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
		logger.info(
			`  Layer ${failingJob.layerIndex} – ${failingJob.producer} (${failingJob.jobId})`
		);
		if (failingJob.errorMessage) {
			logger.info(`  Error: ${failingJob.errorMessage}`);
		}
	}

	logger.info(`Mock artefacts and logs stored under: ${storagePath}`);
}

function printDryRunValidationSummary(
	logger: CoreLogger,
	validation: BlueprintDryRunValidationResult
): void {
	logger.info('Dry-run validation coverage:');
	logger.info(
		`  Cases: ${validation.totalCases} total (${validation.passedCases} passed, ${validation.failedCases} failed)`
	);

	if (validation.sourceTestFilePath) {
		logger.info(`  Scenario file: ${validation.sourceTestFilePath}`);
	}
	if (validation.generatedTestFilePath) {
		logger.info(
			`  Generated scenario file: ${validation.generatedTestFilePath}`
		);
	}

	if (validation.caseResults.length > 0) {
		const failedCases = validation.caseResults.filter(
			(result) => result.status === 'failed'
		);
		if (failedCases.length === 0) {
			logger.info('  Case outcomes: all cases succeeded.');
		} else {
			logger.info('  Case outcomes:');
			for (const failedCase of failedCases) {
				logger.info(
					`    ${failedCase.id}: failed (${failedCase.failedJobs.join(', ')})`
				);
			}
		}
	}

	if (validation.fieldCoverage.length > 0) {
		logger.info(`  Condition fields: ${validation.fieldCoverage.length}`);
		for (const coverage of validation.fieldCoverage) {
			const dualOutcome = coverage.requiresDualOutcome
				? coverage.trueOutcomeObserved && coverage.falseOutcomeObserved
					? 'dual-outcome covered'
					: 'dual-outcome missing'
				: 'dual-outcome not required';
			const dimensions =
				coverage.dimensions.length > 0
					? `dimensions ${coverage.dimensions.join(', ')}`
					: 'no indexed dimensions';
			const variation =
				coverage.dimensionVariation.length > 0
					? `variation ${coverage.dimensionVariation
							.map((value) => (value ? 'yes' : 'no'))
							.join('/')}`
					: 'variation n/a';
			logger.info(
				`    ${coverage.field}: ${coverage.matchedArtifacts} artefacts, ${dualOutcome}, ${dimensions}, ${variation}`
			);
		}
	}

	for (const warning of validation.warnings) {
		logger.info(`  Warning: ${warning}`);
	}

	if (validation.failures.length > 0) {
		logger.info('  Failures:');
		for (const failure of validation.failures) {
			logger.info(`    - ${failure}`);
		}
	}
}

function printBlueprintValidationWarnings(
	logger: CoreLogger,
	warnings:
		| Array<{
				code: string;
				message: string;
				location: { context: string };
				suggestion?: string;
		  }>
		| undefined
): void {
	if (!warnings || warnings.length === 0) {
		return;
	}

	logger.info(chalk.yellow(`Warnings (${warnings.length}):`));
	for (const warning of warnings) {
		logger.info(chalk.yellow(`  - [${warning.code}] ${warning.message}`));
		if (warning.location.context) {
			logger.info(chalk.yellow(`    Context: ${warning.location.context}`));
		}
		if (warning.suggestion) {
			logger.info(chalk.yellow(`    Suggestion: ${warning.suggestion}`));
		}
	}
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
	// Use blueprints route with movie parameter
	const url = new URL(
		`http://${detected.address.host}:${detected.address.port}/blueprints`
	);
	url.searchParams.set('movie', movieId);
	return url.toString();
}
