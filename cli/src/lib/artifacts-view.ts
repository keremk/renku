import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
	createManifestService,
	createMovieMetadataService,
	createStorageContext,
	filterActiveOutputBindings,
	formatBlobFileName,
	getCliArtifactsConfig,
	isCanonicalArtifactId,
	materializeArtifactFile,
	materializeManifestArtifacts,
	resolveArtifactsMovieFolderName,
	resolveArtifactsMovieRoot,
	resolveExpectedArtifactPath,
	type BlobRef,
	type Manifest,
	type RootOutputBinding,
} from '@gorenku/core';
import type { PendingArtefactDraft } from './planner.js';
import type { CliConfig } from './cli-config.js';

const log = globalThis.console;

export interface ArtifactInfo {
	artefactId: string;
	artifactPath: string;
	sourcePath: string;
	hash: string;
	producedBy: string;
	mimeType?: string;
	kind: 'blob';
}

export interface MaterializedRootOutput {
	outputId: string;
	artifactId: string;
	artifactPath: string;
	producedBy: string;
	mimeType?: string;
}

export interface ArtifactsViewContext {
	artifactsRoot: string;
	artefacts: ArtifactInfo[];
	inputsPath: string;
}

export interface ArtifactsPreflightResult {
	pendingArtefacts: PendingArtefactDraft[];
	changed: boolean;
	artifacts: ArtifactsViewContext;
}

export function resolveMaterializedRootOutputs(args: {
	rootOutputBindings: RootOutputBinding[];
	artefacts: ArtifactInfo[];
	resolvedArtifacts?: Record<string, unknown>;
	resolvedInputs?: Record<string, unknown>;
}): MaterializedRootOutput[] {
	const artefactsById = new Map(
		args.artefacts.map((artefact) => [artefact.artefactId, artefact])
	);
	const outputs: MaterializedRootOutput[] = [];
	const activeBindings = filterActiveOutputBindings(args.rootOutputBindings, {
		resolvedArtifacts: args.resolvedArtifacts ?? {},
		resolvedInputs: args.resolvedInputs,
		hasProducedStoryState: args.artefacts.length > 0,
	});

	for (const binding of activeBindings) {
		if (!isCanonicalArtifactId(binding.sourceId)) {
			continue;
		}
		const artefact = artefactsById.get(binding.sourceId);
		if (!artefact) {
			continue;
		}
		outputs.push({
			outputId: binding.outputId,
			artifactId: artefact.artefactId,
			artifactPath: artefact.artifactPath,
			producedBy: artefact.producedBy,
			mimeType: artefact.mimeType,
		});
	}

	return outputs;
}

export function selectFinalStageOutputs(args: {
	rootOutputs: MaterializedRootOutput[];
	finalStageProducerJobIds: string[];
}): MaterializedRootOutput[] {
	if (args.rootOutputs.length === 0 || args.finalStageProducerJobIds.length === 0) {
		return [];
	}

	const finalStageJobIds = new Set(args.finalStageProducerJobIds);
	return args.rootOutputs.filter((output) => finalStageJobIds.has(output.producedBy));
}

export async function loadCurrentManifest(
	cliConfig: CliConfig,
	movieId: string
): Promise<{ manifest: Manifest; hash: string | null }> {
	const storage = createStorageContext({
		kind: 'local',
		rootDir: cliConfig.storage.root,
		basePath: cliConfig.storage.basePath,
	});
	const manifestService = createManifestService(storage);
	return manifestService.loadCurrent(movieId);
}

export async function buildArtifactsView(args: {
	cliConfig: CliConfig;
	movieId: string;
	manifest: Manifest;
}): Promise<ArtifactsViewContext> {
	const { cliConfig, movieId, manifest } = args;
	const artifactsConfig = getCliArtifactsConfig(cliConfig);

	const storage = createStorageContext({
		kind: 'local',
		rootDir: cliConfig.storage.root,
		basePath: cliConfig.storage.basePath,
	});
	const metadataService = createMovieMetadataService(storage);
	const artifactsMovieFolderName = await resolveArtifactsMovieFolderName({
		movieId,
		metadataService,
	});

	const materialized = await materializeManifestArtifacts({
		storageRoot: cliConfig.storage.root,
		storageBasePath: cliConfig.storage.basePath,
		movieId,
		artifactsMovieFolderName,
		manifest,
		mode: artifactsConfig.mode,
		logger: log,
	});

	const inputsPath = resolve(
		cliConfig.storage.root,
		cliConfig.storage.basePath,
		movieId,
		'inputs.yaml'
	);

	const artefacts: ArtifactInfo[] = materialized.artefacts.map((entry) => ({
		...entry,
		kind: 'blob',
	}));

	return {
		artifactsRoot: materialized.artifactsRoot,
		artefacts,
		inputsPath,
	};
}

export async function prepareArtifactsPreflight(args: {
	cliConfig: CliConfig;
	movieId: string;
	manifest: Manifest;
	allowShardedBlobs?: boolean;
}): Promise<ArtifactsPreflightResult> {
	const artifactsConfig = getCliArtifactsConfig(args.cliConfig);
	const artifacts = await collectArtifactsContext({
		...args,
		mode: artifactsConfig.mode,
	});
	const pending: PendingArtefactDraft[] = [];
	let changed = false;

	for (const entry of artifacts.artefacts) {
		const nextHash = await hashFile(entry.artifactPath);
		if (nextHash === entry.hash) {
			continue;
		}
		changed = true;

		const buffer = await readFile(entry.artifactPath);
		const blobRef = await persistBlobSharded(
			buffer,
			entry.mimeType,
			args.cliConfig,
			args.movieId
		);

		const shardedPath = shardedBlobPath(
			args.cliConfig,
			args.movieId,
			blobRef.hash,
			blobRef.mimeType
		);
		await materializeArtifactFile({
			sourcePath: shardedPath,
			targetPath: entry.artifactPath,
			mode: artifactsConfig.mode,
		});

		pending.push({
			artefactId: entry.artefactId,
			producedBy: entry.producedBy,
			output: { blob: blobRef },
			diagnostics: { source: 'artifact-edit' },
		});
	}

	return { pendingArtefacts: pending, changed, artifacts };
}

async function collectArtifactsContext(args: {
	cliConfig: CliConfig;
	movieId: string;
	manifest: Manifest;
	allowShardedBlobs?: boolean;
	mode: 'copy' | 'symlink';
}): Promise<ArtifactsViewContext> {
	const { cliConfig, movieId, manifest, mode } = args;

	const storage = createStorageContext({
		kind: 'local',
		rootDir: cliConfig.storage.root,
		basePath: cliConfig.storage.basePath,
	});
	const metadataService = createMovieMetadataService(storage);
	const artifactsMovieFolderName = await resolveArtifactsMovieFolderName({
		movieId,
		metadataService,
	});

	const artifactsRoot = resolveArtifactsMovieRoot(
		cliConfig.storage.root,
		cliConfig.storage.basePath,
		artifactsMovieFolderName
	);
	await mkdir(artifactsRoot, { recursive: true });

	const inputsPath = resolve(
		cliConfig.storage.root,
		cliConfig.storage.basePath,
		movieId,
		'inputs.yaml'
	);

	const artefacts: ArtifactInfo[] = [];
	for (const [artefactId, entry] of Object.entries(manifest.artefacts)) {
		if (!entry.blob) {
			continue;
		}

		const artifactPath = resolveExpectedArtifactPath({
			storageRoot: cliConfig.storage.root,
			storageBasePath: cliConfig.storage.basePath,
			artifactsMovieFolderName,
			artifactId: artefactId,
			producedBy: entry.producedBy,
			mimeType: entry.blob.mimeType,
		});
		await mkdir(dirname(artifactPath), { recursive: true });

		const shardedPath = shardedBlobPath(
			cliConfig,
			movieId,
			entry.blob.hash,
			entry.blob.mimeType
		);
		if (!(await pathExists(shardedPath))) {
			log.warn(
				`Warning: blob missing for ${artefactId} at ${shardedPath}. Artifact output not materialized.`
			);
			continue;
		}

		if (!(await pathExists(artifactPath))) {
			await materializeArtifactFile({
				sourcePath: shardedPath,
				targetPath: artifactPath,
				mode,
			});
		}

		artefacts.push({
			artefactId,
			artifactPath,
			sourcePath: shardedPath,
			hash: entry.hash,
			producedBy: entry.producedBy,
			mimeType: entry.blob.mimeType,
			kind: 'blob',
		});
	}

	return { artifactsRoot, artefacts, inputsPath };
}

async function hashFile(filePath: string): Promise<string> {
	const data = await readFile(filePath);
	return createHash('sha256').update(data).digest('hex');
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await lstat(targetPath);
		return true;
	} catch {
		return false;
	}
}

async function persistBlobSharded(
	data: Buffer,
	mimeType: string | undefined,
	cliConfig: CliConfig,
	movieId: string
): Promise<BlobRef> {
	const hash = createHash('sha256').update(data).digest('hex');
	const destination = shardedBlobPath(cliConfig, movieId, hash, mimeType);
	await mkdir(dirname(destination), { recursive: true });
	await writeFile(destination, data);
	return {
		hash,
		size: data.byteLength,
		mimeType: mimeType ?? 'application/octet-stream',
	};
}

function shardedBlobPath(
	cliConfig: CliConfig,
	movieId: string,
	hash: string,
	mimeType?: string
): string {
	const fileName = formatBlobFileName(hash, mimeType);
	const base = resolve(
		cliConfig.storage.root,
		cliConfig.storage.basePath,
		movieId,
		'blobs'
	);
	return resolve(base, hash.slice(0, 2), fileName);
}
