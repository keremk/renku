import { runInteractiveInputs, type InteractiveInputsResult } from '../interactive/index.js';
import type { CliConfig } from '../lib/cli-config.js';
import type { Logger } from '@gorenku/core';

/**
 * Options for creating an input template.
 */
export interface CreateInputTemplateOptions {
  /** Blueprint specifier (path or catalog reference) */
  blueprint: string;
  /** CLI configuration */
  cliConfig: CliConfig;
  /** Logger instance */
  logger: Logger;
  /** Output directory for the generated file */
  outputDir?: string;
}

/**
 * Run the interactive input template creation flow.
 *
 * This command helps users create an inputs YAML file for a blueprint by:
 * 1. Loading the blueprint and extracting producers
 * 2. Presenting a model selection UI for external producers
 * 3. Gathering blueprint input values
 * 4. Generating a YAML file with the selections
 *
 * Internal producers (renku/*) are automatically configured with blank
 * config templates that users can fill in manually.
 *
 * @param options - Command options
 * @returns Result with success status and file path
 */
export async function runCreateInputTemplate(
  options: CreateInputTemplateOptions,
): Promise<InteractiveInputsResult> {
  return runInteractiveInputs({
    blueprint: options.blueprint,
    cliConfig: options.cliConfig,
    logger: options.logger,
    outputDir: options.outputDir,
  });
}
