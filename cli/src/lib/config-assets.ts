import { existsSync, statSync } from 'node:fs';
import { copyFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandPath } from './path.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PACKAGE_ROOT = resolve(__dirname, '..', '..');
const CATALOG_SEARCH_ROOTS = [
	resolve(CLI_PACKAGE_ROOT, '..', 'catalog'),
	resolve(CLI_PACKAGE_ROOT, 'catalog'),
];
const REQUIRED_CATALOG_DIRECTORIES = [
	'blueprints',
	'models',
	'producers',
] as const;

const BUNDLED_CATALOG_ROOT = resolveBundledCatalogRoot();

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

export interface BundledCatalogAssetsOptions {
	sourceRoot?: string;
}

export async function copyBundledCatalogAssets(
	targetRoot: string,
	options: BundledCatalogAssetsOptions = {}
): Promise<void> {
	const sourceRoot = options.sourceRoot ?? BUNDLED_CATALOG_ROOT;
	await copyDirectory(sourceRoot, targetRoot);
}

export async function updateBundledCatalogAssets(
	targetRoot: string,
	options: BundledCatalogAssetsOptions = {}
): Promise<void> {
	const sourceRoot = options.sourceRoot ?? BUNDLED_CATALOG_ROOT;
	await copyDirectory(sourceRoot, targetRoot, { overwrite: true });
}

export async function catalogExists(catalogRoot: string): Promise<boolean> {
	try {
		const entries = await readdir(catalogRoot);
		return entries.length > 0;
	} catch {
		return false;
	}
}

export async function isValidWorkspace(rootFolder: string): Promise<boolean> {
	const catalogRoot = getCliCatalogRoot(rootFolder);
	return catalogExists(catalogRoot);
}

export async function resolveBlueprintSpecifier(
	specifier: string,
	options: ResolveBlueprintOptions = {}
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
		const cliBlueprint = resolve(
			getCliBlueprintsRoot(options.cliRoot),
			specifier
		);
		attempts.push(cliBlueprint);
		if (await fileExists(cliBlueprint)) {
			return cliBlueprint;
		}
		const nestedCliPath = await findInBlueprintDirectories(
			getCliBlueprintsRoot(options.cliRoot),
			specifier,
			attempts
		);
		if (nestedCliPath) {
			return nestedCliPath;
		}
	}

	throw new Error(
		`Blueprint "${specifier}" not found. Checked: ${attempts.map((entry) => `"${entry}"`).join(', ')}`
	);
}

interface CopyDirectoryOptions {
	overwrite?: boolean;
}

async function copyDirectory(
	source: string,
	target: string,
	options?: CopyDirectoryOptions
): Promise<void> {
	const { overwrite = false } = options ?? {};
	await mkdir(target, { recursive: true });
	const entries = await readdir(source, { withFileTypes: true });
	for (const entry of entries) {
		const sourcePath = join(source, entry.name);
		const targetPath = join(target, entry.name);
		if (entry.isDirectory()) {
			await copyDirectory(sourcePath, targetPath, options);
			continue;
		}
		if (!entry.isFile()) {
			continue;
		}
		if (!overwrite && (await fileExists(targetPath))) {
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
	attempts: string[]
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
		if (isValidCatalogRoot(root)) {
			return root;
		}
	}
	throw new Error(
		`Bundled catalog not found. Checked: ${attempted.map((entry) => `"${entry}"`).join(', ')}. Each candidate must include ${REQUIRED_CATALOG_DIRECTORIES.join(', ')} directories.`
	);
}

function isValidCatalogRoot(catalogRoot: string): boolean {
	if (!isDirectory(catalogRoot)) {
		return false;
	}
	return REQUIRED_CATALOG_DIRECTORIES.every((directory) =>
		isDirectory(resolve(catalogRoot, directory))
	);
}

function isDirectory(path: string): boolean {
	if (!existsSync(path)) {
		return false;
	}
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}
