/**
 * Installs the `renku` CLI wrapper to /usr/local/bin/renku
 * so users can invoke `renku` from any terminal session.
 *
 * Follows the same pattern as VS Code's "Install 'code' command in PATH".
 */

import { app } from 'electron';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const INSTALL_TARGET = '/usr/local/bin/renku';

/**
 * Check if the CLI wrapper is already installed at the target path.
 */
export async function isCliInstalled(): Promise<boolean> {
  return existsSync(INSTALL_TARGET);
}

/**
 * Get the path to the wrapper script bundled in the app resources.
 */
function getWrapperScriptPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'renku-wrapper.sh');
  }
  return path.join(app.getAppPath(), 'scripts', 'renku-wrapper.sh');
}

/**
 * Install the renku CLI wrapper to /usr/local/bin/renku.
 *
 * Uses osascript to prompt for administrator privileges on macOS,
 * since /usr/local/bin may require sudo access.
 */
export async function installCli(): Promise<void> {
  const wrapperPath = getWrapperScriptPath();

  if (!existsSync(wrapperPath)) {
    throw new Error(`Wrapper script not found at ${wrapperPath}`);
  }

  // Create /usr/local/bin if it doesn't exist, copy wrapper, make executable
  const commands = [
    `mkdir -p /usr/local/bin`,
    `cp "${wrapperPath}" "${INSTALL_TARGET}"`,
    `chmod +x "${INSTALL_TARGET}"`,
  ].join(' && ');

  await runWithPrivileges(commands);
}

/**
 * Run a shell command with administrator privileges using osascript.
 */
function runWithPrivileges(command: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const escaped = command.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const script = `do shell script "${escaped}" with administrator privileges`;

    execFile('osascript', ['-e', script], (error, _stdout, stderr) => {
      if (error) {
        // User cancelled the auth dialog
        if (stderr.includes('User canceled') || error.code === 1) {
          reject(new Error('Installation cancelled by user.'));
          return;
        }
        reject(new Error(`Installation failed: ${error.message}`));
        return;
      }
      resolve();
    });
  });
}
