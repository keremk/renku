import { app, BrowserWindow, dialog } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import electronUpdater, { type AppUpdater } from 'electron-updater';

const STARTUP_CHECK_DELAY_MS = 2 * 60 * 1000;
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PERIODIC_CHECK_JITTER_MS = 10 * 60 * 1000;

type UpdateCheckSource = 'manual' | 'periodic';

interface UpdaterAvailability {
  enabled: boolean;
  reason?: string;
}

export interface DesktopUpdaterOptions {
  mainWindow: BrowserWindow;
  onUpdateReadyChanged?: (ready: boolean) => void;
  log?: (message: string) => void;
}

export class DesktopUpdater {
  private readonly mainWindow: BrowserWindow;
  private readonly autoUpdater: AppUpdater;
  private readonly availability: UpdaterAvailability;
  private readonly onUpdateReadyChanged: (ready: boolean) => void;
  private readonly log: (message: string) => void;
  private startupTimer: NodeJS.Timeout | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;
  private checking = false;
  private manualCheckPending = false;
  private updateReady = false;

  constructor(options: DesktopUpdaterOptions) {
    this.mainWindow = options.mainWindow;
    this.autoUpdater = getAutoUpdater();
    this.onUpdateReadyChanged = options.onUpdateReadyChanged ?? (() => {});
    this.log =
      options.log ?? ((message) => console.log(`[updater] ${message}`));

    this.availability = this.resolveAvailability();

    if (!this.availability.enabled) {
      this.log(this.availability.reason ?? 'Updater disabled.');
      return;
    }

    this.configureRequestHeaders();

    this.autoUpdater.autoDownload = true;
    this.autoUpdater.autoInstallOnAppQuit = true;
    this.registerEvents();
  }

  start(): void {
    if (!this.availability.enabled) {
      return;
    }
    if (this.startupTimer !== null) {
      return;
    }
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.runCheck('periodic');
    }, STARTUP_CHECK_DELAY_MS);
  }

  dispose(): void {
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    if (this.periodicTimer !== null) {
      clearTimeout(this.periodicTimer);
      this.periodicTimer = null;
    }
    if (this.availability.enabled) {
      this.unregisterEvents();
    }
  }

  async checkForUpdatesManually(): Promise<void> {
    if (!this.availability.enabled) {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        message: 'Updates are unavailable for this build',
        detail:
          this.availability.reason ??
          'This build was packaged without update configuration.',
      });
      return;
    }

    if (this.checking) {
      await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        message: 'Already checking for updates',
        detail: 'Please wait for the current update check to complete.',
      });
      return;
    }

    this.manualCheckPending = true;
    await this.runCheck('manual');
  }

  quitAndInstall(): void {
    if (!this.updateReady) {
      return;
    }
    this.autoUpdater.quitAndInstall(false, true);
  }

  private resolveAvailability(): UpdaterAvailability {
    if (!app.isPackaged) {
      return {
        enabled: false,
        reason: 'Updates are only available in packaged app builds.',
      };
    }

    const appUpdateConfigPath = path.join(
      process.resourcesPath,
      'app-update.yml'
    );
    if (!existsSync(appUpdateConfigPath)) {
      return {
        enabled: false,
        reason:
          `Missing update config at "${appUpdateConfigPath}". ` +
          'Build with publish settings to generate app-update.yml.',
      };
    }

    return { enabled: true };
  }

  private configureRequestHeaders(): void {
    const clientId = process.env.RENKU_UPDATER_CF_ACCESS_CLIENT_ID;
    const clientSecret = process.env.RENKU_UPDATER_CF_ACCESS_CLIENT_SECRET;

    if (!clientId && !clientSecret) {
      this.log(
        'No CF-Access headers configured ' +
          '(RENKU_UPDATER_CF_ACCESS_CLIENT_ID / RENKU_UPDATER_CF_ACCESS_CLIENT_SECRET not set in ~/.config/renku/.env).'
      );
      return;
    }

    if (!clientId || !clientSecret) {
      throw new Error(
        'Both RENKU_UPDATER_CF_ACCESS_CLIENT_ID and RENKU_UPDATER_CF_ACCESS_CLIENT_SECRET must be set when configuring Cloudflare Access headers for updates.'
      );
    }

    this.autoUpdater.requestHeaders = {
      'CF-Access-Client-Id': clientId,
      'CF-Access-Client-Secret': clientSecret,
    };
    this.log('CF-Access headers configured for update requests.');
  }

  private registerEvents(): void {
    this.autoUpdater.on('checking-for-update', this.handleCheckingForUpdate);
    this.autoUpdater.on('update-available', this.handleUpdateAvailable);
    this.autoUpdater.on('update-not-available', this.handleUpdateNotAvailable);
    this.autoUpdater.on('update-downloaded', this.handleUpdateDownloaded);
    this.autoUpdater.on('error', this.handleUpdaterError);
  }

  private unregisterEvents(): void {
    this.autoUpdater.off('checking-for-update', this.handleCheckingForUpdate);
    this.autoUpdater.off('update-available', this.handleUpdateAvailable);
    this.autoUpdater.off('update-not-available', this.handleUpdateNotAvailable);
    this.autoUpdater.off('update-downloaded', this.handleUpdateDownloaded);
    this.autoUpdater.off('error', this.handleUpdaterError);
  }

  private readonly handleCheckingForUpdate = (): void => {
    this.checking = true;
    this.log('Checking for updates...');
  };

  private readonly handleUpdateAvailable = async (): Promise<void> => {
    this.checking = false;
    this.log('Update available. Download started.');

    if (this.manualCheckPending) {
      this.manualCheckPending = false;
      await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        message: 'Update found',
        detail: 'The update is downloading in the background.',
      });
    }
  };

  private readonly handleUpdateNotAvailable = async (): Promise<void> => {
    this.checking = false;
    this.log('No updates available.');

    if (this.manualCheckPending) {
      this.manualCheckPending = false;
      await dialog.showMessageBox(this.mainWindow, {
        type: 'info',
        message: 'You are up to date',
        detail: `Renku ${app.getVersion()} is the latest available version.`,
      });
    }
  };

  private readonly handleUpdateDownloaded = async (): Promise<void> => {
    this.checking = false;
    this.manualCheckPending = false;
    this.updateReady = true;
    this.onUpdateReadyChanged(true);
    this.log('Update downloaded and ready to install.');

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      message: 'Update ready to install',
      detail: 'Restart Renku now to apply the update.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      this.quitAndInstall();
    }
  };

  private readonly handleUpdaterError = async (error: Error): Promise<void> => {
    this.checking = false;
    this.log(`Updater error: ${error.message}`);

    if (this.manualCheckPending) {
      this.manualCheckPending = false;
      await dialog.showMessageBox(this.mainWindow, {
        type: 'error',
        message: 'Failed to check for updates',
        detail: sanitizeErrorDetail(error.message),
      });
    }
  };

  private async runCheck(source: UpdateCheckSource): Promise<void> {
    if (!this.availability.enabled) {
      return;
    }

    if (this.checking) {
      if (source === 'periodic') {
        this.scheduleNextPeriodicCheck();
      }
      return;
    }

    try {
      this.checking = true;
      await this.autoUpdater.checkForUpdates();
    } catch (error) {
      this.checking = false;
      if (source === 'manual') {
        this.manualCheckPending = false;
        const rawMessage =
          error instanceof Error ? error.message : 'Unknown updater error';
        this.log(`Update check error: ${rawMessage}`);
        await dialog.showMessageBox(this.mainWindow, {
          type: 'error',
          message: 'Failed to check for updates',
          detail: sanitizeErrorDetail(rawMessage),
        });
      }
    } finally {
      if (source === 'periodic') {
        this.scheduleNextPeriodicCheck();
      }
    }
  }

  private scheduleNextPeriodicCheck(): void {
    if (this.periodicTimer !== null) {
      clearTimeout(this.periodicTimer);
    }
    const jitter = Math.floor(Math.random() * PERIODIC_CHECK_JITTER_MS);
    this.periodicTimer = setTimeout(() => {
      this.periodicTimer = null;
      void this.runCheck('periodic');
    }, PERIODIC_CHECK_INTERVAL_MS + jitter);
  }
}

function getAutoUpdater(): AppUpdater {
  const { autoUpdater } = electronUpdater;
  return autoUpdater;
}

const MAX_ERROR_DETAIL_LENGTH = 500;

/**
 * Prevent oversized error dialogs (e.g. Cloudflare Access 403 pages that
 * contain an entire HTML document).  Strips HTML, extracts the first
 * meaningful line, and truncates to a displayable length.
 */
function sanitizeErrorDetail(raw: string): string {
  if (!raw) return 'An unknown error occurred.';

  const isHtml =
    raw.includes('<!DOCTYPE') || raw.includes('<html') || raw.includes('<HTML');

  if (isHtml) {
    // Try to extract a useful status from the HTML (e.g. "Forbidden", "403")
    const titleMatch = raw.match(/<title[^>]*>(.*?)<\/title>/i);
    const h1Match = raw.match(/<h1[^>]*>(.*?)<\/h1>/i);

    const title = titleMatch?.[1]?.trim();
    const heading = h1Match?.[1]?.trim();

    const parts: string[] = [];
    if (title) parts.push(title);
    if (heading && heading !== title) parts.push(heading);

    const summary =
      parts.length > 0
        ? parts.join(' — ')
        : 'The server returned an HTML error page.';

    return (
      `${summary}\n\n` +
      'This usually means the update server rejected the request. ' +
      'If this is a dev channel build, make sure RENKU_UPDATER_CF_ACCESS_CLIENT_ID ' +
      'and RENKU_UPDATER_CF_ACCESS_CLIENT_SECRET are set in ~/.config/renku/.env'
    );
  }

  if (raw.length > MAX_ERROR_DETAIL_LENGTH) {
    return raw.slice(0, MAX_ERROR_DETAIL_LENGTH) + '…\n\n(truncated)';
  }

  return raw;
}
