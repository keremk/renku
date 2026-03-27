/**
 * Onboarding API handler.
 *
 * Provides endpoints for the first-time setup flow:
 *   GET  /viewer-api/onboarding/status        - Check if workspace is initialized
 *   GET  /viewer-api/onboarding/browse-folder-support - Check native picker availability
 *   POST /viewer-api/onboarding/browse-folder - Open native folder picker
 *   POST /viewer-api/onboarding/setup         - Initialize workspace + write API keys
 *   POST /viewer-api/onboarding/catalog-sync  - Sync workspace catalog from bundled catalog
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  isWorkspaceInitialized,
  initWorkspace,
  persistProviderTokenPayload,
  readCliConfig,
  updateWorkspaceCatalog,
  type ProviderTokenPayload,
} from '@gorenku/core';
import {
  parseJsonBody,
  sendJson,
  sendError,
} from '../generation/http-utils.js';
import { respondNotFound, respondMethodNotAllowed } from '../http-utils.js';
// ---------------------------------------------------------------------------
// GET /viewer-api/onboarding/status
// ---------------------------------------------------------------------------

async function handleStatus(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const initialized = await isWorkspaceInitialized();
  sendJson(res, { initialized });
  return true;
}

// ---------------------------------------------------------------------------
// POST /viewer-api/onboarding/browse-folder
// ---------------------------------------------------------------------------

async function handleBrowseFolder(
  _req: IncomingMessage,
  res: ServerResponse,
  pickerOptions: OnboardingPickerOptions
): Promise<boolean> {
  const pickerResult = await openNativeFolderPicker(pickerOptions);
  if (pickerResult.status === 'selected') {
    sendJson(res, { path: pickerResult.path });
    return true;
  }

  if (pickerResult.status === 'cancelled') {
    sendJson(res, { path: null });
    return true;
  }

  sendError(res, 500, pickerResult.reason);
  return true;
}

async function handleBrowseFolderSupport(
  _req: IncomingMessage,
  res: ServerResponse,
  pickerOptions: OnboardingPickerOptions
): Promise<boolean> {
  const support = getFolderPickerSupport(pickerOptions);
  sendJson(res, support);
  return true;
}

export interface OnboardingPickerOptions {
  isDesktopRuntime?: boolean;
  openDesktopFolderPicker?: () => Promise<string | null>;
}

type FolderPickerResult =
  | { status: 'selected'; path: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

interface FolderPickerSupport {
  supported: boolean;
  reason?: string;
}

const DESKTOP_PICKER_NOT_CONFIGURED_REASON =
  'Desktop folder picker is not configured.';
const WSL_NON_DESKTOP_REASON =
  'Native folder picker is unavailable in WSL outside Renku Desktop. Enter the path manually.';
const LINUX_NON_DESKTOP_REASON =
  'Native folder picker is available on Linux only in Renku Desktop. Enter the path manually.';
const WINDOWS_NON_DESKTOP_REASON =
  'Native folder picker is available on Windows only in Renku Desktop. Enter the path manually.';
const NON_DESKTOP_UNSUPPORTED_REASON =
  'Native folder picker is available outside Renku Desktop only on macOS. Enter the path manually.';

interface FolderPickerContext {
  platform: NodeJS.Platform;
  isDesktopRuntime: boolean;
  isWsl: boolean;
}

type FolderPickerMode = 'desktop' | 'macos-script' | 'unsupported';

interface FolderPickerStrategy {
  mode: FolderPickerMode;
  reason?: string;
}

function resolveFolderPickerStrategy(
  context: FolderPickerContext
): FolderPickerStrategy {
  if (context.isDesktopRuntime) {
    return { mode: 'desktop' };
  }

  if (context.platform === 'darwin') {
    return { mode: 'macos-script' };
  }

  if (context.platform === 'linux' && context.isWsl) {
    return {
      mode: 'unsupported',
      reason: WSL_NON_DESKTOP_REASON,
    };
  }

  if (context.platform === 'linux') {
    return {
      mode: 'unsupported',
      reason: LINUX_NON_DESKTOP_REASON,
    };
  }

  if (context.platform === 'win32') {
    return {
      mode: 'unsupported',
      reason: WINDOWS_NON_DESKTOP_REASON,
    };
  }

  return {
    mode: 'unsupported',
    reason: NON_DESKTOP_UNSUPPORTED_REASON,
  };
}

function getFolderPickerContext(
  pickerOptions: OnboardingPickerOptions
): FolderPickerContext {
  return {
    platform: process.platform,
    isDesktopRuntime: Boolean(pickerOptions.isDesktopRuntime),
    isWsl: isWslEnvironment(),
  };
}

async function openNativeFolderPicker(
  pickerOptions: OnboardingPickerOptions
): Promise<FolderPickerResult> {
  const strategy = resolveFolderPickerStrategy(
    getFolderPickerContext(pickerOptions)
  );

  if (strategy.mode === 'desktop') {
    if (!pickerOptions.openDesktopFolderPicker) {
      return {
        status: 'unavailable',
        reason: DESKTOP_PICKER_NOT_CONFIGURED_REASON,
      };
    }

    try {
      const selectedPath = await pickerOptions.openDesktopFolderPicker();
      if (!selectedPath || selectedPath.trim() === '') {
        return { status: 'cancelled' };
      }

      return {
        status: 'selected',
        path: selectedPath,
      };
    } catch (error) {
      return {
        status: 'failed',
        reason:
          error instanceof Error
            ? error.message
            : 'Failed to open desktop folder picker.',
      };
    }
  }

  if (strategy.mode === 'macos-script') {
    return await runCommandFolderPicker('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "Select Renku storage folder")',
    ]);
  }

  return {
    status: 'unavailable',
    reason: strategy.reason ?? NON_DESKTOP_UNSUPPORTED_REASON,
  };
}

function getFolderPickerSupport(
  pickerOptions: OnboardingPickerOptions
): FolderPickerSupport {
  const strategy = resolveFolderPickerStrategy(
    getFolderPickerContext(pickerOptions)
  );

  if (strategy.mode === 'desktop' && !pickerOptions.openDesktopFolderPicker) {
    return {
      supported: false,
      reason: DESKTOP_PICKER_NOT_CONFIGURED_REASON,
    };
  }

  if (strategy.mode === 'unsupported') {
    return {
      supported: false,
      reason: strategy.reason ?? NON_DESKTOP_UNSUPPORTED_REASON,
    };
  }

  return { supported: true };
}

/**
 * @internal Exported for testing
 */
export const onboardingHandlerTestUtils = {
  resolveFolderPickerStrategy,
};

async function runCommandFolderPicker(
  cmd: string,
  args: string[]
): Promise<FolderPickerResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    let stdout = '';
    let stderr = '';

    const finish = (result: FolderPickerResult) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(result);
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish({
          status: 'unavailable',
          reason: `${cmd} is not installed.`,
        });
        return;
      }

      finish({
        status: 'failed',
        reason: `${cmd} failed to start: ${error.message}`,
      });
    });

    child.on('close', (code) => {
      const trimmedOutput = stdout.trim();
      if (code === 0) {
        if (trimmedOutput.length === 0) {
          finish({ status: 'cancelled' });
          return;
        }

        finish({ status: 'selected', path: trimmedOutput });
        return;
      }

      if (code === 1) {
        finish({ status: 'cancelled' });
        return;
      }

      const trimmedStderr = stderr.trim();
      finish({
        status: 'failed',
        reason:
          trimmedStderr.length > 0
            ? trimmedStderr
            : `${cmd} exited with code ${code ?? 'unknown'}.`,
      });
    });
  });
}

function isWslEnvironment(): boolean {
  return (
    process.platform === 'linux' &&
    (Boolean(process.env.WSL_DISTRO_NAME) || Boolean(process.env.WSL_INTEROP))
  );
}

// ---------------------------------------------------------------------------
// POST /viewer-api/onboarding/setup
// ---------------------------------------------------------------------------

interface OnboardingSetupBody extends ProviderTokenPayload {
  storageRoot?: string;
}

async function handleSetup(
  req: IncomingMessage,
  res: ServerResponse,
  catalogPath: string | undefined
): Promise<boolean> {
  let body: OnboardingSetupBody;
  try {
    body = await parseJsonBody<OnboardingSetupBody>(req);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return true;
  }

  const { storageRoot, providers, promptProviders } = body;
  if (!storageRoot || storageRoot.trim() === '') {
    sendError(res, 400, 'storageRoot is required');
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
    await initWorkspace({
      rootFolder: storageRoot.trim(),
      catalogSourceRoot: catalogPath,
    });
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to initialize workspace'
    );
    return true;
  }

  try {
    await persistProviderTokenPayload({ providers, promptProviders });
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to write API keys'
    );
    return true;
  }

  sendJson(res, { ok: true });
  return true;
}

// ---------------------------------------------------------------------------
// POST /viewer-api/onboarding/catalog-sync
// ---------------------------------------------------------------------------

async function handleCatalogSync(
  _req: IncomingMessage,
  res: ServerResponse,
  catalogPath: string | undefined
): Promise<boolean> {
  if (!catalogPath) {
    sendError(
      res,
      500,
      'Server has no catalog path configured. Restart using "renku launch".'
    );
    return true;
  }

  const cliConfig = await readCliConfig();
  if (!cliConfig || !cliConfig.catalog?.root) {
    sendError(
      res,
      409,
      'Workspace is not initialized. Finish onboarding first.'
    );
    return true;
  }

  try {
    const result = await updateWorkspaceCatalog({
      rootFolder: cliConfig.storage.root,
      catalogSourceRoot: catalogPath,
      configuredCatalogRoot: cliConfig.catalog.root,
    });

    sendJson(res, { ok: true, catalogRoot: result.catalogRoot });
    return true;
  } catch (error) {
    sendError(
      res,
      500,
      error instanceof Error ? error.message : 'Failed to sync catalog'
    );
    return true;
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleOnboardingEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  action: string,
  catalogPath: string | undefined,
  pickerOptions: OnboardingPickerOptions = {}
): Promise<boolean> {
  switch (action) {
    case 'status': {
      if (req.method !== 'GET') {
        return respondMethodNotAllowed(res);
      }
      return handleStatus(req, res);
    }

    case 'browse-folder': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      return handleBrowseFolder(req, res, pickerOptions);
    }

    case 'browse-folder-support': {
      if (req.method !== 'GET') {
        return respondMethodNotAllowed(res);
      }
      return handleBrowseFolderSupport(req, res, pickerOptions);
    }

    case 'setup': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      return handleSetup(req, res, catalogPath);
    }

    case 'catalog-sync': {
      if (req.method !== 'POST') {
        return respondMethodNotAllowed(res);
      }
      return handleCatalogSync(req, res, catalogPath);
    }

    default:
      return respondNotFound(res);
  }
}
