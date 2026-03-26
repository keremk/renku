/**
 * Viewer API main router.
 *
 * This module provides the HTTP API for the viewer application.
 * It routes requests to appropriate handlers in the blueprints and generation modules.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { respondNotFound, respondMethodNotAllowed } from './http-utils.js';
import { handleBlueprintRequest } from './blueprints/index.js';
import {
  handlePlanRequest,
  handleExecuteRequest,
  handleJobsListRequest,
  handleJobStatusRequest,
  handleStreamRequest,
  handleCancelRequest,
  sendMethodNotAllowed,
} from './generation/index.js';
import { handleOnboardingRequest } from './onboarding/index.js';
import { handleSettingsRequest } from './settings/index.js';

// Re-export shared types for backward compatibility
export type {
  BlueprintGraphData,
  BlueprintGraphNode,
  BlueprintGraphEdge,
  BlueprintInputDef,
  BlueprintOutputDef,
  ConditionDef,
} from './types.js';

export type ViewerApiHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<boolean>;

export interface ViewerApiOptions {
  catalogPath?: string;
}

interface ViewerHealthResponse {
  ok: true;
  app: 'renku-viewer';
  launchRoute: '/blueprints';
}

const VIEWER_HEALTH_RESPONSE: ViewerHealthResponse = {
  ok: true,
  app: 'renku-viewer',
  launchRoute: '/blueprints',
};

/**
 * Creates the main viewer API handler.
 */
export function createViewerApiHandler(
  options: ViewerApiOptions = {}
): ViewerApiHandler {
  return async (req, res) => {
    if (!req.url) {
      return false;
    }

    try {
      const url = new URL(req.url, 'http://viewer.local');
      const segments = url.pathname
        .replace(/^\/viewer-api\/?/, '')
        .split('/')
        .filter(Boolean);

      if (segments.length === 0) {
        return respondNotFound(res);
      }

      switch (segments[0]) {
        case 'health':
          return handleHealthCheck(req, res);

        case 'blueprints':
          return await handleBlueprintRequest(req, res, url, segments.slice(1));

        case 'generate':
          return await handleGenerateRequest(req, res, segments.slice(1));

        case 'onboarding':
          return await handleOnboardingRequest(
            req,
            res,
            url,
            segments.slice(1),
            options.catalogPath
          );

        case 'settings':
          return await handleSettingsRequest(
            req,
            res,
            segments.slice(1),
            options.catalogPath
          );

        default:
          return respondNotFound(res);
      }
    } catch (error) {
      console.error('[viewer-api]', error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end('Internal Server Error');
      } else {
        res.end();
      }
      return true;
    }
  };
}

/**
 * Creates a Vite middleware adapter for the viewer API.
 */
export function createViewerApiMiddleware(
  options: ViewerApiOptions = {}
): Connect.NextHandleFunction {
  const handler = createViewerApiHandler(options);
  return async (req, res, next) => {
    if (!req || !req.url || !req.url.startsWith('/viewer-api')) {
      next();
      return;
    }
    const handled = await handler(req, res);
    if (!handled) {
      next();
    }
  };
}

/**
 * Handles health check requests.
 */
function handleHealthCheck(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET') {
    return respondMethodNotAllowed(res);
  }
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(VIEWER_HEALTH_RESPONSE));
  return true;
}

/**
 * Routes generation API requests to appropriate handlers.
 *
 * Routes:
 *   POST /viewer-api/generate/plan
 *   POST /viewer-api/generate/execute
 *   GET  /viewer-api/generate/jobs
 *   GET  /viewer-api/generate/jobs/:jobId
 *   GET  /viewer-api/generate/jobs/:jobId/stream
 *   POST /viewer-api/generate/jobs/:jobId/cancel
 */
async function handleGenerateRequest(
  req: IncomingMessage,
  res: ServerResponse,
  segments: string[]
): Promise<boolean> {
  const action = segments[0];

  switch (action) {
    case 'plan': {
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res);
        return true;
      }
      return handlePlanRequest(req, res);
    }

    case 'execute': {
      if (req.method !== 'POST') {
        sendMethodNotAllowed(res);
        return true;
      }
      return handleExecuteRequest(req, res);
    }

    case 'jobs': {
      // /viewer-api/generate/jobs
      if (segments.length === 1) {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res);
          return true;
        }
        return handleJobsListRequest(req, res);
      }

      // /viewer-api/generate/jobs/:jobId
      const jobId = decodeURIComponent(segments[1]);

      // /viewer-api/generate/jobs/:jobId/stream
      if (segments.length === 3 && segments[2] === 'stream') {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res);
          return true;
        }
        return handleStreamRequest(req, res, jobId);
      }

      // /viewer-api/generate/jobs/:jobId/cancel
      if (segments.length === 3 && segments[2] === 'cancel') {
        if (req.method !== 'POST') {
          sendMethodNotAllowed(res);
          return true;
        }
        return handleCancelRequest(req, res, jobId);
      }

      // /viewer-api/generate/jobs/:jobId
      if (segments.length === 2) {
        if (req.method !== 'GET') {
          sendMethodNotAllowed(res);
          return true;
        }
        return handleJobStatusRequest(req, res, jobId);
      }

      return respondNotFound(res);
    }

    default:
      return respondNotFound(res);
  }
}
