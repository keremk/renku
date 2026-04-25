import { existsSync, readdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

export type CatalogProducerResolution =
  | {
      status: 'found';
      path: string;
      attempted: string[];
    }
  | {
      status: 'notFound';
      attempted: string[];
    }
  | {
      status: 'invalidFolder';
      attempted: string[];
      message: string;
    };

export interface CatalogProducerEntrypoint {
  path: string;
  qualifiedName: string;
}

export function resolveCatalogProducerPath(
  producersRoot: string,
  qualifiedName: string
): CatalogProducerResolution {
  const directPath = resolve(producersRoot, `${qualifiedName}.yaml`);
  const folderPath = resolve(producersRoot, qualifiedName);
  const name = qualifiedName.split('/').at(-1);
  const nestedPath = name ? resolve(folderPath, `${name}.yaml`) : folderPath;
  const attempted = [directPath, nestedPath];

  if (existsSync(directPath)) {
    return { status: 'found', path: directPath, attempted };
  }

  if (existsSync(nestedPath)) {
    return { status: 'found', path: nestedPath, attempted };
  }

  if (!existsSync(folderPath)) {
    return { status: 'notFound', attempted };
  }

  const yamlFiles = readdirSync(folderPath, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && extname(entry.name).toLowerCase() === '.yaml'
    )
    .map((entry) => entry.name)
    .sort();

  if (yamlFiles.length === 0) {
    return {
      status: 'invalidFolder',
      attempted,
      message: `Producer folder "${folderPath}" must contain entrypoint "${name}.yaml".`,
    };
  }

  return {
    status: 'invalidFolder',
    attempted,
    message:
      `Producer folder "${folderPath}" has top-level YAML files (${yamlFiles.join(', ')}), ` +
      `but the entrypoint must be named "${name}.yaml".`,
  };
}

export async function listCatalogProducerEntrypoints(
  producersRoot: string
): Promise<CatalogProducerEntrypoint[]> {
  const entries = await listCatalogProducerEntrypointsInDirectory(
    producersRoot,
    producersRoot
  );
  return entries.sort((left, right) =>
    left.qualifiedName.localeCompare(right.qualifiedName)
  );
}

async function listCatalogProducerEntrypointsInDirectory(
  root: string,
  directory: string
): Promise<CatalogProducerEntrypoint[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const results: CatalogProducerEntrypoint[] = [];

  for (const entry of entries) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.yaml') {
      results.push({
        path: fullPath,
        qualifiedName: qualifiedNameForEntrypoint(root, fullPath),
      });
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    const packageEntrypoint = resolve(fullPath, `${entry.name}.yaml`);
    if (existsSync(packageEntrypoint)) {
      results.push({
        path: packageEntrypoint,
        qualifiedName: qualifiedNameForEntrypoint(root, packageEntrypoint),
      });
      continue;
    }

    results.push(
      ...(await listCatalogProducerEntrypointsInDirectory(root, fullPath))
    );
  }

  return results;
}

function qualifiedNameForEntrypoint(root: string, entrypointPath: string): string {
  const relativePath = entrypointPath
    .slice(resolve(root).length + 1)
    .replace(/\\/g, '/')
    .replace(/\.yaml$/, '');
  const parts = relativePath.split('/');
  if (parts.length >= 2 && parts.at(-1) === parts.at(-2)) {
    return parts.slice(0, -1).join('/');
  }
  return relativePath;
}
