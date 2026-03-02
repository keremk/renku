/**
 * Onboarding API handler.
 *
 * Provides endpoints for the first-time setup flow:
 *   GET  /viewer-api/onboarding/status        - Check if workspace is initialized
 *   POST /viewer-api/onboarding/browse-folder - Open native folder picker
 *   POST /viewer-api/onboarding/setup         - Initialize workspace + write API keys
 */

import { spawn } from 'node:child_process';
import process from 'node:process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  isWorkspaceInitialized,
  initWorkspace,
  writeApiKeysEnvFile,
  type ApiKeyValues,
} from '@gorenku/core';
import { parseJsonBody, sendJson, sendError } from '../generation/http-utils.js';
import { respondNotFound, respondMethodNotAllowed } from '../http-utils.js';

// ---------------------------------------------------------------------------
// GET /viewer-api/onboarding/status
// ---------------------------------------------------------------------------

async function handleStatus(_req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const initialized = await isWorkspaceInitialized();
  sendJson(res, { initialized });
  return true;
}

// ---------------------------------------------------------------------------
// POST /viewer-api/onboarding/browse-folder
// ---------------------------------------------------------------------------

async function handleBrowseFolder(_req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const folderPath = await openNativeFolderPicker();
  sendJson(res, { path: folderPath });
  return true;
}

async function openNativeFolderPicker(): Promise<string | null> {
  const platform = process.platform;

  if (platform === 'darwin') {
    return await spawnPickerProcess('osascript', [
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
    return await spawnPickerProcess('powershell', ['-Command', script]);
  }

  // Linux: try zenity first, then kdialog
  const zenity = await spawnPickerProcess('zenity', ['--file-selection', '--directory', '--title=Select Renku storage folder']);
  if (zenity !== null) {
    return zenity;
  }
  return await spawnPickerProcess('kdialog', ['--getexistingdirectory', '/', '--title', 'Select Renku storage folder']);
}

async function spawnPickerProcess(cmd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('close', (code) => {
      const trimmed = output.trim();
      if (code === 0 && trimmed) {
        resolve(trimmed);
      } else {
        resolve(null);
      }
    });
    child.on('error', () => {
      resolve(null);
    });
  });
}

// ---------------------------------------------------------------------------
// POST /viewer-api/onboarding/setup
// ---------------------------------------------------------------------------

interface OnboardingSetupBody {
  storageRoot?: string;
  providers?: {
    fal?: { apiKey?: string };
    replicate?: { apiKey?: string };
    elevenlabs?: { apiKey?: string };
  };
  promptProviders?: {
    openai?: { apiKey?: string };
    vercelGateway?: { apiKey?: string };
  };
}

async function handleSetup(
  req: IncomingMessage,
  res: ServerResponse,
  catalogPath: string | undefined,
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
    sendError(res, 500, 'Server has no catalog path configured. Restart using "renku launch".');
    return true;
  }

  try {
    await initWorkspace({
      rootFolder: storageRoot.trim(),
      catalogSourceRoot: catalogPath,
    });
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Failed to initialize workspace');
    return true;
  }

  const keys: ApiKeyValues = {
    FAL_KEY: providers?.fal?.apiKey,
    REPLICATE_API_TOKEN: providers?.replicate?.apiKey,
    ELEVENLABS_API_KEY: providers?.elevenlabs?.apiKey,
    OPENAI_API_KEY: promptProviders?.openai?.apiKey,
    AI_GATEWAY_API_KEY: promptProviders?.vercelGateway?.apiKey,
  };

  try {
    await writeApiKeysEnvFile(keys);
  } catch (error) {
    sendError(res, 500, error instanceof Error ? error.message : 'Failed to write API keys');
    return true;
  }

  sendJson(res, { ok: true });
  return true;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export async function handleOnboardingEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  action: string,
  catalogPath: string | undefined,
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

    default:
      return respondNotFound(res);
  }
}
