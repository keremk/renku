import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  parseJsonBody,
  sendError,
  sendJson,
} from '../generation/http-utils.js';
import { respondMethodNotAllowed, respondNotFound } from '../http-utils.js';
import {
  readViewerSettingsSnapshot,
  updateViewerApiTokens,
  updateViewerStorageRoot,
} from './service.js';
import type { ProviderTokenPayload } from './api-tokens.js';

interface UpdateStorageRootBody {
  storageRoot?: string;
  migrateContent?: boolean;
}

async function handleReadSettings(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  try {
    const settings = await readViewerSettingsSnapshot();
    sendJson(res, settings);
    return true;
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to read settings'
    );
    return true;
  }
}

async function handleUpdateStorageRoot(
  req: IncomingMessage,
  res: ServerResponse,
  catalogPath: string | undefined
): Promise<boolean> {
  let body: UpdateStorageRootBody;
  try {
    body = await parseJsonBody<UpdateStorageRootBody>(req);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return true;
  }

  if (!body.storageRoot || body.storageRoot.trim() === '') {
    sendError(res, 400, 'storageRoot is required');
    return true;
  }

  if (typeof body.migrateContent !== 'boolean') {
    sendError(res, 400, 'migrateContent must be a boolean');
    return true;
  }

  if (!catalogPath) {
    sendError(
      res,
      500,
      'Server has no catalog path configured. Restart using "renku launch".'
    );
    return true;
  }

  try {
    const result = await updateViewerStorageRoot({
      storageRoot: body.storageRoot,
      migrateContent: body.migrateContent,
      catalogPath,
    });

    sendJson(res, {
      ok: true,
      storageRoot: result.storageRoot,
      catalogRoot: result.catalogRoot,
      mode: result.mode,
    });
    return true;
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to update storage root'
    );
    return true;
  }
}

async function handleUpdateApiTokens(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  let body: ProviderTokenPayload;
  try {
    body = await parseJsonBody<ProviderTokenPayload>(req);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return true;
  }

  try {
    await updateViewerApiTokens(body);
    sendJson(res, { ok: true });
    return true;
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to update API tokens'
    );
    return true;
  }
}

export async function handleSettingsEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  action: string,
  catalogPath: string | undefined
): Promise<boolean> {
  switch (action) {
    case '': {
      if (req.method !== 'GET') {
        return respondMethodNotAllowed(res);
      }
      return handleReadSettings(req, res);
    }

    case 'storage-root': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      return handleUpdateStorageRoot(req, res, catalogPath);
    }

    case 'api-tokens': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      return handleUpdateApiTokens(req, res);
    }

    default:
      return respondNotFound(res);
  }
}
