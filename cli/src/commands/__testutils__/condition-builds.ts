import { Buffer } from 'node:buffer';
import {
	createEventLog,
	createStorageContext,
	formatBlobFileName,
	initializeMovieStorage,
} from '@gorenku/core';
import type { CliConfig } from '../../lib/cli-config.js';

export interface ExistingConditionBuildFixture {
	root: string;
	cliConfig: CliConfig;
	movieId: string;
	inputsPath: string;
	blueprintPath: string;
	storage: ReturnType<typeof createStorageContext>;
	eventLog: ReturnType<typeof createEventLog>;
}

export async function createExistingConditionBuild(args: {
	root: string;
	catalogRoot: string;
	blueprintPath: string;
	inputsPath: string;
	blobHash: string;
	blobContents?: string;
	legacyFileName?: boolean;
	writeBlob?: boolean;
}): Promise<ExistingConditionBuildFixture> {
	const movieId = 'movie-conditional-existing-build';
	const storage = createStorageContext({
		kind: 'local',
		rootDir: args.root,
		basePath: 'builds',
	});
	await initializeMovieStorage(storage, movieId);
	const eventLog = createEventLog(storage);

	await appendConditionArtifactEvent(
		{
			movieId,
			eventLog,
		},
		{
			revision: 'rev-0001',
			status: 'succeeded',
			blob: {
				hash: args.blobHash,
				size: args.blobContents?.length ?? 5,
				mimeType: 'text/plain',
			},
		}
	);

	if (args.writeBlob ?? true) {
		await writeConditionBlob(storage, movieId, {
			hash: args.blobHash,
			mimeType: 'text/plain',
			contents: args.blobContents ?? 'false',
			legacyFileName: args.legacyFileName,
		});
	}

	return {
		root: args.root,
		cliConfig: {
			storage: { root: args.root, basePath: 'builds' },
			catalog: { root: args.catalogRoot },
		},
		movieId,
		inputsPath: args.inputsPath,
		blueprintPath: args.blueprintPath,
		storage,
		eventLog,
	};
}

export async function appendConditionArtifactEvent(
	fixture: Pick<ExistingConditionBuildFixture, 'movieId' | 'eventLog'>,
	args: {
		revision: `rev-${string}`;
		status: 'succeeded' | 'failed' | 'skipped';
		blob?: {
			hash: string;
			size: number;
			mimeType: string;
		};
	}
): Promise<void> {
	await fixture.eventLog.appendArtifact(fixture.movieId, {
		artifactId: 'Artifact:DirectorProducer.Script.Characters[0].HasTransition',
		revision: args.revision,
		inputsHash: `inputs-${args.revision}`,
		output: args.blob ? { blob: args.blob } : {},
		status: args.status,
		producerJobId: 'Producer:DirectorProducer',
		producerId: 'Producer:DirectorProducer',
		createdAt: new Date().toISOString(),
		lastRevisionBy: 'producer',
	});
}

export async function writeConditionBlob(
	storage: ReturnType<typeof createStorageContext>,
	movieId: string,
	args: {
		hash: string;
		mimeType?: string;
		contents: string;
		legacyFileName?: boolean;
	}
): Promise<void> {
	const prefix = args.hash.slice(0, 2);
	const fileName = args.legacyFileName
		? args.hash
		: formatBlobFileName(args.hash, args.mimeType);
	const blobPath = storage.resolve(movieId, 'blobs', prefix, fileName);
	await storage.storage.write(blobPath, Buffer.from(args.contents, 'utf8'), {
		mimeType: args.mimeType,
	});
}
