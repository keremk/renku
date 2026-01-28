/**
 * Main router for /movies/* endpoints.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { respondNotFound, respondBadRequest } from "../http-utils.js";
import { loadManifest, readTimeline } from "./manifest-loader.js";
import { streamAsset } from "./asset-handler.js";
import { streamBlobFile } from "./blob-handler.js";

/**
 * Handles movie API requests.
 *
 * Routes:
 *   GET /viewer-api/movies/:movieId/manifest
 *   GET /viewer-api/movies/:movieId/timeline
 *   GET /viewer-api/movies/:movieId/assets/:assetId
 *   GET /viewer-api/movies/:movieId/files/:hash
 */
export async function handleMoviesRequest(
  req: IncomingMessage,
  res: ServerResponse,
  buildsRoot: string,
  segments: string[],
): Promise<boolean> {
  // segments = [movieId, action, ...rest]
  if (segments.length < 2) {
    return respondNotFound(res);
  }

  const movieId = decodeURIComponent(segments[0] ?? "");
  const action = segments[1];

  switch (action) {
    case "manifest": {
      const manifest = await loadManifest(buildsRoot, movieId);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(manifest));
      return true;
    }

    case "timeline": {
      const manifest = await loadManifest(buildsRoot, movieId);
      const timeline = await readTimeline(manifest, buildsRoot, movieId);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(timeline));
      return true;
    }

    case "assets": {
      const assetId = decodeURIComponent(segments.slice(2).join("/"));
      if (!assetId) {
        return respondBadRequest(res, "Missing assetId");
      }
      await streamAsset(req, res, buildsRoot, movieId, assetId);
      return true;
    }

    case "files": {
      const hash = segments[2];
      if (!hash) {
        return respondBadRequest(res, "Missing hash");
      }
      await streamBlobFile(req, res, buildsRoot, movieId, hash);
      return true;
    }

    default:
      return respondNotFound(res);
  }
}
