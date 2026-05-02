import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { respondMethodNotAllowed, respondNotFound, sendJson } from './http-utils.js';
import { handleProjectsRequest } from './projects/handler.js';

export type MovieStudioApiHandler = (
  req: IncomingMessage,
  res: ServerResponse
) => Promise<boolean>;

export function createMovieStudioApiHandler(): MovieStudioApiHandler {
  return async (req, res) => {
    if (!req.url) {
      return false;
    }

    try {
      const url = new URL(req.url, 'http://movie-studio.local');
      const segments = url.pathname
        .replace(/^\/movie-studio-api\/?/, '')
        .split('/')
        .filter(Boolean);

      if (segments.length === 0) {
        return respondNotFound(res);
      }

      switch (segments[0]) {
        case 'health':
          return handleHealthCheck(req, res);

        case 'projects':
          return await handleProjectsRequest(req, res, url, segments.slice(1));

        default:
          return respondNotFound(res);
      }
    } catch (error) {
      console.error('[movie-studio-api]', error);
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

export function createMovieStudioApiMiddleware(): Connect.NextHandleFunction {
  const handler = createMovieStudioApiHandler();
  return async (req, res, next) => {
    if (!req || !req.url || !req.url.startsWith('/movie-studio-api')) {
      next();
      return;
    }
    const handled = await handler(req, res);
    if (!handled) {
      next();
    }
  };
}

function handleHealthCheck(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method !== 'GET') {
    return respondMethodNotAllowed(res);
  }
  return sendJson(res, 200, { ok: true });
}
