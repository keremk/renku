/**
 * Main router for /blueprints/builds/* endpoints.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRenkuError, RuntimeErrorCode } from '@gorenku/core';
import { parseJsonBody } from '../http-utils.js';
import {
  respondNotFound,
  respondBadRequest,
  respondMethodNotAllowed,
} from '../http-utils.js';
import { createBuild } from './create-handler.js';
import { deleteBuild } from './delete-handler.js';
import { getBuildInputs, saveBuildInputs } from './inputs-handler.js';
import { updateBuildMetadata } from './metadata-handler.js';
import { enableBuildEditing } from './enable-editing-handler.js';
import { handleFileUpload } from './upload-handler.js';
import type {
  CreateBuildRequest,
  DeleteBuildRequest,
  BuildInputsRequest,
  BuildMetadataRequest,
  EnableEditingRequest,
  MediaInputType,
} from './types.js';
import {
  handleArtifactFileEdit,
  handleArtifactTextEdit,
  handleArtifactRestore,
  type TextArtifactEditRequest,
  type ArtifactRestoreRequest,
} from './artifact-edit-handler.js';
import {
  handleArtifactRecheck,
  type ArtifactRecheckRequest,
} from './artifact-recheck-handler.js';
import {
  getProducerPrompts,
  saveProducerPrompts,
  restoreProducerPrompts,
  type SavePromptsRequest,
  type RestorePromptsRequest,
} from './prompts-handler.js';

const INVALID_MOVIE_ID_ERROR_CODE = 'R131';
const MOVIE_ID_PATTERN = /^movie-[a-z0-9][a-z0-9-]*$/;

/**
 * Handles builds sub-routes: create, inputs (GET/PUT), metadata (PUT), enable-editing (POST)
 *
 * Routes:
 *   POST /blueprints/builds/create
 *   POST /blueprints/builds/delete
 *   GET  /blueprints/builds/inputs?folder=...&movieId=...&blueprintPath=...
 *   PUT  /blueprints/builds/inputs
 *   PUT  /blueprints/builds/metadata
 *   POST /blueprints/builds/enable-editing
 *   POST /blueprints/builds/upload?folder=...&movieId=...&inputType=...
 *   POST /blueprints/builds/artifacts/edit?folder=...&movieId=...&artifactId=... (multipart for media)
 *   POST /blueprints/builds/artifacts/edit-text (JSON body for text)
 *   POST /blueprints/builds/artifacts/restore (JSON body)
 *   GET  /blueprints/builds/prompts?folder=...&movieId=...&blueprintPath=...&producerId=...
 *   PUT  /blueprints/builds/prompts (JSON body)
 *   POST /blueprints/builds/prompts/restore (JSON body)
 */
export async function handleBuildsSubRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  subAction: string,
  segments: string[] = []
): Promise<boolean> {
  switch (subAction) {
    case 'create': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      const body = await parseJsonBody<CreateBuildRequest>(req);
      if (!body.blueprintFolder) {
        return respondBadRequest(res, 'Missing blueprintFolder');
      }
      const result = await createBuild(body.blueprintFolder, body.displayName);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
      return true;
    }

    case 'delete': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      const body = await parseJsonBody<DeleteBuildRequest>(req);
      if (!body.blueprintFolder || !body.movieId) {
        return respondBadRequest(res, 'Missing blueprintFolder or movieId');
      }
      if (!MOVIE_ID_PATTERN.test(body.movieId)) {
        return respondBadRequest(
          res,
          `Invalid movieId "${body.movieId}". Expected format: movie-<lowercase letters, numbers, hyphens>.`
        );
      }
      try {
        await deleteBuild(body.blueprintFolder, body.movieId);
      } catch (error) {
        if (isRenkuError(error)) {
          if (error.code === RuntimeErrorCode.MOVIE_NOT_FOUND) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message, code: error.code }));
            return true;
          }
          if (error.code === INVALID_MOVIE_ID_ERROR_CODE) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: error.message, code: error.code }));
            return true;
          }
        }
        throw error;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true }));
      return true;
    }

    case 'inputs': {
      if (req.method === 'GET') {
        const folder = url.searchParams.get('folder');
        const movieId = url.searchParams.get('movieId');
        const blueprintPath = url.searchParams.get('blueprintPath');
        const catalogRoot = url.searchParams.get('catalog') ?? undefined;
        if (!folder || !movieId || !blueprintPath) {
          return respondBadRequest(
            res,
            'Missing folder, movieId, or blueprintPath parameter'
          );
        }
        const result = await getBuildInputs(
          folder,
          movieId,
          blueprintPath,
          catalogRoot
        );
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
        return true;
      }
      if (req.method === 'PUT') {
        const body = await parseJsonBody<BuildInputsRequest>(req);
        if (
          !body.blueprintFolder ||
          !body.movieId ||
          !body.inputs ||
          !body.models
        ) {
          return respondBadRequest(
            res,
            'Missing blueprintFolder, movieId, inputs, or models'
          );
        }
        await saveBuildInputs(
          body.blueprintFolder,
          body.movieId,
          body.inputs,
          body.models
        );
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return true;
      }
      return respondMethodNotAllowed(res);
    }

    case 'metadata': {
      if (req.method !== 'PUT') {
        return respondMethodNotAllowed(res);
      }
      const body = await parseJsonBody<BuildMetadataRequest>(req);
      if (!body.blueprintFolder || !body.movieId || !body.displayName) {
        return respondBadRequest(
          res,
          'Missing blueprintFolder, movieId, or displayName'
        );
      }
      await updateBuildMetadata(
        body.blueprintFolder,
        body.movieId,
        body.displayName
      );
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true }));
      return true;
    }

    case 'enable-editing': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      const body = await parseJsonBody<EnableEditingRequest>(req);
      if (!body.blueprintFolder || !body.movieId) {
        return respondBadRequest(res, 'Missing blueprintFolder or movieId');
      }
      await enableBuildEditing(body.blueprintFolder, body.movieId);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true }));
      return true;
    }

    case 'upload': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      const folder = url.searchParams.get('folder');
      const movieId = url.searchParams.get('movieId');
      const inputType = url.searchParams.get(
        'inputType'
      ) as MediaInputType | null;
      if (!folder || !movieId) {
        return respondBadRequest(res, 'Missing folder or movieId parameter');
      }
      await handleFileUpload(req, res, folder, movieId, inputType ?? undefined);
      return true;
    }

    case 'artifacts': {
      // Handle artifacts sub-routes: edit, edit-text, restore
      // segments[0] = "artifacts", segments[1] = "edit"/"edit-text"/"restore"
      const artifactsSubAction = segments[1];
      if (artifactsSubAction === 'edit' && req.method === 'POST') {
        // Multipart file upload for media artifacts
        const folder = url.searchParams.get('folder');
        const movieId = url.searchParams.get('movieId');
        const artifactId = url.searchParams.get('artifactId');
        if (!folder || !movieId || !artifactId) {
          return respondBadRequest(
            res,
            'Missing folder, movieId, or artifactId parameter'
          );
        }
        await handleArtifactFileEdit(req, res, folder, movieId, artifactId);
        return true;
      }
      if (artifactsSubAction === 'edit-text' && req.method === 'POST') {
        // JSON body for text artifact edit
        const body = await parseJsonBody<TextArtifactEditRequest>(req);
        if (!body.blueprintFolder || !body.movieId || !body.artifactId) {
          return respondBadRequest(
            res,
            'Missing blueprintFolder, movieId, or artifactId'
          );
        }
        await handleArtifactTextEdit(req, res, body);
        return true;
      }
      if (artifactsSubAction === 'restore' && req.method === 'POST') {
        // JSON body for restore
        const body = await parseJsonBody<ArtifactRestoreRequest>(req);
        if (!body.blueprintFolder || !body.movieId || !body.artifactId) {
          return respondBadRequest(
            res,
            'Missing blueprintFolder, movieId, or artifactId'
          );
        }
        await handleArtifactRestore(res, body);
        return true;
      }
      if (artifactsSubAction === 'recheck' && req.method === 'POST') {
        // JSON body for recheck status
        const body = await parseJsonBody<ArtifactRecheckRequest>(req);
        if (!body.blueprintFolder || !body.movieId || !body.artifactId) {
          return respondBadRequest(
            res,
            'Missing blueprintFolder, movieId, or artifactId'
          );
        }
        await handleArtifactRecheck(res, body);
        return true;
      }
      return respondNotFound(res);
    }

    case 'prompts': {
      // Handle prompts sub-routes: get, save, restore
      // segments[0] = "prompts", segments[1] = undefined or "restore"
      const promptsSubAction = segments[1];

      if (promptsSubAction === 'restore' && req.method === 'POST') {
        // Restore prompts to template
        const body = await parseJsonBody<RestorePromptsRequest>(req);
        if (!body.blueprintFolder || !body.movieId || !body.producerId) {
          return respondBadRequest(
            res,
            'Missing blueprintFolder, movieId, or producerId'
          );
        }
        await restoreProducerPrompts(
          body.blueprintFolder,
          body.movieId,
          body.producerId
        );
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return true;
      }

      if (req.method === 'GET') {
        const folder = url.searchParams.get('folder');
        const movieId = url.searchParams.get('movieId');
        const blueprintPath = url.searchParams.get('blueprintPath');
        const producerId = url.searchParams.get('producerId');
        const catalogRoot = url.searchParams.get('catalog') ?? undefined;
        if (!folder || !movieId || !blueprintPath || !producerId) {
          return respondBadRequest(
            res,
            'Missing folder, movieId, blueprintPath, or producerId parameter'
          );
        }
        try {
          const result = await getProducerPrompts(
            folder,
            movieId,
            blueprintPath,
            producerId,
            catalogRoot
          );
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
          return true;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : 'Failed to get prompts';
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: message }));
          return true;
        }
      }

      if (req.method === 'PUT') {
        const body = await parseJsonBody<SavePromptsRequest>(req);
        if (
          !body.blueprintFolder ||
          !body.movieId ||
          !body.producerId ||
          !body.prompts
        ) {
          return respondBadRequest(
            res,
            'Missing blueprintFolder, movieId, producerId, or prompts'
          );
        }
        await saveProducerPrompts(
          body.blueprintFolder,
          body.movieId,
          body.producerId,
          body.prompts
        );
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true }));
        return true;
      }

      return respondMethodNotAllowed(res);
    }

    default:
      return respondNotFound(res);
  }
}
