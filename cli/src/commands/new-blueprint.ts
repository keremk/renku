import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
	assertValidBlueprintName,
	createBlueprintFromTemplate,
	createRuntimeError,
	RuntimeErrorCode,
} from '@gorenku/core';

const DEFAULT_BLUEPRINT_TEMPLATE = 'boilerplate';

export interface NewBlueprintOptions {
	/** The name of the blueprint (e.g., "history-video") */
	name: string;
	/** The directory to create the blueprint folder in (defaults to cwd) */
	outputDir?: string;
	/** Name of an existing blueprint in the catalog to copy from */
	using?: string;
	/** The catalog root directory used to resolve the default boilerplate or an explicit template */
	catalogRoot?: string;
}

export interface NewBlueprintResult {
	/** Path to the created blueprint folder */
	folderPath: string;
	/** Path to the created blueprint YAML file */
	blueprintPath: string;
	/** Path to the created input-template.yaml file */
	inputTemplatePath: string;
	/** Whether the blueprint was copied from an explicitly selected catalog template */
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

async function rewriteBlueprintIdentity(
	blueprintPath: string,
	blueprintName: string
): Promise<void> {
	const blueprintContent = await readFile(blueprintPath, 'utf8');
	const parsed = parseYaml(blueprintContent) as
		| {
				meta?: {
					name?: string;
					id?: string;
				};
		  }
		| null;

	if (!parsed?.meta) {
		throw createRuntimeError(
			RuntimeErrorCode.INVALID_INPUT_VALUE,
			`Blueprint template at ${blueprintPath} is missing a meta section.`,
			{
				suggestion:
					'Fix the boilerplate catalog blueprint so it declares meta.name and meta.id.',
			}
		);
	}

	parsed.meta.name = blueprintName;
	parsed.meta.id = toPascalCase(blueprintName);

	await writeFile(blueprintPath, stringifyYaml(parsed), 'utf8');
}

export async function runNewBlueprint(
	options: NewBlueprintOptions
): Promise<NewBlueprintResult> {
	const { name, outputDir, using, catalogRoot } = options;
	const normalizedName = name.trim();
	const templateName = using?.trim() || DEFAULT_BLUEPRINT_TEMPLATE;

	assertValidBlueprintName(normalizedName);

	if (!catalogRoot) {
		throw createRuntimeError(
			RuntimeErrorCode.MISSING_REQUIRED_INPUT,
			'Catalog root is required when creating a blueprint.',
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

	const created = await createBlueprintFromTemplate({
		blueprintName: normalizedName,
		templateName,
		outputDir: baseDir,
		catalogRoot,
	});

	if (!using) {
		await rewriteBlueprintIdentity(created.blueprintPath, normalizedName);
	}

	return {
		folderPath: created.folderPath,
		blueprintPath: created.blueprintPath,
		inputTemplatePath: created.inputTemplatePath,
		copiedFromCatalog: Boolean(using),
	};
}
