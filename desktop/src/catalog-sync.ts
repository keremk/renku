import { app, BrowserWindow, dialog } from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const CATALOG_SYNC_ENDPOINT = '/viewer-api/onboarding/catalog-sync';

interface CatalogSyncState {
  lastCatalogSyncVersion?: string;
}

type CatalogSyncStatus =
  | 'synced'
  | 'workspace-not-initialized'
  | 'failed'
  | 'already-running';

interface CatalogSyncResult {
  status: CatalogSyncStatus;
  message?: string;
}

export interface CatalogSyncManagerOptions {
  log?: (message: string) => void;
}

export class CatalogSyncManager {
  private readonly serverUrl: string;
  private readonly stateFilePath: string;
  private readonly log: (message: string) => void;
  private syncInProgress = false;

  constructor(serverUrl: string, options: CatalogSyncManagerOptions = {}) {
    this.serverUrl = serverUrl;
    this.stateFilePath = path.join(
      app.getPath('userData'),
      'catalog-sync-state.json'
    );
    this.log =
      options.log ?? ((message) => console.log(`[catalog-sync] ${message}`));
  }

  async syncOnStartupForCurrentVersion(): Promise<void> {
    const version = app.getVersion();
    const state = await this.readState();
    if (state.lastCatalogSyncVersion === version) {
      return;
    }

    const result = await this.runSync();

    if (result.status === 'synced') {
      state.lastCatalogSyncVersion = version;
      await this.writeState(state);
      this.log(`Catalog synced for app version ${version}.`);
      return;
    }

    if (result.status === 'workspace-not-initialized') {
      this.log(
        'Skipping startup catalog sync because workspace is not initialized yet.'
      );
      return;
    }

    if (result.status === 'already-running') {
      return;
    }

    this.log(
      `Startup catalog sync failed: ${result.message ?? 'Unknown error'}`
    );
  }

  async syncManually(mainWindow: BrowserWindow): Promise<void> {
    const result = await this.runSync();

    if (result.status === 'already-running') {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'Catalog update already in progress',
        detail: 'Please wait for the current catalog update to finish.',
      });
      return;
    }

    if (result.status === 'workspace-not-initialized') {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        message: 'Workspace is not initialized yet',
        detail:
          result.message ??
          'Finish onboarding first, then run catalog update again.',
      });
      return;
    }

    if (result.status === 'failed') {
      await dialog.showMessageBox(mainWindow, {
        type: 'error',
        message: 'Failed to update catalog templates',
        detail: result.message ?? 'Unknown catalog update error',
      });
      return;
    }

    const version = app.getVersion();
    const state = await this.readState();
    state.lastCatalogSyncVersion = version;
    await this.writeState(state);

    await dialog.showMessageBox(mainWindow, {
      type: 'info',
      message: 'Catalog templates updated',
      detail: 'Latest catalog templates were copied into your workspace.',
    });
  }

  private async runSync(): Promise<CatalogSyncResult> {
    if (this.syncInProgress) {
      return { status: 'already-running' };
    }
    this.syncInProgress = true;

    try {
      const response = await fetch(
        `${this.serverUrl}${CATALOG_SYNC_ENDPOINT}`,
        {
          method: 'POST',
        }
      );

      const message = await readErrorMessage(response);

      if (response.ok) {
        return { status: 'synced' };
      }

      if (response.status === 409) {
        return {
          status: 'workspace-not-initialized',
          message,
        };
      }

      return {
        status: 'failed',
        message,
      };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.syncInProgress = false;
    }
  }

  private async readState(): Promise<CatalogSyncState> {
    try {
      const contents = await readFile(this.stateFilePath, 'utf8');
      return JSON.parse(contents) as CatalogSyncState;
    } catch {
      return {};
    }
  }

  private async writeState(state: CatalogSyncState): Promise<void> {
    await mkdir(path.dirname(this.stateFilePath), { recursive: true });
    await writeFile(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error && body.error.trim().length > 0) {
      return body.error;
    }
  } catch {
    // Ignore JSON parse failures and use fallback below.
  }
  return `Catalog sync request failed with status ${response.status}.`;
}
