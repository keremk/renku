/**
 * Main router for /blueprints/* endpoints.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { respondNotFound, respondBadRequest, respondMethodNotAllowed } from "../http-utils.js";
import { handleBuildsSubRoute, listBuilds, getBuildManifest } from "../builds/index.js";
import { parseBlueprintToGraph } from "./parse-handler.js";
import { resolveBlueprintName } from "./resolve-handler.js";
import { getProducerModelsFromBlueprint } from "./producer-models.js";
import { parseInputsFile } from "./inputs-handler.js";
import { streamBuildBlob } from "./blob-handler.js";

/**
 * Handles blueprint API requests.
 *
 * Routes:
 *   GET  /blueprints/parse?path=...&catalog=...
 *   GET  /blueprints/inputs?path=...
 *   GET  /blueprints/builds?folder=...
 *   GET  /blueprints/manifest?folder=...&movieId=...
 *   GET  /blueprints/blob?folder=...&movieId=...&hash=...
 *   GET  /blueprints/resolve?name=...
 *   GET  /blueprints/producer-models?path=...&catalog=...
 *   POST /blueprints/builds/create
 *   GET  /blueprints/builds/inputs?folder=...&movieId=...&blueprintPath=...
 *   PUT  /blueprints/builds/inputs
 *   PUT  /blueprints/builds/metadata
 *   POST /blueprints/builds/enable-editing
 */
export async function handleBlueprintRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  segments: string[],
): Promise<boolean> {
  const action = segments[0];
  const subAction = segments[1];

  const catalogRoot = url.searchParams.get("catalog") ?? undefined;

  // Handle builds sub-routes that support POST/PUT
  if (action === "builds" && subAction) {
    return handleBuildsSubRoute(req, res, url, subAction);
  }

  // All other routes require GET
  if (req.method !== "GET") {
    return respondMethodNotAllowed(res);
  }

  switch (action) {
    case "parse": {
      const blueprintPath = url.searchParams.get("path");
      if (!blueprintPath) {
        return respondBadRequest(res, "Missing path parameter");
      }
      const graphData = await parseBlueprintToGraph(blueprintPath, catalogRoot);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(graphData));
      return true;
    }

    case "inputs": {
      const inputsPath = url.searchParams.get("path");
      if (!inputsPath) {
        return respondBadRequest(res, "Missing path parameter");
      }
      const inputData = await parseInputsFile(inputsPath);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(inputData));
      return true;
    }

    case "builds": {
      const folder = url.searchParams.get("folder");
      if (!folder) {
        return respondBadRequest(res, "Missing folder parameter");
      }
      const buildsData = await listBuilds(folder);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(buildsData));
      return true;
    }

    case "manifest": {
      const folder = url.searchParams.get("folder");
      const movieId = url.searchParams.get("movieId");
      if (!folder || !movieId) {
        return respondBadRequest(res, "Missing folder or movieId parameter");
      }
      const manifestData = await getBuildManifest(folder, movieId);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(manifestData));
      return true;
    }

    case "blob": {
      const folder = url.searchParams.get("folder");
      const movieId = url.searchParams.get("movieId");
      const hash = url.searchParams.get("hash");
      if (!folder || !movieId || !hash) {
        return respondBadRequest(res, "Missing folder, movieId, or hash parameter");
      }
      await streamBuildBlob(req, res, folder, movieId, hash);
      return true;
    }

    case "resolve": {
      const name = url.searchParams.get("name");
      if (!name) {
        return respondBadRequest(res, "Missing name parameter");
      }
      try {
        const paths = await resolveBlueprintName(name);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(paths));
        return true;
      } catch (error) {
        res.statusCode = 400;
        const message = error instanceof Error ? error.message : "Failed to resolve blueprint";
        res.end(JSON.stringify({ error: message }));
        return true;
      }
    }

    case "producer-models": {
      const blueprintPath = url.searchParams.get("path");
      if (!blueprintPath) {
        return respondBadRequest(res, "Missing path parameter");
      }
      const producerModels = await getProducerModelsFromBlueprint(blueprintPath, catalogRoot);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(producerModels));
      return true;
    }

    default:
      return respondNotFound(res);
  }
}
