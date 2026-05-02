import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readJsonBody, respondMethodNotAllowed, sendJson } from '../http-utils.js';
import {
  loadMovieProject,
  MovieProjectValidationError,
} from './movie-loader.js';
import {
  getCurrentMovieProject,
  setCurrentMovieProject,
} from './project-store.js';
import {
  listMovieProjects,
  resolveCoverImagePath,
} from './library.js';

interface OpenProjectRequest {
  projectFolder?: unknown;
}

export async function handleProjectsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  segments: string[]
): Promise<boolean> {
  const action = segments[0];

  switch (action) {
    case 'open':
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      return await handleOpenProject(req, res);

    case 'list':
      if (req.method !== 'GET') {
        return respondMethodNotAllowed(res);
      }
      return await handleListProjects(res);

    case 'cover':
      if (req.method !== 'GET') {
        return respondMethodNotAllowed(res);
      }
      return await handleCoverImage(res, url);

    case 'current':
      if (req.method !== 'GET') {
        return respondMethodNotAllowed(res);
      }
      return sendJson(res, 200, { project: getCurrentMovieProject() });

    default:
      return sendJson(res, 404, {
        error: {
          code: 'M000',
          message: 'Project route not found.',
        },
      });
  }
}

async function handleListProjects(res: ServerResponse): Promise<boolean> {
  try {
    const library = await listMovieProjects();
    return sendJson(res, 200, { library });
  } catch (error) {
    return sendJson(res, 500, {
      error: {
        code: 'M016',
        message:
          error instanceof Error ? error.message : 'Failed to list movie projects.',
      },
    });
  }
}

async function handleCoverImage(
  res: ServerResponse,
  url: URL
): Promise<boolean> {
  const projectFolder = url.searchParams.get('projectFolder');
  const filename = url.searchParams.get('file');
  if (!projectFolder || !filename) {
    return sendJson(res, 400, {
      error: {
        code: 'M010',
        message: 'projectFolder and file are required.',
      },
    });
  }

  try {
    const coverPath = await resolveCoverImagePath(projectFolder, filename);
    res.statusCode = 200;
    res.setHeader('Content-Type', getImageContentType(filename));
    res.setHeader('Cache-Control', 'no-cache');
    createReadStream(coverPath).pipe(res);
    return true;
  } catch (error) {
    if (error instanceof MovieProjectValidationError) {
      return sendJson(res, 404, {
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }
    return sendJson(res, 500, {
      error: {
        code: 'M016',
        message:
          error instanceof Error ? error.message : 'Failed to load cover image.',
      },
    });
  }
}

function getImageContentType(filename: string): string {
  const extension = filename.split('.').at(-1);
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

async function handleOpenProject(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  try {
    const body = await readJsonBody<OpenProjectRequest>(req);
    if (typeof body.projectFolder !== 'string') {
      return sendJson(res, 400, {
        error: {
          code: 'M010',
          message: 'projectFolder must be a string.',
        },
      });
    }

    const project = loadMovieProject(body.projectFolder);
    setCurrentMovieProject(project);
    return sendJson(res, 200, { project });
  } catch (error) {
    if (error instanceof MovieProjectValidationError) {
      return sendJson(res, 400, {
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }

    return sendJson(res, 400, {
      error: {
        code: 'M011',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
