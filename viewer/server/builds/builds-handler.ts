/**
 * Main router for /blueprints/builds/* endpoints.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { parseJsonBody } from "../http-utils.js";
import { respondNotFound, respondBadRequest, respondMethodNotAllowed } from "../http-utils.js";
import { createBuild } from "./create-handler.js";
import { getBuildInputs, saveBuildInputs } from "./inputs-handler.js";
import { updateBuildMetadata } from "./metadata-handler.js";
import { enableBuildEditing } from "./enable-editing-handler.js";
import { handleFileUpload } from "./upload-handler.js";
import type {
  CreateBuildRequest,
  BuildInputsRequest,
  BuildMetadataRequest,
  EnableEditingRequest,
  MediaInputType,
} from "./types.js";
import {
  handleArtifactFileEdit,
  handleArtifactTextEdit,
  handleArtifactRestore,
  type TextArtifactEditRequest,
  type ArtifactRestoreRequest,
} from "./artifact-edit-handler.js";

/**
 * Handles builds sub-routes: create, inputs (GET/PUT), metadata (PUT), enable-editing (POST)
 *
 * Routes:
 *   POST /blueprints/builds/create
 *   GET  /blueprints/builds/inputs?folder=...&movieId=...&blueprintPath=...
 *   PUT  /blueprints/builds/inputs
 *   PUT  /blueprints/builds/metadata
 *   POST /blueprints/builds/enable-editing
 *   POST /blueprints/builds/upload?folder=...&movieId=...&inputType=...
 *   POST /blueprints/builds/artifacts/edit?folder=...&movieId=...&artifactId=... (multipart for media)
 *   POST /blueprints/builds/artifacts/edit-text (JSON body for text)
 *   POST /blueprints/builds/artifacts/restore (JSON body)
 */
export async function handleBuildsSubRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  subAction: string,
  segments: string[] = [],
): Promise<boolean> {
  switch (subAction) {
    case "create": {
      if (req.method !== "POST") {
        return respondMethodNotAllowed(res);
      }
      const body = await parseJsonBody<CreateBuildRequest>(req);
      if (!body.blueprintFolder) {
        return respondBadRequest(res, "Missing blueprintFolder");
      }
      const result = await createBuild(body.blueprintFolder, body.displayName);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
      return true;
    }

    case "inputs": {
      if (req.method === "GET") {
        const folder = url.searchParams.get("folder");
        const movieId = url.searchParams.get("movieId");
        const blueprintPath = url.searchParams.get("blueprintPath");
        const catalogRoot = url.searchParams.get("catalog") ?? undefined;
        if (!folder || !movieId || !blueprintPath) {
          return respondBadRequest(res, "Missing folder, movieId, or blueprintPath parameter");
        }
        const result = await getBuildInputs(folder, movieId, blueprintPath, catalogRoot);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(result));
        return true;
      }
      if (req.method === "PUT") {
        const body = await parseJsonBody<BuildInputsRequest>(req);
        if (!body.blueprintFolder || !body.movieId || !body.inputs || !body.models) {
          return respondBadRequest(res, "Missing blueprintFolder, movieId, inputs, or models");
        }
        await saveBuildInputs(body.blueprintFolder, body.movieId, body.inputs, body.models);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ success: true }));
        return true;
      }
      return respondMethodNotAllowed(res);
    }

    case "metadata": {
      if (req.method !== "PUT") {
        return respondMethodNotAllowed(res);
      }
      const body = await parseJsonBody<BuildMetadataRequest>(req);
      if (!body.blueprintFolder || !body.movieId || !body.displayName) {
        return respondBadRequest(res, "Missing blueprintFolder, movieId, or displayName");
      }
      await updateBuildMetadata(body.blueprintFolder, body.movieId, body.displayName);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true }));
      return true;
    }

    case "enable-editing": {
      if (req.method !== "POST") {
        return respondMethodNotAllowed(res);
      }
      const body = await parseJsonBody<EnableEditingRequest>(req);
      if (!body.blueprintFolder || !body.movieId) {
        return respondBadRequest(res, "Missing blueprintFolder or movieId");
      }
      await enableBuildEditing(body.blueprintFolder, body.movieId);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ success: true }));
      return true;
    }

    case "upload": {
      if (req.method !== "POST") {
        return respondMethodNotAllowed(res);
      }
      const folder = url.searchParams.get("folder");
      const movieId = url.searchParams.get("movieId");
      const inputType = url.searchParams.get("inputType") as MediaInputType | null;
      if (!folder || !movieId) {
        return respondBadRequest(res, "Missing folder or movieId parameter");
      }
      await handleFileUpload(req, res, folder, movieId, inputType ?? undefined);
      return true;
    }

    case "artifacts": {
      // Handle artifacts sub-routes: edit, edit-text, restore
      // segments[0] = "artifacts", segments[1] = "edit"/"edit-text"/"restore"
      const artifactsSubAction = segments[1];
      if (artifactsSubAction === "edit" && req.method === "POST") {
        // Multipart file upload for media artifacts
        const folder = url.searchParams.get("folder");
        const movieId = url.searchParams.get("movieId");
        const artifactId = url.searchParams.get("artifactId");
        if (!folder || !movieId || !artifactId) {
          return respondBadRequest(res, "Missing folder, movieId, or artifactId parameter");
        }
        await handleArtifactFileEdit(req, res, folder, movieId, artifactId);
        return true;
      }
      if (artifactsSubAction === "edit-text" && req.method === "POST") {
        // JSON body for text artifact edit
        const body = await parseJsonBody<TextArtifactEditRequest>(req);
        if (!body.blueprintFolder || !body.movieId || !body.artifactId) {
          return respondBadRequest(res, "Missing blueprintFolder, movieId, or artifactId");
        }
        await handleArtifactTextEdit(req, res, body);
        return true;
      }
      if (artifactsSubAction === "restore" && req.method === "POST") {
        // JSON body for restore
        const body = await parseJsonBody<ArtifactRestoreRequest>(req);
        if (!body.blueprintFolder || !body.movieId || !body.artifactId) {
          return respondBadRequest(res, "Missing blueprintFolder, movieId, or artifactId");
        }
        await handleArtifactRestore(res, body);
        return true;
      }
      return respondNotFound(res);
    }

    default:
      return respondNotFound(res);
  }
}
