import { app, BrowserWindow, Menu, dialog } from 'electron';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { installCli, isCliInstalled } from './cli-install.js';
import { DesktopUpdater } from './updater.js';
import { CatalogSyncManager } from './catalog-sync.js';

// ---------------------------------------------------------------------------
// FFmpeg PATH setup
// ---------------------------------------------------------------------------

function setupFfmpegPath(): void {
  // In production, the ffmpeg binary is in extraResources
  // In dev, it's in desktop/resources/ffmpeg (copied by prepare-desktop-bundle)
  // Fall back to desktop/node_modules/ffmpeg-static/ffmpeg for dev without bundling
  const candidates = [
    getResourcePath('ffmpeg'),
    path.join(app.getAppPath(), 'node_modules', 'ffmpeg-static', 'ffmpeg'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const ffmpegDir = path.dirname(candidate);
      process.env.PATH = `${ffmpegDir}${path.delimiter}${process.env.PATH ?? ''}`;
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// CLI config reader (reads ~/.config/renku/cli-config.json)
// ---------------------------------------------------------------------------

interface CliConfig {
  storage: {
    root: string;
    basePath: string;
  };
  catalog?: {
    root: string;
  };
  viewer?: {
    port?: number;
    host?: string;
  };
}

async function readCliConfig(): Promise<CliConfig | null> {
  const configPath = path.resolve(
    os.homedir(),
    '.config',
    'renku',
    'cli-config.json'
  );
  try {
    const contents = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(contents) as Partial<CliConfig>;
    if (!parsed.storage) {
      return null;
    }
    return parsed as CliConfig;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// .env loader (loads ~/.config/renku/.env)
// ---------------------------------------------------------------------------

function loadUserEnv(): void {
  const envPath = path.resolve(os.homedir(), '.config', 'renku', '.env');
  if (!existsSync(envPath)) {
    return;
  }
  // Simple .env parser - load key=value lines into process.env
  try {
    const contents = readFileSync(envPath, 'utf8');
    for (const line of contents.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed
        .slice(eqIndex + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // Ignore errors loading env
  }
}

// ---------------------------------------------------------------------------
// Resource paths
// ---------------------------------------------------------------------------

function getResourcePath(...segments: string[]): string {
  // In production, resources are in process.resourcesPath
  // In dev, they're in the desktop/resources/ directory
  if (app.isPackaged) {
    return path.join(process.resourcesPath, ...segments);
  }
  return path.join(app.getAppPath(), 'resources', ...segments);
}

// ---------------------------------------------------------------------------
// Viewer server
// ---------------------------------------------------------------------------

interface ViewerServerInstance {
  url: string;
  host: string;
  port: number;
  stop(): Promise<void>;
}

async function startServer(rootFolder: string): Promise<ViewerServerInstance> {
  // Import the viewer server from bundled resources
  const serverPath = getResourcePath('viewer-server', 'runtime.mjs');
  const { startViewerServer } = await import(serverPath);

  return await startViewerServer({
    rootFolder,
    distPath: getResourcePath('viewer-dist'),
    catalogPath: getResourcePath('catalog'),
    port: 0,
    log: (message: string) => {
      console.log(`[viewer-server] ${message}`);
    },
  });
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------

async function navigateMainWindowToPath(
  mainWindow: BrowserWindow,
  pathname: string
): Promise<void> {
  const currentUrl = mainWindow.webContents.getURL();

  if (currentUrl && currentUrl.trim() !== '') {
    const url = new URL(currentUrl);
    url.pathname = pathname;
    url.search = '';
    url.hash = '';
    await mainWindow.loadURL(url.toString());
    return;
  }

  if (!server) {
    throw new Error('Viewer server is not running.');
  }

  const fallbackUrl = new URL(pathname, server.url).toString();
  await mainWindow.loadURL(fallbackUrl);
}

function createAppMenu(
  mainWindow: BrowserWindow,
  buildModeLabel: string
): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Install renku CLI Command...',
          click: async () => {
            if (await isCliInstalled()) {
              const result = await dialog.showMessageBox(mainWindow, {
                type: 'info',
                message: 'renku CLI is already installed',
                detail:
                  'The renku command is available in your terminal at /usr/local/bin/renku.',
                buttons: ['OK', 'Reinstall'],
              });
              if (result.response === 0) return;
            }

            try {
              await installCli();
              await dialog.showMessageBox(mainWindow, {
                type: 'info',
                message: 'renku CLI installed',
                detail:
                  'You can now use the "renku" command in your terminal. Open a new terminal window to get started.',
              });
            } catch (error) {
              await dialog.showMessageBox(mainWindow, {
                type: 'error',
                message: 'Failed to install renku CLI',
                detail: error instanceof Error ? error.message : String(error),
              });
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: async () => {
            try {
              await navigateMainWindowToPath(mainWindow, '/settings');
            } catch (error) {
              await dialog.showMessageBox(mainWindow, {
                type: 'error',
                message: 'Failed to open Settings',
                detail: error instanceof Error ? error.message : String(error),
              });
            }
          },
        },
        { type: 'separator' },
        {
          id: 'build-mode',
          label: buildModeLabel,
          enabled: false,
        },
        {
          type: 'separator',
        },
        {
          id: 'check-for-updates',
          label: 'Check for Updates...',
          click: async () => {
            if (!updater) {
              await dialog.showMessageBox(mainWindow, {
                type: 'info',
                message: 'Updater is not ready yet',
                detail: 'Please try again in a moment.',
              });
              return;
            }
            await updater.checkForUpdatesManually();
          },
        },
        {
          id: 'restart-to-update',
          label: 'Restart to Install Update',
          enabled: false,
          click: () => {
            updater?.quitAndInstall();
          },
        },
        {
          id: 'update-catalog',
          label: 'Update Catalog Templates...',
          click: async () => {
            if (!catalogSyncManager) {
              await dialog.showMessageBox(mainWindow, {
                type: 'info',
                message: 'Catalog sync is not ready yet',
                detail: 'Please try again in a moment.',
              });
              return;
            }
            await catalogSyncManager.syncManually(mainWindow);
          },
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setRestartToUpdateEnabled(enabled: boolean): void {
  const menu = Menu.getApplicationMenu();
  if (!menu) {
    return;
  }
  const menuItem = menu.getMenuItemById('restart-to-update');
  if (!menuItem) {
    return;
  }
  menuItem.enabled = enabled;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let server: ViewerServerInstance | null = null;
let updater: DesktopUpdater | null = null;
let catalogSyncManager: CatalogSyncManager | null = null;

async function createWindow(): Promise<void> {
  // Load user environment variables
  loadUserEnv();

  // Set up ffmpeg on PATH
  setupFfmpegPath();

  // Read CLI config for storage root (may be null if not yet initialized)
  const config = await readCliConfig();
  const rootFolder = config?.storage?.root ?? path.join(os.homedir(), 'Renku');

  // Start the viewer server
  server = await startServer(rootFolder);
  console.log(`Viewer server started at ${server.url}`);

  // Create the browser window
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Renku',
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  catalogSyncManager = new CatalogSyncManager(server.url);
  updater = new DesktopUpdater({
    mainWindow,
    onUpdateReadyChanged: (ready) => {
      setRestartToUpdateEnabled(ready);
    },
  });
  const buildModeLabel = updater.getBuildModeLabel();
  console.log(`[desktop] ${buildModeLabel}`);

  // Set up the application menu
  createAppMenu(mainWindow, buildModeLabel);
  updater.start();

  // Ensure catalog is synchronized once per installed app version
  await catalogSyncManager.syncOnStartupForCurrentVersion();

  // Load the viewer
  await mainWindow.loadURL(server.url);
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Focus the existing window when a second instance is launched
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
      const win = windows[0];
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(createWindow);

  app.on('window-all-closed', () => {
    if (updater) {
      updater.dispose();
      updater = null;
    }
    catalogSyncManager = null;

    if (server) {
      server.stop().catch(console.error);
      server = null;
    }
    app.quit();
  });

  app.on('activate', () => {
    // On macOS, re-create the window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch(console.error);
    }
  });
}
