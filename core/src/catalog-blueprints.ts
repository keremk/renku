import { access, copyFile, mkdir, readdir, rename } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createRuntimeError, RuntimeErrorCode } from './errors/index.js';
import { parseYamlBlueprintFile } from './parsing/blueprint-loader/yaml-parser.js';

const BLUEPRINT_NAME_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const INPUT_TEMPLATE_FILENAME = 'input-template.yaml';

export interface CatalogBlueprintTemplate {
  /** Folder name under catalog/blueprints (e.g., "ken-burns-documentary") */
  name: string;
  /** Human title from blueprint meta.name */
  title: string;
  /** Description from blueprint meta.description */
  description: string;
}

export interface CreateBlueprintFromTemplateOptions {
  /** New blueprint folder name (kebab-case) */
  blueprintName: string;
  /** Catalog template folder name */
  templateName: string;
  /** Target parent directory where the blueprint folder will be created */
  outputDir: string;
  /** Catalog root path (contains blueprints/) */
  catalogRoot: string;
}

export interface CreateBlueprintFromTemplateResult {
  folderPath: string;
  blueprintPath: string;
  inputTemplatePath: string;
}

/**
 * Validates blueprint folder naming rules.
 */
export function assertValidBlueprintName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      'Blueprint name is required.',
      { suggestion: 'Provide a blueprint name as the first argument.' }
    );
  }

  if (!BLUEPRINT_NAME_PATTERN.test(trimmed)) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_INPUT_VALUE,
      'Blueprint name must be in kebab-case (e.g., "history-video", "my-blueprint"). Start with a lowercase letter and use only lowercase letters, numbers, and hyphens.',
      { suggestion: 'Use a name like "my-blueprint" or "history-video".' }
    );
  }
}

/**
 * Lists available catalog templates under {catalogRoot}/blueprints.
 */
export async function listCatalogBlueprintTemplates(
  catalogRoot: string
): Promise<CatalogBlueprintTemplate[]> {
  const blueprintsRoot = resolve(catalogRoot, 'blueprints');
  const entries = await readBlueprintDirectories(blueprintsRoot);

  const templates: CatalogBlueprintTemplate[] = [];

  for (const entry of entries) {
    const templateFolder = resolve(blueprintsRoot, entry.name);
    const blueprintPath = await resolveTemplateBlueprintPath(templateFolder);
    const inputTemplatePath = resolve(templateFolder, INPUT_TEMPLATE_FILENAME);

    await assertPathExists(
      inputTemplatePath,
      RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
      `Catalog template "${entry.name}" is missing ${INPUT_TEMPLATE_FILENAME}.`,
      `Expected file at: ${inputTemplatePath}`
    );

    const document = await parseYamlBlueprintFile(blueprintPath);
    templates.push({
      name: entry.name,
      title: document.meta.name,
      description: document.meta.description ?? '',
    });
  }

  templates.sort((a, b) => a.name.localeCompare(b.name));
  return templates;
}

/**
 * Copies a catalog blueprint template into a new blueprint folder.
 */
export async function createBlueprintFromTemplate(
  options: CreateBlueprintFromTemplateOptions
): Promise<CreateBlueprintFromTemplateResult> {
  const normalizedBlueprintName = options.blueprintName.trim();
  const normalizedTemplateName = options.templateName.trim();

  assertValidBlueprintName(normalizedBlueprintName);

  if (normalizedTemplateName.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      'Template name is required.',
      { suggestion: 'Select a catalog template before creating a blueprint.' }
    );
  }

  const blueprintsRoot = resolve(options.catalogRoot, 'blueprints');
  const templateFolder = resolve(blueprintsRoot, normalizedTemplateName);
  const templateRelativePath = relative(blueprintsRoot, templateFolder);

  if (
    isRelativePathOutsideRoot(templateRelativePath) ||
    templateRelativePath !== normalizedTemplateName
  ) {
    throw createRuntimeError(
      RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
      `Blueprint "${normalizedTemplateName}" not found in the catalog.`,
      {
        suggestion: await buildCatalogTemplateSuggestion(blueprintsRoot),
        context: `Rejected template path "${normalizedTemplateName}" resolved to "${templateFolder}" (relative: "${templateRelativePath}").`,
      }
    );
  }

  await assertDirectoryExists(
    templateFolder,
    RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
    `Blueprint "${normalizedTemplateName}" not found in the catalog.`,
    await buildCatalogTemplateSuggestion(blueprintsRoot)
  );

  const sourceBlueprintPath =
    await resolveTemplateBlueprintPath(templateFolder);
  const sourceInputTemplatePath = resolve(
    templateFolder,
    INPUT_TEMPLATE_FILENAME
  );

  await assertPathExists(
    sourceInputTemplatePath,
    RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
    `Catalog template "${normalizedTemplateName}" is missing ${INPUT_TEMPLATE_FILENAME}.`,
    `Expected file at: ${sourceInputTemplatePath}`
  );

  const outputRoot = resolve(options.outputDir);
  const folderPath = resolve(outputRoot, normalizedBlueprintName);

  if (await pathExists(folderPath)) {
    throw createRuntimeError(
      RuntimeErrorCode.STORAGE_PATH_ESCAPE,
      `Folder "${normalizedBlueprintName}" already exists at ${folderPath}.`,
      { suggestion: 'Choose a different name or remove the existing folder.' }
    );
  }

  await copyDirectory(templateFolder, folderPath);

  const copiedBlueprintPath = resolve(
    folderPath,
    relative(templateFolder, sourceBlueprintPath)
  );
  const blueprintPath = resolve(folderPath, `${normalizedBlueprintName}.yaml`);

  if (copiedBlueprintPath !== blueprintPath) {
    await rename(copiedBlueprintPath, blueprintPath);
  }

  return {
    folderPath,
    blueprintPath,
    inputTemplatePath: resolve(folderPath, INPUT_TEMPLATE_FILENAME),
  };
}

async function readBlueprintDirectories(blueprintsRoot: string) {
  try {
    const entries = await readdir(blueprintsRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory());
  } catch {
    throw createRuntimeError(
      RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
      `Catalog blueprints directory not found: ${blueprintsRoot}`,
      {
        suggestion:
          'Initialize or update the catalog so blueprints are available.',
      }
    );
  }
}

async function resolveTemplateBlueprintPath(
  templateFolder: string
): Promise<string> {
  const entries = await readdir(templateFolder, { withFileTypes: true });
  const yamlFiles = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.yaml') &&
        entry.name !== INPUT_TEMPLATE_FILENAME
    )
    .map((entry) => entry.name);

  if (yamlFiles.length === 0) {
    throw createRuntimeError(
      RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
      `Template folder ${templateFolder} does not contain a blueprint YAML file.`,
      {
        suggestion:
          'Expected exactly one top-level .yaml file (excluding input-template.yaml).',
      }
    );
  }

  if (yamlFiles.length > 1) {
    throw createRuntimeError(
      RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
      `Template folder ${templateFolder} has multiple top-level blueprint YAML files: ${yamlFiles.join(', ')}`,
      {
        suggestion:
          'Keep exactly one top-level .yaml file per template folder.',
      }
    );
  }

  return resolve(templateFolder, yamlFiles[0]);
}

async function assertDirectoryExists(
  targetPath: string,
  code: string,
  message: string,
  suggestion?: string
): Promise<void> {
  try {
    await readdir(targetPath);
  } catch {
    throw createRuntimeError(code, message, { suggestion });
  }
}

async function assertPathExists(
  targetPath: string,
  code: string,
  message: string,
  suggestion?: string
): Promise<void> {
  if (!(await pathExists(targetPath))) {
    throw createRuntimeError(code, message, { suggestion });
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isRelativePathOutsideRoot(relativePath: string): boolean {
  return (
    isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith('../') ||
    relativePath.startsWith('..\\')
  );
}

async function buildCatalogTemplateSuggestion(
  blueprintsRoot: string
): Promise<string> {
  try {
    const entries = await readdir(blueprintsRoot, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    if (names.length === 0) {
      return 'No templates found in catalog/blueprints. Run "renku update" to sync the catalog.';
    }
    return `Available templates: ${names.join(', ')}`;
  } catch {
    return `Expected templates under: ${blueprintsRoot}`;
  }
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
    if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}
