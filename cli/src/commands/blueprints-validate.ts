import { isAbsolute, resolve } from 'node:path';
import { loadBlueprintBundle } from '../lib/blueprint-loader/index.js';
import { expandPath } from '../lib/path.js';
import {
	buildBlueprintGraph,
	validateBlueprintTree,
	type ValidationIssue,
} from '@gorenku/core';
import { getDefaultCliConfigPath, readCliConfig } from '../lib/cli-config.js';

export interface BlueprintsValidateOptions {
	blueprintPath: string;
	errorsOnly?: boolean;
}

export interface BlueprintsValidateResult {
	valid: boolean;
	path: string;
	name?: string;
	error?: string;
	errors?: ValidationIssue[];
	warnings?: ValidationIssue[];
	nodeCount?: number;
	edgeCount?: number;
}

export async function runBlueprintsValidate(
	options: BlueprintsValidateOptions
): Promise<BlueprintsValidateResult> {
	try {
		const expandedPath = resolvePathFromInput(options.blueprintPath);
		const cliConfig = await readCliConfig(getDefaultCliConfigPath());
		const catalogRoot = cliConfig?.catalog?.root ?? undefined;

		const { root } = await loadBlueprintBundle(expandedPath, { catalogRoot });
		const validation = validateBlueprintTree(root, {
			errorsOnly: options.errorsOnly,
		});

		if (!validation.valid) {
			return {
				valid: false,
				path: expandedPath,
				name: root.document.meta.name,
				errors: validation.errors,
				warnings: validation.warnings,
				error: validation.errors[0]?.message,
			};
		}

		const graph = buildBlueprintGraph(root);
		return {
			valid: true,
			path: expandedPath,
			name: root.document.meta.name,
			nodeCount: graph.nodes.length,
			edgeCount: graph.edges.length,
			warnings:
				validation.warnings.length > 0 ? validation.warnings : undefined,
		};
	} catch (error) {
		return {
			valid: false,
			path: resolvePathFromInput(options.blueprintPath),
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function resolvePathFromInput(inputPath: string, baseDir?: string): string {
	const expanded = expandPath(inputPath);
	if (isAbsolute(expanded)) {
		return resolve(expanded);
	}
	return resolve(baseDir ?? process.cwd(), expanded);
}
