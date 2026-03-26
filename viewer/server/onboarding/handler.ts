/**
 * Onboarding API handler.
 *
 * Provides endpoints for the first-time setup flow:
 *   GET  /viewer-api/onboarding/status        - Check if workspace is initialized
 *   POST /viewer-api/onboarding/browse-folder - Open native folder picker
 *   POST /viewer-api/onboarding/setup         - Initialize workspace + write API keys
 *   POST /viewer-api/onboarding/catalog-sync  - Sync workspace catalog from bundled catalog
 */

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
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
  res: ServerResponse
): Promise<boolean> {
  const pickerResult = await openNativeFolderPicker();
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

type FolderPickerResult =
  | { status: 'selected'; path: string }
  | { status: 'cancelled' }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; reason: string };

interface CommandCaptureSuccess {
  status: 'ok';
  stdout: string;
  stderr: string;
}

interface CommandCaptureUnavailable {
  status: 'unavailable';
}

interface CommandCaptureFailure {
  status: 'failed';
  reason: string;
}

type CommandCaptureResult =
  | CommandCaptureSuccess
  | CommandCaptureUnavailable
  | CommandCaptureFailure;

const PORTAL_RESPONSE_TIMEOUT_MS = 120_000;

async function openNativeFolderPicker(): Promise<FolderPickerResult> {
  const platform = process.platform;

  if (platform === 'darwin') {
    return await runCommandFolderPicker('osascript', [
      '-e',
      'POSIX path of (choose folder with prompt "Select Renku storage folder")',
    ]);
  }

  if (platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
      '$d.Description = "Select Renku storage folder"',
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath } else { "" }',
    ].join(';');
    return await runCommandFolderPicker('powershell', ['-Command', script]);
  }

  return openLinuxFolderPicker();
}

async function openLinuxFolderPicker(): Promise<FolderPickerResult> {
  const failures: string[] = [];

  const portal = await openFolderWithXdgDesktopPortal();
  if (portal.status === 'selected' || portal.status === 'cancelled') {
    return portal;
  }
  failures.push(`xdg-desktop-portal: ${portal.reason}`);

  const zenity = await runCommandFolderPicker('zenity', [
    '--file-selection',
    '--directory',
    '--title=Select Renku storage folder',
  ]);
  if (zenity.status === 'selected' || zenity.status === 'cancelled') {
    return zenity;
  }
  failures.push(`zenity: ${zenity.reason}`);

  const kdialog = await runCommandFolderPicker('kdialog', [
    '--getexistingdirectory',
    '/',
    '--title',
    'Select Renku storage folder',
  ]);
  if (kdialog.status === 'selected' || kdialog.status === 'cancelled') {
    return kdialog;
  }
  failures.push(`kdialog: ${kdialog.reason}`);

  return {
    status: 'failed',
    reason: buildLinuxPickerFailureMessage(failures),
  };
}

async function openFolderWithXdgDesktopPortal(): Promise<FolderPickerResult> {
  const handleToken = `renku${randomUUID().replace(/-/g, '')}`;
  const options = [
    `'handle_token': <'${handleToken}'>`,
    "'directory': <true>",
    "'modal': <true>",
  ].join(', ');

  const openRequest = await runCommandCapture('gdbus', [
    'call',
    '--session',
    '--dest',
    'org.freedesktop.portal.Desktop',
    '--object-path',
    '/org/freedesktop/portal/desktop',
    '--method',
    'org.freedesktop.portal.FileChooser.OpenFile',
    '',
    'Select Renku storage folder',
    `{${options}}`,
  ]);

  if (openRequest.status === 'unavailable') {
    return {
      status: 'unavailable',
      reason: 'gdbus is not installed.',
    };
  }

  if (openRequest.status === 'failed') {
    return {
      status: 'failed',
      reason: openRequest.reason,
    };
  }

  const requestPath = parsePortalRequestPath(openRequest.stdout);
  if (!requestPath) {
    return {
      status: 'failed',
      reason:
        'xdg-desktop-portal returned an unexpected response while opening the folder picker.',
    };
  }

  return waitForPortalResponse(requestPath);
}

function parsePortalRequestPath(output: string): string | null {
  const match = /objectpath ['"]([^'"]+)['"]/.exec(output);
  return match?.[1] ?? null;
}

async function waitForPortalResponse(
  requestPath: string
): Promise<FolderPickerResult> {
  return new Promise((resolve) => {
    const monitor = spawn(
      'gdbus',
      [
        'monitor',
        '--session',
        '--dest',
        'org.freedesktop.portal.Desktop',
        '--object-path',
        requestPath,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );

    let settled = false;
    let stdout = '';
    let stderr = '';

    const finish = (result: FolderPickerResult) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (!monitor.killed) {
        monitor.kill();
      }
      resolve(result);
    };

    const timeout = setTimeout(() => {
      finish({
        status: 'failed',
        reason:
          'Timed out waiting for xdg-desktop-portal file chooser response.',
      });
    }, PORTAL_RESPONSE_TIMEOUT_MS);

    monitor.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      const parsed = parsePortalMonitorOutput(stdout);
      if (parsed) {
        finish(parsed);
      }
    });

    monitor.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    monitor.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        finish({
          status: 'unavailable',
          reason: 'gdbus is not installed.',
        });
        return;
      }

      finish({
        status: 'failed',
        reason: `Failed to monitor xdg-desktop-portal response: ${error.message}`,
      });
    });

    monitor.on('close', (code) => {
      if (settled) {
        return;
      }

      const parsed = parsePortalMonitorOutput(stdout);
      if (parsed) {
        finish(parsed);
        return;
      }

      const trimmedStderr = stderr.trim();
      if (trimmedStderr.length > 0) {
        finish({ status: 'failed', reason: trimmedStderr });
        return;
      }

      finish({
        status: 'failed',
        reason: `xdg-desktop-portal monitor exited before returning a selection (code: ${code ?? 'unknown'}).`,
      });
    });
  });
}

function parsePortalMonitorOutput(output: string): FolderPickerResult | null {
  const responseMatch = /Response\s+\(uint32\s+(\d+),\s+\{([\s\S]*?)\}\)/m.exec(
    output
  );
  if (!responseMatch) {
    return null;
  }

  const responseCode = Number.parseInt(responseMatch[1] ?? '', 10);
  if (Number.isNaN(responseCode)) {
    return {
      status: 'failed',
      reason: 'xdg-desktop-portal returned an invalid response code.',
    };
  }

  if (responseCode === 1) {
    return { status: 'cancelled' };
  }

  if (responseCode !== 0) {
    return {
      status: 'failed',
      reason: `xdg-desktop-portal returned response code ${responseCode}.`,
    };
  }

  const responseBody = responseMatch[2] ?? '';
  const fileUriMatch = /file:\/\/[^'"\]\s,>]+/.exec(responseBody);
  if (!fileUriMatch || !fileUriMatch[0]) {
    return {
      status: 'failed',
      reason: 'xdg-desktop-portal did not return a selected folder path.',
    };
  }

  try {
    return {
      status: 'selected',
      path: fileURLToPath(fileUriMatch[0]),
    };
  } catch (error) {
    return {
      status: 'failed',
      reason:
        error instanceof Error
          ? `Failed to parse xdg-desktop-portal folder URI: ${error.message}`
          : 'Failed to parse xdg-desktop-portal folder URI.',
    };
  }
}

async function runCommandCapture(
  cmd: string,
  args: string[]
): Promise<CommandCaptureResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let settled = false;
    let stdout = '';
    let stderr = '';

    const finish = (result: CommandCaptureResult) => {
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
        finish({ status: 'unavailable' });
        return;
      }

      finish({ status: 'failed', reason: error.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        finish({ status: 'ok', stdout, stderr });
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

function buildLinuxPickerFailureMessage(failures: string[]): string {
  const platformGuidance =
    'Could not open a native folder picker. Linux requires xdg-desktop-portal (preferred) or zenity/kdialog.';
  const wslGuidance = isWslEnvironment()
    ? ' Detected WSL. GUI folder dialogs require WSLg and desktop portal integration; otherwise run Renku from Windows or enter the folder path manually.'
    : '';
  return `${platformGuidance}${wslGuidance} Details: ${failures.join(' | ')}`;
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
  catalogPath: string | undefined
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
      return handleBrowseFolder(req, res);
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
