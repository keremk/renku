import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandPath } from './path.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_ROOT = resolve(__dirname, '../../config');
const CONFIG_BLUEPRINTS_ROOT = resolve(CONFIG_ROOT, 'blueprints');

export function getBundledConfigRoot(): string {
  return CONFIG_ROOT;
}

export function getBundledBlueprintsRoot(): string {
  return CONFIG_BLUEPRINTS_ROOT;
}

export function getCliConfigRoot(cliRoot: string): string {
  return resolve(expandPath(cliRoot), 'config');
}

export function getCliBlueprintsRoot(cliRoot: string): string {
  return resolve(getCliConfigRoot(cliRoot), 'blueprints');
}

export interface ResolveBlueprintOptions {
  cliRoot?: string;
}

export async function copyBundledConfigAssets(targetRoot: string): Promise<void> {
  await copyDirectory(CONFIG_ROOT, targetRoot);
}

export async function resolveBlueprintSpecifier(
  specifier: string,
  options: ResolveBlueprintOptions = {},
): Promise<string> {
  if (!specifier || specifier.trim().length === 0) {
    throw new Error('Blueprint path cannot be empty.');
  }

  const attempts: string[] = [];

  const expanded = expandPath(specifier);
  attempts.push(expanded);
  if (await fileExists(expanded)) {
    return expanded;
  }

  if (options.cliRoot) {
    const cliBlueprint = resolve(getCliBlueprintsRoot(options.cliRoot), specifier);
    attempts.push(cliBlueprint);
    if (await fileExists(cliBlueprint)) {
      return cliBlueprint;
    }

    const legacyBlueprint = resolve(expandPath(options.cliRoot), 'blueprints', specifier);
    attempts.push(legacyBlueprint);
    if (await fileExists(legacyBlueprint)) {
      return legacyBlueprint;
    }
  }

  const bundledPath = resolve(CONFIG_BLUEPRINTS_ROOT, specifier);
  attempts.push(bundledPath);
  if (await fileExists(bundledPath)) {
    return bundledPath;
  }

  throw new Error(
    `Blueprint "${specifier}" not found. Checked: ${attempts.map((entry) => `"${entry}"`).join(', ')}`,
  );
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    // Skip viewer directory
    if (entry.isDirectory() && entry.name === 'viewer') {
      continue;
    }
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (await fileExists(targetPath)) {
      continue;
    }
    await copyFile(sourcePath, targetPath);
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
