import { writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import {
	analyzeConditions,
	buildBlueprintValidationCases,
	conditionAnalysisToVaryingHints,
	createBlueprintValidationScenarioFile,
	stringifyBlueprintValidationScenario,
} from '@gorenku/core';
import { loadBlueprintBundle } from '../lib/blueprint-loader/index.js';
import { getDefaultCliConfigPath, readCliConfig } from '../lib/cli-config.js';
import { expandPath } from '../lib/path.js';

export interface BlueprintsDryRunProfileOptions {
	blueprintPath: string;
	outputPath?: string;
}

export interface BlueprintsDryRunProfileResult {
	blueprintPath: string;
	outputPath: string;
	conditionFieldCount: number;
	caseCount: number;
}

export async function runBlueprintsDryRunProfile(
	options: BlueprintsDryRunProfileOptions
): Promise<BlueprintsDryRunProfileResult> {
	const blueprintPath = resolvePathFromInput(options.blueprintPath);
	const outputPath = options.outputPath
		? resolvePathFromInput(options.outputPath)
		: deriveDefaultOutputPath(blueprintPath);

	const cliConfig = await readCliConfig(getDefaultCliConfigPath());
	const catalogRoot = cliConfig?.catalog?.root ?? undefined;
	const { root } = await loadBlueprintBundle(blueprintPath, { catalogRoot });

	const conditionAnalysis = analyzeConditions(root.document);
	const varyingHints = conditionAnalysisToVaryingHints(conditionAnalysis);
	const cases = buildBlueprintValidationCases({
		baseVaryingHints: varyingHints,
	});

	const scenario = createBlueprintValidationScenarioFile({
		blueprintPath,
		cases,
		seed: 0,
	});
	const serialized = stringifyBlueprintValidationScenario(scenario, outputPath);
	await writeFile(outputPath, serialized, 'utf8');

	return {
		blueprintPath,
		outputPath,
		conditionFieldCount: conditionAnalysis.conditionFields.length,
		caseCount: cases.length,
	};
}

function deriveDefaultOutputPath(blueprintPath: string): string {
	const extension = extname(blueprintPath);
	const filename = basename(blueprintPath, extension);
	const parentDir = dirname(blueprintPath);
	return resolve(parentDir, `${filename}.dry-run-profile.yaml`);
}

function resolvePathFromInput(inputPath: string, baseDir?: string): string {
	const expanded = expandPath(inputPath);
	if (isAbsolute(expanded)) {
		return resolve(expanded);
	}
	return resolve(baseDir ?? process.cwd(), expanded);
}
