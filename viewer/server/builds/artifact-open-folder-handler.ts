import { access } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import process from 'node:process';
import { resolve } from 'node:path';
import {
  createMovieMetadataService,
  createStorageContext,
  producerFolderNameFromProducerName,
  resolveArtifactsMovieFolderName,
  resolveArtifactsMovieRoot,
} from '@gorenku/core';
import { sendJson } from '../generation/http-utils.js';

export interface OpenArtifactsProducerFolderRequest {
  blueprintFolder: string;
  movieId: string;
  producerName: string;
}

export async function handleOpenArtifactsProducerFolder(
  res: ServerResponse,
  body: OpenArtifactsProducerFolderRequest
): Promise<void> {
  const storage = createStorageContext({
    kind: 'local',
    rootDir: body.blueprintFolder,
    basePath: 'builds',
  });
  const metadataService = createMovieMetadataService(storage);
  const artifactsMovieFolderName = await resolveArtifactsMovieFolderName({
    movieId: body.movieId,
    metadataService,
  });

  const artifactsMovieRoot = resolveArtifactsMovieRoot(
    body.blueprintFolder,
    'builds',
    artifactsMovieFolderName
  );
  const producerFolder = producerFolderNameFromProducerName(body.producerName);
  const targetPath = resolve(artifactsMovieRoot, producerFolder);

  await access(targetPath);
  await openPathInFileManager(targetPath);

  sendJson(res, {
    ok: true,
    path: targetPath,
  });
}

async function openPathInFileManager(targetPath: string): Promise<void> {
  const command =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'explorer'
        : 'xdg-open';

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, [targetPath], {
      stdio: 'ignore',
      detached: false,
    });

    child.on('error', (error) => {
      reject(
        new Error(`Failed to open folder using ${command}: ${error.message}`)
      );
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `File manager command ${command} exited with code ${String(code)}.`
        )
      );
    });
  });
}
