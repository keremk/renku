import { access, copyFile, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRuntimeError, RuntimeErrorCode } from '@gorenku/core';

export interface NewBlueprintOptions {
  /** The name of the blueprint (e.g., "history-video") */
  name: string;
  /** The directory to create the blueprint folder in (defaults to cwd) */
  outputDir?: string;
  /** Name of an existing blueprint in the catalog to copy from */
  using?: string;
  /** The catalog root directory (required when using is provided) */
  catalogRoot?: string;
}

export interface NewBlueprintResult {
  /** Path to the created blueprint folder */
  folderPath: string;
  /** Path to the created blueprint YAML file */
  blueprintPath: string;
  /** Path to the created input-template.yaml file */
  inputTemplatePath: string;
  /** Whether the blueprint was copied from the catalog */
  copiedFromCatalog: boolean;
}

/**
 * Converts a kebab-case string to PascalCase.
 * E.g., "history-video" -> "HistoryVideo"
 */
function toPascalCase(str: string): string {
  return str
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('');
}

/**
 * Generates a scaffold blueprint YAML content.
 */
function generateBlueprintYaml(name: string): string {
  const id = toPascalCase(name);
  return `meta:
  name: ${name}
  description: ""
  id: ${id}
  version: 0.1.0
  author: ""
  license: ""

inputs:
  # Define your blueprint inputs here
  # - name: InputName
  #   description: Description of the input
  #   type: string
  #   required: true

artifacts:
  # Define your blueprint artifacts (outputs) here
  # - name: ArtifactName
  #   description: Description of the artifact
  #   type: image

loops:
  # Define iteration loops here
  # - name: segment
  #   countInput: NumOfSegments

producers:
  # Define producers here
  # - name: ProducerName
  #   producer: asset/text-to-image

connections:
  # Wire inputs and outputs between producers
  # - from: InputName
  #   to: ProducerName.Input

collectors:
  # Define collectors for gathering outputs
  # - name: CollectorName
  #   from: Producer[loop].Output
  #   into: TargetProducer.Input
`;
}

/**
 * Generates a scaffold input-template.yaml content.
 */
function generateInputTemplateYaml(): string {
  return `inputs:
  # Define your input values here
  # InputName: "value"

models:
  # Define model configurations for producers
  # - model: gpt-4
  #   provider: openai
  #   producerId: ProducerName
`;
}

/**
 * Recursively copies a directory.
 */
async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await copyFile(sourcePath, targetPath);
    }
  }
}

/**
 * Finds a blueprint folder in the catalog by exact name match.
 */
async function findCatalogBlueprint(catalogRoot: string, blueprintName: string): Promise<string | null> {
  const blueprintsDir = resolve(catalogRoot, 'blueprints');
  const blueprintPath = resolve(blueprintsDir, blueprintName);

  try {
    const stat = await readdir(blueprintPath);
    // Folder exists and is readable
    if (stat.length > 0) {
      return blueprintPath;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Lists available blueprints in the catalog for error suggestions.
 */
async function listAvailableCatalogBlueprints(catalogRoot: string): Promise<string[]> {
  const blueprintsDir = resolve(catalogRoot, 'blueprints');
  try {
    const entries = await readdir(blueprintsDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Finds the main blueprint YAML file in the copied folder.
 * Returns the path to the first .yaml file that isn't input-template.yaml.
 */
async function findBlueprintYamlFile(folderPath: string): Promise<string | null> {
  const entries = await readdir(folderPath);
  const yamlFiles = entries.filter(
    (entry) => entry.endsWith('.yaml') && entry !== 'input-template.yaml',
  );
  if (yamlFiles.length > 0) {
    return resolve(folderPath, yamlFiles[0]);
  }
  return null;
}

/**
 * Renames the blueprint YAML file to match the new blueprint name.
 */
async function renameBlueprintYamlFile(
  folderPath: string,
  newName: string,
): Promise<string> {
  const oldPath = await findBlueprintYamlFile(folderPath);
  const newPath = resolve(folderPath, `${newName}.yaml`);

  if (oldPath && oldPath !== newPath) {
    await rename(oldPath, newPath);
  }

  return newPath;
}

export async function runNewBlueprint(options: NewBlueprintOptions): Promise<NewBlueprintResult> {
  const { name, outputDir, using, catalogRoot } = options;

  if (!name || name.trim() === '') {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      'Blueprint name is required.',
      { suggestion: 'Provide a blueprint name as the first argument.' },
    );
  }

  // Validate name format (should be kebab-case or simple alphanumeric)
  if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(name)) {
    throw createRuntimeError(
      RuntimeErrorCode.INVALID_INPUT_VALUE,
      'Blueprint name must be in kebab-case (e.g., "history-video", "my-blueprint"). ' +
        'Start with a lowercase letter, use only lowercase letters, numbers, and hyphens.',
      { suggestion: 'Use a name like "my-blueprint" or "history-video".' },
    );
  }

  // Validate --using requires catalog root
  if (using && !catalogRoot) {
    throw createRuntimeError(
      RuntimeErrorCode.MISSING_REQUIRED_INPUT,
      'Catalog root is required when using --using flag.',
      { suggestion: 'Initialize Renku first with "renku init --root=<path>".' },
    );
  }

  const baseDir = outputDir ?? process.cwd();
  const folderPath = resolve(baseDir, name);

  // Check if folder already exists
  try {
    await access(folderPath);
    throw createRuntimeError(
      RuntimeErrorCode.STORAGE_PATH_ESCAPE,
      `Folder "${name}" already exists at ${folderPath}.`,
      { suggestion: 'Choose a different name or remove the existing folder.' },
    );
  } catch (error) {
    // Folder doesn't exist, which is what we want
    if ((error as { code?: string }).code !== 'ENOENT') {
      throw error;
    }
  }

  // If using a catalog blueprint, copy it
  if (using && catalogRoot) {
    const sourcePath = await findCatalogBlueprint(catalogRoot, using);
    if (!sourcePath) {
      const availableBlueprints = await listAvailableCatalogBlueprints(catalogRoot);
      const suggestion =
        availableBlueprints.length > 0
          ? `Available blueprints: ${availableBlueprints.join(', ')}`
          : 'No blueprints found in the catalog. Run "renku update" to sync the catalog.';

      throw createRuntimeError(
        RuntimeErrorCode.CATALOG_BLUEPRINT_NOT_FOUND,
        `Blueprint "${using}" not found in the catalog.`,
        { suggestion },
      );
    }

    // Copy the entire blueprint folder
    await copyDirectory(sourcePath, folderPath);

    // Rename the blueprint YAML file to match the new name
    const blueprintPath = await renameBlueprintYamlFile(folderPath, name);
    const inputTemplatePath = resolve(folderPath, 'input-template.yaml');

    return {
      folderPath,
      blueprintPath,
      inputTemplatePath,
      copiedFromCatalog: true,
    };
  }

  // Create scaffold files
  await mkdir(folderPath, { recursive: true });

  // Create the blueprint YAML file
  const blueprintPath = resolve(folderPath, `${name}.yaml`);
  const blueprintContent = generateBlueprintYaml(name);
  await writeFile(blueprintPath, blueprintContent, 'utf8');

  // Create the input-template.yaml file
  const inputTemplatePath = resolve(folderPath, 'input-template.yaml');
  const inputTemplateContent = generateInputTemplateYaml();
  await writeFile(inputTemplatePath, inputTemplateContent, 'utf8');

  return {
    folderPath,
    blueprintPath,
    inputTemplatePath,
    copiedFromCatalog: false,
  };
}
