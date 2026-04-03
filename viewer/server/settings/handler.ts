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
  updateViewerArtifactsSettings,
  updateViewerConcurrency,
  updateViewerLlmInvocationSettings,
  updateViewerStorageRoot,
} from './service.js';
import type {
  ArtifactMaterializationMode,
  ProviderTokenPayload,
} from '@gorenku/core';

const NON_EMPTY_TARGET_CONFIRMATION_CODE =
  'WORKSPACE_SWITCH_CONFIRMATION_REQUIRED';

interface UpdateStorageRootBody {
  storageRoot?: string;
  migrateContent?: boolean;
  allowNonEmptyTarget?: boolean;
}

interface UpdateArtifactsBody {
  enabled?: boolean;
  mode?: ArtifactMaterializationMode;
}

interface UpdateConcurrencyBody {
  concurrency?: number;
}

interface UpdateLlmInvocationBody {
  requestTimeoutMs?: number | null;
  maxRetries?: number | null;
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

  if (
    body.allowNonEmptyTarget !== undefined &&
    typeof body.allowNonEmptyTarget !== 'boolean'
  ) {
    sendError(res, 400, 'allowNonEmptyTarget must be a boolean');
    return true;
  }

  try {
    const result = await updateViewerStorageRoot({
      storageRoot: body.storageRoot,
      migrateContent: body.migrateContent,
      allowNonEmptyTarget: body.allowNonEmptyTarget === true,
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
    if (getErrorCode(error) === NON_EMPTY_TARGET_CONFIRMATION_CODE) {
      sendError(
        res,
        409,
        error instanceof Error
          ? error.message
          : 'Storage root change requires explicit confirmation',
        NON_EMPTY_TARGET_CONFIRMATION_CODE
      );
      return true;
    }

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

async function handleUpdateArtifacts(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  let body: UpdateArtifactsBody;
  try {
    body = await parseJsonBody<UpdateArtifactsBody>(req);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return true;
  }

  if (typeof body.enabled !== 'boolean') {
    sendError(res, 400, 'enabled must be a boolean');
    return true;
  }

  if (body.mode !== 'copy' && body.mode !== 'symlink') {
    sendError(res, 400, 'mode must be either "copy" or "symlink"');
    return true;
  }

  try {
    const artifacts = await updateViewerArtifactsSettings({
      enabled: body.enabled,
      mode: body.mode,
    });
    sendJson(res, { ok: true, artifacts });
    return true;
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error
        ? error.message
        : 'Failed to update artifact settings'
    );
    return true;
  }
}

async function handleUpdateConcurrency(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  let body: UpdateConcurrencyBody;
  try {
    body = await parseJsonBody<UpdateConcurrencyBody>(req);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return true;
  }

  const concurrency = body.concurrency;

  if (concurrency === undefined || !Number.isInteger(concurrency)) {
    sendError(res, 400, 'concurrency must be an integer');
    return true;
  }

  try {
    const savedConcurrency = await updateViewerConcurrency({
      concurrency,
    });
    sendJson(res, { ok: true, concurrency: savedConcurrency });
    return true;
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to update concurrency'
    );
    return true;
  }
}

async function handleUpdateLlmInvocation(
  req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  let body: UpdateLlmInvocationBody;
  try {
    body = await parseJsonBody<UpdateLlmInvocationBody>(req);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return true;
  }

  if (body.requestTimeoutMs === undefined) {
    sendError(res, 400, 'requestTimeoutMs is required (integer or null)');
    return true;
  }

  if (body.maxRetries === undefined) {
    sendError(res, 400, 'maxRetries is required (integer or null)');
    return true;
  }

  if (
    body.requestTimeoutMs !== null &&
    (!Number.isInteger(body.requestTimeoutMs) || body.requestTimeoutMs <= 0)
  ) {
    sendError(res, 400, 'requestTimeoutMs must be a positive integer or null');
    return true;
  }

  if (
    body.maxRetries !== null &&
    (!Number.isInteger(body.maxRetries) || body.maxRetries < 0)
  ) {
    sendError(res, 400, 'maxRetries must be a non-negative integer or null');
    return true;
  }

  try {
    const llmInvocation = await updateViewerLlmInvocationSettings({
      requestTimeoutMs: body.requestTimeoutMs,
      maxRetries: body.maxRetries,
    });
    sendJson(res, { ok: true, llmInvocation });
    return true;
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error
        ? error.message
        : 'Failed to update LLM invocation settings'
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

    case 'artifacts': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      return handleUpdateArtifacts(req, res);
    }

    case 'concurrency': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      return handleUpdateConcurrency(req, res);
    }

    case 'llm-invocation': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      return handleUpdateLlmInvocation(req, res);
    }

    default:
      return respondNotFound(res);
  }
}

function getErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  const code = (error as Error & { code?: unknown }).code;
  if (typeof code !== 'string') {
    return undefined;
  }

  return code;
}
