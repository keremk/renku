import { resolve } from 'node:path';
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
  /** Skip warning-level validations */
  errorsOnly?: boolean;
}

export interface BlueprintsValidateResult {
  valid: boolean;
  path: string;
  name?: string;
  /** Legacy error string for backwards compatibility */
  error?: string;
  /** Validation errors found */
  errors?: ValidationIssue[];
  /** Validation warnings found */
  warnings?: ValidationIssue[];
  nodeCount?: number;
  edgeCount?: number;
}

export async function runBlueprintsValidate(
  options: BlueprintsValidateOptions,
): Promise<BlueprintsValidateResult> {
  try {
    const expandedPath = resolve(expandPath(options.blueprintPath));
    const cliConfig = await readCliConfig(getDefaultCliConfigPath());
    const catalogRoot = cliConfig?.catalog?.root ?? undefined;

    // Step 1: Parse blueprint tree
    const { root } = await loadBlueprintBundle(expandedPath, { catalogRoot });

    // Step 2: Validate blueprint tree
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
        // Also set legacy error field with first error message
        error: validation.errors[0]?.message,
      };
    }

    // Step 3: Build graph (only if validation passes)
    const graph = buildBlueprintGraph(root);

    return {
      valid: true,
      path: expandedPath,
      name: root.document.meta.name,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      warnings: validation.warnings.length > 0 ? validation.warnings : undefined,
    };
  } catch (error) {
    return {
      valid: false,
      path: resolve(options.blueprintPath),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
