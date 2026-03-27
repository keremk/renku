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

async function handleBrowseFolderSupport(
  _req: IncomingMessage,
  res: ServerResponse
): Promise<boolean> {
  const support = await getFolderPickerSupport();
  sendJson(res, support);
  return true;
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

const PORTAL_RESPONSE_TIMEOUT_MS = 20_000;
const MIN_FILE_CHOOSER_PORTAL_VERSION = 3;

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

async function getFolderPickerSupport(): Promise<FolderPickerSupport> {
  const platform = process.platform;

  if (platform === 'darwin' || platform === 'win32') {
    return { supported: true };
  }

  const linuxSupport = await getLinuxFolderPickerSupport();
  if (
    linuxSupport.portalAvailable ||
    linuxSupport.zenityAvailable ||
    linuxSupport.kdialogAvailable
  ) {
    return { supported: true };
  }

  const failures: string[] = [];
  if (linuxSupport.portalReason) {
    failures.push(`xdg-desktop-portal: ${linuxSupport.portalReason}`);
  }
  failures.push('zenity: zenity is not installed.');
  failures.push('kdialog: kdialog is not installed.');

  return {
    supported: false,
    reason: buildLinuxPickerFailureMessage(failures),
  };
}

interface LinuxFolderPickerSupport {
  portalAvailable: boolean;
  portalReason?: string;
  zenityAvailable: boolean;
  kdialogAvailable: boolean;
}

async function getLinuxFolderPickerSupport(): Promise<LinuxFolderPickerSupport> {
  const portalSupport = await checkXdgDesktopPortalSupport();
  const zenityAvailable = await isCommandInstalled('zenity', ['--version']);
  const kdialogAvailable = await isCommandInstalled('kdialog', ['--version']);

  return {
    portalAvailable: portalSupport.supported,
    portalReason: portalSupport.reason,
    zenityAvailable,
    kdialogAvailable,
  };
}

async function checkXdgDesktopPortalSupport(): Promise<FolderPickerSupport> {
  const hasOwnerResult = await runCommandCapture('gdbus', [
    'call',
    '--session',
    '--dest',
    'org.freedesktop.DBus',
    '--object-path',
    '/org/freedesktop/DBus',
    '--method',
    'org.freedesktop.DBus.NameHasOwner',
    'org.freedesktop.portal.Desktop',
  ]);

  if (hasOwnerResult.status === 'unavailable') {
    return {
      supported: false,
      reason: 'gdbus is not installed.',
    };
  }

  if (hasOwnerResult.status === 'failed') {
    return {
      supported: false,
      reason: hasOwnerResult.reason,
    };
  }

  const hasOwner = parseDbusNameHasOwner(hasOwnerResult.stdout);
  if (!hasOwner) {
    return {
      supported: false,
      reason:
        'org.freedesktop.portal.Desktop was not provided by any service files.',
    };
  }

  const versionResult = await runCommandCapture('gdbus', [
    'call',
    '--session',
    '--dest',
    'org.freedesktop.portal.Desktop',
    '--object-path',
    '/org/freedesktop/portal/desktop',
    '--method',
    'org.freedesktop.DBus.Properties.Get',
    'org.freedesktop.portal.FileChooser',
    'version',
  ]);

  if (versionResult.status === 'unavailable') {
    return {
      supported: false,
      reason: 'gdbus is not installed.',
    };
  }

  if (versionResult.status === 'failed') {
    return {
      supported: false,
      reason: versionResult.reason,
    };
  }

  const version = parsePortalInterfaceVersion(versionResult.stdout);
  if (version === null) {
    return {
      supported: false,
      reason: 'Could not parse xdg-desktop-portal FileChooser version.',
    };
  }

  if (version < MIN_FILE_CHOOSER_PORTAL_VERSION) {
    return {
      supported: false,
      reason: `xdg-desktop-portal FileChooser version ${version} is too old. Requires ${MIN_FILE_CHOOSER_PORTAL_VERSION}+ for directory selection.`,
    };
  }

  return { supported: true };
}

function parseDbusNameHasOwner(output: string): boolean {
  const match = /\(\s*(true|false)\s*,?\s*\)/.exec(output);
  if (!match || !match[1]) {
    return false;
  }
  return match[1] === 'true';
}

function parsePortalInterfaceVersion(output: string): number | null {
  const match = /uint32\s+(\d+)/.exec(output);
  if (!match || !match[1]) {
    return null;
  }

  const version = Number.parseInt(match[1], 10);
  if (Number.isNaN(version)) {
    return null;
  }

  return version;
}

async function isCommandInstalled(
  cmd: string,
  args: string[]
): Promise<boolean> {
  const result = await runCommandCapture(cmd, args);
  return result.status !== 'unavailable';
}

async function openLinuxFolderPicker(): Promise<FolderPickerResult> {
  const support = await getLinuxFolderPickerSupport();
  const failures: string[] = [];

  if (support.portalAvailable) {
    const portal = await openFolderWithXdgDesktopPortal();
    if (portal.status === 'selected' || portal.status === 'cancelled') {
      return portal;
    }
    failures.push(`xdg-desktop-portal: ${portal.reason}`);
  } else if (support.portalReason) {
    failures.push(`xdg-desktop-portal: ${support.portalReason}`);
  }

  if (support.zenityAvailable) {
    const zenity = await runCommandFolderPicker('zenity', [
      '--file-selection',
      '--directory',
      '--title=Select Renku storage folder',
    ]);
    if (zenity.status === 'selected' || zenity.status === 'cancelled') {
      return zenity;
    }
    failures.push(`zenity: ${zenity.reason}`);
  } else {
    failures.push('zenity: zenity is not installed.');
  }

  if (support.kdialogAvailable) {
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
  } else {
    failures.push('kdialog: kdialog is not installed.');
  }

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
  const match = /objectpath\s+['"]?([^'"\s,)]+)['"]?/.exec(output);
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
      const parsed = parsePortalMonitorOutput(stdout, { final: false });
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

      const parsed = parsePortalMonitorOutput(stdout, { final: true });
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

interface ParsePortalMonitorOptions {
  final: boolean;
}

function parsePortalMonitorOutput(
  output: string,
  options: ParsePortalMonitorOptions
): FolderPickerResult | null {
  if (!hasPortalResponseSignal(output)) {
    return null;
  }

  const responseCode = parsePortalResponseCode(output);
  if (responseCode === null) {
    return null;
  }

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

  const fileUriMatch = /file:\/\/[^'"\]\s,>]+/.exec(output);
  if (!fileUriMatch || !fileUriMatch[0]) {
    if (!options.final) {
      return null;
    }

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

function hasPortalResponseSignal(output: string): boolean {
  return (
    output.includes('member=Response') ||
    output.includes('org.freedesktop.portal.Request.Response')
  );
}

function parsePortalResponseCode(output: string): number | null {
  const responseSection = getLatestPortalResponseSection(output);
  if (!responseSection) {
    return null;
  }

  const inlineMatch = /Response\s*\(\s*(?:uint32\s+)?(\d+)/m.exec(
    responseSection
  );
  if (inlineMatch && inlineMatch[1]) {
    return Number.parseInt(inlineMatch[1], 10);
  }

  const memberMatch = /member=Response[\s\S]*?\n\s*(?:uint32\s+)?(\d+)/m.exec(
    responseSection
  );
  if (!memberMatch || !memberMatch[1]) {
    return null;
  }

  return Number.parseInt(memberMatch[1], 10);
}

function getLatestPortalResponseSection(output: string): string | null {
  const memberIndex = output.lastIndexOf('member=Response');
  const signalIndex = output.lastIndexOf(
    'org.freedesktop.portal.Request.Response'
  );
  const responseIndex = Math.max(memberIndex, signalIndex);

  if (responseIndex < 0) {
    return null;
  }

  return output.slice(responseIndex);
}

/**
 * @internal Exported for testing
 */
export const onboardingHandlerTestUtils = {
  parsePortalRequestPath,
  parsePortalMonitorOutput,
  parsePortalResponseCode,
};

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

    case 'browse-folder-support': {
      if (req.method !== 'GET') {
        return respondMethodNotAllowed(res);
      }
      return handleBrowseFolderSupport(req, res);
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
