import { app, BrowserWindow, dialog } from 'electron';
import {
  accessSync,
  appendFileSync,
  copyFileSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  statSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import electronUpdater, {
  type AppUpdater,
  type UpdateDownloadedEvent,
} from 'electron-updater';

const STARTUP_CHECK_DELAY_MS = 2 * 60 * 1000;
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PERIODIC_CHECK_JITTER_MS = 10 * 60 * 1000;

type UpdateCheckSource = 'manual' | 'periodic';
type InstallStrategy = 'squirrel' | 'manual';

const MANUAL_INSTALL_LOG_PATH = path.join(
  os.homedir(),
  '.config',
  'renku',
  'updater-installer.log'
);

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
  private availability: UpdaterAvailability;
  private readonly onUpdateReadyChanged: (ready: boolean) => void;
  private readonly log: (message: string) => void;
  private startupTimer: NodeJS.Timeout | null = null;
  private periodicTimer: NodeJS.Timeout | null = null;
  private checking = false;
  private manualCheckPending = false;
  private updateReady = false;
  private installStrategy: InstallStrategy = 'squirrel';
  private updateChannel: string | null = null;
  private appBundlePath: string | null = null;

  /**
   * Path to the downloaded update zip cached by electron-updater.
   * Captured from the `update-downloaded` event so we can install it
   * ourselves instead of going through Squirrel.Mac (which rejects
   * ad-hoc signed builds).
   */
  private downloadedFilePath: string | null = null;

  constructor(options: DesktopUpdaterOptions) {
    this.mainWindow = options.mainWindow;
    this.autoUpdater = getAutoUpdater();
    this.onUpdateReadyChanged = options.onUpdateReadyChanged ?? (() => {});
    this.log = options.log ?? createFileLogger();

    this.availability = this.resolveAvailability();

    if (!this.availability.enabled) {
      this.log(this.availability.reason ?? 'Updater disabled.');
      return;
    }

    this.configureRequestHeaders();

    try {
      const installStrategy = resolveInstallStrategy();
      this.installStrategy = installStrategy.strategy;
      this.appBundlePath = installStrategy.appBundlePath;
      this.updateChannel = readUpdateChannel(getAppUpdateConfigPath());
      this.log(
        `Detected TeamIdentifier=${installStrategy.teamIdentifier}. Install strategy=${this.installStrategy}.`
      );
      this.log(
        `Updater startup mode=${describeInstallStrategy(this.installStrategy)} channel=${this.updateChannel} periodicPolling=enabled.`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.availability = {
        enabled: false,
        reason: `Updater disabled: ${detail}`,
      };
      this.log(this.availability.reason ?? 'Updater disabled.');
      return;
    }

    // Pipe electron-updater's internal logs through our logger so we can
    // see Squirrel.Mac / ShipIt diagnostics in the console.
    this.autoUpdater.logger = {
      info: (message: unknown) => this.log(String(message)),
      warn: (message: unknown) => this.log(`WARN: ${String(message)}`),
      error: (message: unknown) => this.log(`ERROR: ${String(message)}`),
      debug: (message: unknown) => this.log(`DEBUG: ${String(message)}`),
    };

    this.autoUpdater.autoDownload = true;

    this.autoUpdater.autoInstallOnAppQuit = this.installStrategy === 'squirrel';

    this.registerEvents();
  }

  start(): void {
    if (!this.availability.enabled) {
      return;
    }
    if (this.updateChannel === null) {
      throw new Error('Updater channel was not initialized.');
    }
    if (this.startupTimer !== null) {
      return;
    }
    this.startupTimer = setTimeout(() => {
      this.startupTimer = null;
      void this.runCheck('periodic');
    }, STARTUP_CHECK_DELAY_MS);
  }

  getBuildModeLabel(): string {
    const version = app.getVersion();

    if (!this.availability.enabled) {
      return `Build: v${version} | updater disabled`;
    }

    const channel = this.updateChannel ?? 'unknown';
    const strategy = describeInstallStrategy(this.installStrategy);
    return `Build: v${version} | ${strategy} | channel ${channel}`;
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

  /**
   * Install the downloaded update.
   *
   * - Production-signed builds use Squirrel.Mac/ShipIt.
   * - Ad-hoc signed builds use a manual app bundle replacement path.
   */
  quitAndInstall(): void {
    if (!this.updateReady) {
      this.log('quitAndInstall called but no update is ready — ignoring.');
      return;
    }

    if (this.installStrategy === 'squirrel') {
      this.log('Installing update via Squirrel.Mac.');
      this.autoUpdater.quitAndInstall(false, true);
      return;
    }

    if (!this.appBundlePath) {
      this.log('Manual install requested, but app bundle path is unavailable.');
      dialog.showMessageBoxSync(this.mainWindow, {
        type: 'error',
        message: 'Cannot install update',
        detail:
          'Unable to locate the app bundle for manual install. Please restart and try again.',
      });
      return;
    }

    if (!this.downloadedFilePath || !existsSync(this.downloadedFilePath)) {
      this.log(
        `Downloaded update file not found: ${this.downloadedFilePath ?? '(null)'}`
      );
      dialog.showMessageBoxSync(this.mainWindow, {
        type: 'error',
        message: 'Cannot install update',
        detail:
          'The downloaded update file was not found. Please try checking for updates again.',
      });
      return;
    }

    const appBundlePath = this.appBundlePath;
    const downloadedFilePath = this.downloadedFilePath;
    let relaunchUid: number;
    let requiresAdmin: boolean;

    try {
      relaunchUid = getCurrentUid();
      requiresAdmin = requiresAdministratorPrivileges(appBundlePath);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.log(`Cannot initialize manual installer: ${detail}`);
      dialog.showMessageBoxSync(this.mainWindow, {
        type: 'error',
        message: 'Cannot install update',
        detail: `Failed to prepare installer: ${detail}`,
      });
      return;
    }

    let installerZipPath = downloadedFilePath;
    let cleanupInstallerZip = false;

    if (requiresAdmin) {
      try {
        installerZipPath = stageUpdateZipForPrivilegedInstall(
          downloadedFilePath,
          process.pid
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        this.log(
          `Failed to stage update payload for privileged install: ${detail}`
        );
        dialog.showMessageBoxSync(this.mainWindow, {
          type: 'error',
          message: 'Cannot install update',
          detail: `Unable to prepare update payload for privileged install: ${detail}`,
        });
        return;
      }
      cleanupInstallerZip = true;
      this.log(
        `Staged update payload for privileged install: source=${downloadedFilePath} staged=${installerZipPath}`
      );
    }

    const scriptPath = createManualInstallScript({
      appPid: process.pid,
      appBundlePath,
      downloadedFilePath: installerZipPath,
      logPath: MANUAL_INSTALL_LOG_PATH,
      cleanupZipPath: cleanupInstallerZip,
      terminateRunningApp: requiresAdmin,
      relaunchUid,
    });

    this.log(
      `Manual install script prepared: script=${scriptPath} zip=${installerZipPath} app=${appBundlePath} log=${MANUAL_INSTALL_LOG_PATH} mode=${requiresAdmin ? 'privileged' : 'standard'}`
    );

    if (requiresAdmin) {
      this.log(
        'Manual install requires administrator privileges. Prompting for macOS admin password.'
      );

      const privilegedCommand = `/bin/bash ${shellQuote(scriptPath)}`;
      const appleScript = `do shell script ${toAppleScriptStringLiteral(privilegedCommand)} with administrator privileges`;
      const result = spawnSync('/usr/bin/osascript', ['-e', appleScript], {
        encoding: 'utf8',
      });

      if (result.error) {
        this.log(
          `Failed to run osascript for updater install: ${result.error.message}`
        );
        safeUnlink(scriptPath);
        if (cleanupInstallerZip) {
          safeUnlink(installerZipPath);
        }
        dialog.showMessageBoxSync(this.mainWindow, {
          type: 'error',
          message: 'Cannot install update',
          detail: `Failed to request administrator privileges: ${result.error.message}`,
        });
        return;
      }

      if (result.status !== 0) {
        const detail = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
        safeUnlink(scriptPath);
        if (cleanupInstallerZip) {
          safeUnlink(installerZipPath);
        }

        if (isUserCancelledPrivilegePrompt(detail)) {
          this.log('Administrator password prompt was cancelled by the user.');
          dialog.showMessageBoxSync(this.mainWindow, {
            type: 'info',
            message: 'Update installation canceled',
            detail:
              'Renku did not restart. Use "Restart to Install Update" when you are ready.',
          });
          return;
        }

        this.log(
          `Administrator privilege request failed (status=${String(result.status)}): ${detail}`
        );
        dialog.showMessageBoxSync(this.mainWindow, {
          type: 'error',
          message: 'Cannot install update',
          detail:
            `Failed to start privileged installer (status ${String(result.status)}). ` +
            `Details: ${sanitizeErrorDetail(detail || 'No output from osascript.')}`,
        });
        return;
      }

      this.log(
        `Privileged installer finished. Logs were written to ${MANUAL_INSTALL_LOG_PATH}`
      );
      this.log('Exiting app after privileged installer execution…');
      app.exit(0);
      return;
    }

    const child = spawn('/bin/bash', [scriptPath], {
      detached: true,
      stdio: 'ignore',
      env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
    });
    child.unref();

    this.log(
      `Installer launched without privilege escalation. Logs will be written to ${MANUAL_INSTALL_LOG_PATH}`
    );
    this.log('Exiting app so installer can replace the bundle…');
    app.exit(0);
  }

  private resolveAvailability(): UpdaterAvailability {
    if (!app.isPackaged) {
      return {
        enabled: false,
        reason: 'Updates are only available in packaged app builds.',
      };
    }

    const appUpdateConfigPath = getAppUpdateConfigPath();
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

  private readonly handleUpdateDownloaded = async (
    info: UpdateDownloadedEvent
  ): Promise<void> => {
    this.checking = false;
    this.manualCheckPending = false;
    this.updateReady = true;
    this.onUpdateReadyChanged(true);

    // Capture the downloaded zip path for our manual install.
    if (info.downloadedFile) {
      this.downloadedFilePath = info.downloadedFile;
      this.log(`Update downloaded: ${this.downloadedFilePath}`);
    } else {
      this.log(
        'WARN: update-downloaded event did not include downloadedFile path.'
      );
    }

    const result = await dialog.showMessageBox(this.mainWindow, {
      type: 'info',
      message: 'Update ready to install',
      detail:
        this.installStrategy === 'squirrel'
          ? 'Restart Renku now to apply the update.'
          : 'Restart Renku now to apply the update. If Renku is installed in /Applications, macOS will ask for an administrator password before restart. If you choose Later, use Renku > Restart to Install Update when ready.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      this.log('User chose "Restart Now" from update dialog.');
      this.quitAndInstall();
    } else {
      if (this.installStrategy === 'squirrel') {
        this.log(
          'User chose "Later". Update will install when the app is quit and reopened.'
        );
      } else {
        this.log(
          'User chose "Later". Use Renku > Restart to Install Update when ready.'
        );
      }
    }
  };

  private readonly handleUpdaterError = async (error: Error): Promise<void> => {
    this.checking = false;

    const isExpectedSquirrelMacError =
      error.message.includes(
        'code failed to satisfy specified code requirement'
      ) || error.message.includes('The command is disabled');

    // In ad-hoc mode we intentionally bypass Squirrel.Mac at install time,
    // so these Squirrel.Mac errors are expected and should stay non-fatal.
    if (this.installStrategy === 'manual' && isExpectedSquirrelMacError) {
      this.log(
        `Squirrel.Mac error (expected with ad-hoc signing, ignored): ${error.message}`
      );
      return;
    }

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

function getAppUpdateConfigPath(): string {
  return path.join(process.resourcesPath, 'app-update.yml');
}

function readUpdateChannel(updateConfigPath: string): string {
  const updateConfigRaw = readFileSync(updateConfigPath, 'utf8');
  const lines = updateConfigRaw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    if (!trimmed.startsWith('channel:')) {
      continue;
    }

    const rawValue = trimmed.slice('channel:'.length).trim();
    const valueBeforeComment = rawValue.split('#', 1)[0].trim();
    const channel = unwrapQuotedScalar(valueBeforeComment);

    if (!channel) {
      throw new Error(
        `Update channel is empty in config file "${updateConfigPath}".`
      );
    }

    return channel;
  }

  throw new Error(
    `Update channel is missing in config file "${updateConfigPath}".`
  );
}

function unwrapQuotedScalar(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function describeInstallStrategy(strategy: InstallStrategy): string {
  return strategy === 'manual' ? 'ad-hoc/manual' : 'signed/squirrel';
}

interface InstallStrategyResolution {
  strategy: InstallStrategy;
  appBundlePath: string;
  teamIdentifier: string;
}

function resolveInstallStrategy(): InstallStrategyResolution {
  const appBundlePath = resolveAppBundlePathFromExecPath(process.execPath);
  const teamIdentifier = readTeamIdentifier(appBundlePath);
  const strategy: InstallStrategy =
    teamIdentifier === 'not set' ? 'manual' : 'squirrel';

  return {
    strategy,
    appBundlePath,
    teamIdentifier,
  };
}

function resolveAppBundlePathFromExecPath(execPath: string): string {
  const appBundlePath = path.resolve(execPath, '..', '..', '..');
  if (!appBundlePath.endsWith('.app')) {
    throw new Error(
      `Cannot determine .app bundle path from execPath: ${execPath}`
    );
  }
  return appBundlePath;
}

function readTeamIdentifier(appBundlePath: string): string {
  const codesignResult = spawnSync(
    'codesign',
    ['-dv', '--verbose=4', appBundlePath],
    { encoding: 'utf8' }
  );

  if (codesignResult.error) {
    throw new Error(
      `Failed to inspect app signature at "${appBundlePath}": ${codesignResult.error.message}`
    );
  }

  if (codesignResult.status !== 0) {
    const detail =
      `${codesignResult.stdout ?? ''}${codesignResult.stderr ?? ''}`.trim();
    throw new Error(
      `codesign exited with status ${String(codesignResult.status)} while inspecting "${appBundlePath}": ${detail}`
    );
  }

  const signingInfo = `${codesignResult.stdout ?? ''}\n${codesignResult.stderr ?? ''}`;
  const teamIdentifierMatch = signingInfo.match(/^TeamIdentifier=(.+)$/m);
  if (!teamIdentifierMatch) {
    throw new Error(
      `TeamIdentifier is missing in codesign output for "${appBundlePath}".`
    );
  }

  const teamIdentifier = teamIdentifierMatch[1].trim();
  if (teamIdentifier === '') {
    throw new Error(
      `TeamIdentifier is empty in codesign output for "${appBundlePath}".`
    );
  }

  return teamIdentifier;
}

interface ManualInstallScriptOptions {
  appPid: number;
  appBundlePath: string;
  downloadedFilePath: string;
  logPath: string;
  cleanupZipPath: boolean;
  terminateRunningApp: boolean;
  relaunchUid: number;
}

function createManualInstallScript(
  options: ManualInstallScriptOptions
): string {
  const scriptPath = path.join(
    os.tmpdir(),
    `renku-update-installer-${options.appPid}-${Date.now()}.sh`
  );

  const appName = path.basename(options.appBundlePath);
  const stagingDir = path.join(os.tmpdir(), `renku-update-${options.appPid}`);
  const backupBundlePath = `${options.appBundlePath}.renku-updating-backup`;

  const script = [
    '#!/bin/bash',
    'set -euo pipefail',
    `APP_PID=${String(options.appPid)}`,
    `APP_BUNDLE_PATH=${shellQuote(options.appBundlePath)}`,
    `BACKUP_APP_BUNDLE_PATH=${shellQuote(backupBundlePath)}`,
    `APP_NAME=${shellQuote(appName)}`,
    `ZIP_PATH=${shellQuote(options.downloadedFilePath)}`,
    `STAGING_DIR=${shellQuote(stagingDir)}`,
    `INSTALL_LOG=${shellQuote(options.logPath)}`,
    `SELF_PATH=${shellQuote(scriptPath)}`,
    `TERMINATE_RUNNING_APP=${options.terminateRunningApp ? '1' : '0'}`,
    `CLEANUP_ZIP=${options.cleanupZipPath ? '1' : '0'}`,
    `RELAUNCH_UID=${String(options.relaunchUid)}`,
    'log() { echo "$(date -u +\'%Y-%m-%dT%H:%M:%SZ\') $1"; }',
    'trap \'log "ERROR: installer failed at line $LINENO with exit code $?"\' ERR',
    'trap \'rm -f "$SELF_PATH"\' EXIT',
    'mkdir -p "$(dirname "$INSTALL_LOG")"',
    '{',
    '  log "manual installer started pid=$APP_PID app=$APP_BUNDLE_PATH zip=$ZIP_PATH terminateRunningApp=$TERMINATE_RUNNING_APP relaunchUid=$RELAUNCH_UID"',
    '  if [ "$TERMINATE_RUNNING_APP" = "1" ] && kill -0 "$APP_PID" 2>/dev/null; then',
    '    log "requesting app process exit pid=$APP_PID"',
    '    /bin/kill "$APP_PID"',
    '  fi',
    '  elapsed=0',
    '  while kill -0 "$APP_PID" 2>/dev/null; do',
    '    if [ "$elapsed" -ge 30 ]; then',
    '      log "app process still running after 30s, sending SIGKILL pid=$APP_PID"',
    '      /bin/kill -9 "$APP_PID" 2>/dev/null || true',
    '      sleep 0.5',
    '      if kill -0 "$APP_PID" 2>/dev/null; then',
    '        log "ERROR: app process did not exit after SIGKILL pid=$APP_PID"',
    '        exit 1',
    '      fi',
    '      break',
    '    fi',
    '    sleep 1',
    '    elapsed=$((elapsed + 1))',
    '  done',
    '  log "app process exited, proceeding with install"',
    '  rm -rf "$STAGING_DIR"',
    '  mkdir -p "$STAGING_DIR"',
    '  log "extracting update payload"',
    '  /usr/bin/ditto -xk "$ZIP_PATH" "$STAGING_DIR"',
    '  if [ ! -d "$STAGING_DIR/$APP_NAME" ]; then',
    '    log "ERROR: extracted app not found at $STAGING_DIR/$APP_NAME"',
    '    exit 1',
    '  fi',
    '  if [ ! -d "$APP_BUNDLE_PATH" ]; then',
    '    log "ERROR: existing app bundle not found at $APP_BUNDLE_PATH"',
    '    exit 1',
    '  fi',
    '  rm -rf "$BACKUP_APP_BUNDLE_PATH"',
    '  log "moving current app bundle to backup"',
    '  mv "$APP_BUNDLE_PATH" "$BACKUP_APP_BUNDLE_PATH"',
    '  log "moving updated app bundle into place"',
    '  if mv "$STAGING_DIR/$APP_NAME" "$APP_BUNDLE_PATH"; then',
    '    rm -rf "$BACKUP_APP_BUNDLE_PATH"',
    '  else',
    '    log "ERROR: failed to move updated app into place, restoring backup"',
    '    mv "$BACKUP_APP_BUNDLE_PATH" "$APP_BUNDLE_PATH"',
    '    exit 1',
    '  fi',
    '  /usr/bin/xattr -dr com.apple.quarantine "$APP_BUNDLE_PATH" 2>/dev/null || true',
    '  if [ "$CLEANUP_ZIP" = "1" ]; then',
    '    rm -f "$ZIP_PATH"',
    '  fi',
    '  rm -rf "$STAGING_DIR"',
    '  if [ "$(id -u)" -eq 0 ]; then',
    '    if /bin/launchctl asuser "$RELAUNCH_UID" /usr/bin/open "$APP_BUNDLE_PATH"; then',
    '      log "relaunched app with launchctl asuser uid=$RELAUNCH_UID"',
    '    else',
    '      log "WARN: launchctl asuser relaunch failed"',
    '    fi',
    '  else',
    '    /usr/bin/open "$APP_BUNDLE_PATH"',
    '    log "relaunched app as current user"',
    '  fi',
    '  log "manual installer completed"',
    '} >> "$INSTALL_LOG" 2>&1',
  ].join('\n');

  writeFileSync(scriptPath, script, { mode: 0o700 });
  return scriptPath;
}

function requiresAdministratorPrivileges(appBundlePath: string): boolean {
  if (!existsSync(appBundlePath)) {
    throw new Error(`App bundle path does not exist: ${appBundlePath}`);
  }

  const appParentDir = path.dirname(appBundlePath);
  return !hasWriteAccess(appParentDir) || !hasWriteAccess(appBundlePath);
}

function hasWriteAccess(targetPath: string): boolean {
  try {
    accessSync(targetPath, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function getCurrentUid(): number {
  if (typeof process.getuid !== 'function') {
    throw new Error('process.getuid is unavailable on this platform.');
  }
  return process.getuid();
}

function stageUpdateZipForPrivilegedInstall(
  downloadedFilePath: string,
  appPid: number
): string {
  const stagedZipPath = path.join(
    os.tmpdir(),
    `renku-update-payload-${appPid}-${Date.now()}.zip`
  );
  copyFileSync(downloadedFilePath, stagedZipPath);
  return stagedZipPath;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function toAppleScriptStringLiteral(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')}"`;
}

function isUserCancelledPrivilegePrompt(detail: string): boolean {
  return detail.includes('User canceled') || detail.includes('(-128)');
}

function safeUnlink(filePath: string): void {
  try {
    unlinkSync(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

// ---------------------------------------------------------------------------
// File logger — writes to ~/.config/renku/updater.log
// ---------------------------------------------------------------------------

const LOG_MAX_BYTES = 512 * 1024; // 512 KB — rotate when exceeded

function getLogPath(): string {
  return path.join(os.homedir(), '.config', 'renku', 'updater.log');
}

function createFileLogger(): (message: string) => void {
  const logPath = getLogPath();
  const logDir = path.dirname(logPath);

  // Ensure the directory exists
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    // If we can't create the dir, fall back to console-only
    return (message) => console.log(`[updater] ${message}`);
  }

  // Rotate if the log is too large
  try {
    if (existsSync(logPath) && statSync(logPath).size > LOG_MAX_BYTES) {
      const rotated = `${logPath}.old`;
      renameSync(logPath, rotated);
    }
  } catch {
    // Non-critical — keep going
  }

  return (message: string) => {
    const timestamp = new Date().toISOString();
    const line = `${timestamp}  ${message}\n`;
    console.log(`[updater] ${message}`);
    try {
      appendFileSync(logPath, line);
    } catch {
      // Swallow write errors — logging should never crash the app
    }
  };
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
