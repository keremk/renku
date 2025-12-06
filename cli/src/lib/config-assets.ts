import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandPath } from './path.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PACKAGE_ROOT = resolve(__dirname, '..', '..');
const CATALOG_SEARCH_ROOTS = [
  resolve(CLI_PACKAGE_ROOT, 'catalog'),
  resolve(CLI_PACKAGE_ROOT, '..', 'catalog'),
];

const BUNDLED_CATALOG_ROOT = resolveBundledCatalogRoot();
const BUNDLED_BLUEPRINTS_ROOT = resolve(BUNDLED_CATALOG_ROOT, 'blueprints');

export function getBundledCatalogRoot(): string {
  return BUNDLED_CATALOG_ROOT;
}

export function getBundledBlueprintsRoot(): string {
  return BUNDLED_BLUEPRINTS_ROOT;
}

export function getCliConfigRoot(cliRoot: string): string {
  return resolve(expandPath(cliRoot), 'config');
}

export function getCliCatalogRoot(cliRoot: string): string {
  return resolve(expandPath(cliRoot), 'catalog');
}

export function getCliBlueprintsRoot(cliRoot: string): string {
  return resolve(getCliCatalogRoot(cliRoot), 'blueprints');
}

export interface ResolveBlueprintOptions {
  cliRoot?: string;
}

export async function copyBundledCatalogAssets(targetRoot: string): Promise<void> {
  await copyDirectory(BUNDLED_CATALOG_ROOT, targetRoot);
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
    const nestedCliPath = await findInBlueprintDirectories(getCliBlueprintsRoot(options.cliRoot), specifier, attempts);
    if (nestedCliPath) {
      return nestedCliPath;
    }
  }

  const bundledPath = resolve(BUNDLED_BLUEPRINTS_ROOT, specifier);
  attempts.push(bundledPath);
  if (await fileExists(bundledPath)) {
    return bundledPath;
  }
  const nestedBundledPath = await findInBlueprintDirectories(BUNDLED_BLUEPRINTS_ROOT, specifier, attempts);
  if (nestedBundledPath) {
    return nestedBundledPath;
  }

  throw new Error(
    `Blueprint "${specifier}" not found. Checked: ${attempts.map((entry) => `"${entry}"`).join(', ')}`,
  );
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
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

async function findInBlueprintDirectories(
  root: string,
  specifier: string,
  attempts: string[],
): Promise<string | null> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const nestedPath = resolve(root, entry.name, specifier);
      attempts.push(nestedPath);
      if (await fileExists(nestedPath)) {
        return nestedPath;
      }
    }
  } catch {
    // ignore missing directories
  }
  return null;
}

function resolveBundledCatalogRoot(): string {
  const attempted: string[] = [];
  for (const root of CATALOG_SEARCH_ROOTS) {
    attempted.push(root);
    if (existsSync(root)) {
      return root;
    }
  }
  throw new Error(
    `Bundled catalog not found. Checked: ${attempted.map((entry) => `"${entry}"`).join(', ')}`,
  );
}
