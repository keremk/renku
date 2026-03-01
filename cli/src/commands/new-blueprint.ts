import { access, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
	assertValidBlueprintName,
	createBlueprintFromTemplate,
	createRuntimeError,
	RuntimeErrorCode,
} from '@gorenku/core';

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
  # Wire inputs and outputs between producers.
  # For fanIn inputs, add optional groupBy/orderBy here when inference is ambiguous.
  # - from: InputName
  #   to: ProducerName.Input
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

export async function runNewBlueprint(
	options: NewBlueprintOptions
): Promise<NewBlueprintResult> {
	const { name, outputDir, using, catalogRoot } = options;
	const normalizedName = name.trim();

	assertValidBlueprintName(normalizedName);

	// Validate --using requires catalog root
	if (using && !catalogRoot) {
		throw createRuntimeError(
			RuntimeErrorCode.MISSING_REQUIRED_INPUT,
			'Catalog root is required when using --using flag.',
			{ suggestion: 'Initialize Renku first with "renku init --root=<path>".' }
		);
	}

	const baseDir = outputDir ?? process.cwd();
	const folderPath = resolve(baseDir, normalizedName);

	// Check if folder already exists
	try {
		await access(folderPath);
		throw createRuntimeError(
			RuntimeErrorCode.STORAGE_PATH_ESCAPE,
			`Folder "${normalizedName}" already exists at ${folderPath}.`,
			{ suggestion: 'Choose a different name or remove the existing folder.' }
		);
	} catch (error) {
		// Folder doesn't exist, which is what we want
		if ((error as { code?: string }).code !== 'ENOENT') {
			throw error;
		}
	}

	// If using a catalog blueprint, copy it
	if (using && catalogRoot) {
		const created = await createBlueprintFromTemplate({
			blueprintName: normalizedName,
			templateName: using,
			outputDir: baseDir,
			catalogRoot,
		});

		return {
			folderPath: created.folderPath,
			blueprintPath: created.blueprintPath,
			inputTemplatePath: created.inputTemplatePath,
			copiedFromCatalog: true,
		};
	}

	// Create scaffold files
	await mkdir(folderPath, { recursive: true });

	// Create the blueprint YAML file
	const blueprintPath = resolve(folderPath, `${normalizedName}.yaml`);
	const blueprintContent = generateBlueprintYaml(normalizedName);
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
