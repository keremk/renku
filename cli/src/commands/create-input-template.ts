import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import {
  runInteractiveInputs,
  runProducerInteractiveInputs,
  type InteractiveInputsResult,
} from '../interactive/index.js';
import { resolveBlueprintSpecifier } from '../lib/config-assets.js';
import type { CliConfig } from '../lib/cli-config.js';
import type { Logger } from '@gorenku/core';

/**
 * Options for creating an input template.
 */
export interface CreateInputTemplateOptions {
  /** Blueprint or producer specifier (path or catalog reference) */
  blueprint: string;
  /** CLI configuration */
  cliConfig: CliConfig;
  /** Logger instance */
  logger: Logger;
  /** Output directory for the generated file */
  outputDir?: string;
}

/**
 * Check if a YAML file is a producer (meta.kind === 'producer').
 */
async function isProducerFile(filePath: string): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf8');
    const parsed = parseYaml(content) as Record<string, unknown>;
    const meta = parsed?.meta as Record<string, unknown> | undefined;
    return meta?.kind === 'producer';
  } catch {
    return false;
  }
}

/**
 * Run the interactive input template creation flow.
 *
 * This command helps users create an inputs YAML file for either:
 *
 * **For Blueprints (meta.kind === 'blueprint' or unspecified):**
 * 1. Loading the blueprint and extracting producers
 * 2. Presenting a model selection UI for external producers
 * 3. Gathering blueprint input values
 * 4. Generating a YAML file with the selections
 *
 * **For Producers (meta.kind === 'producer'):**
 * 1. Detecting producer vs blueprint files
 * 2. Presenting model selection from producer's mappings section
 * 3. Loading JSON schema for the selected model
 * 4. Showing required inputs first, then optional ones
 * 5. Presenting "config" section for schema properties not in producer inputs
 * 6. Generating a YAML file with inputs and config
 *
 * @param options - Command options
 * @returns Result with success status and file path
 */
export async function runCreateInputTemplate(
  options: CreateInputTemplateOptions,
): Promise<InteractiveInputsResult> {
  const { blueprint: specifier, cliConfig, logger, outputDir } = options;

  try {
    // Resolve the file path
    const filePath = await resolveBlueprintSpecifier(specifier, {
      cliRoot: cliConfig.storage.root,
    });

    // Check if it's a producer or blueprint
    const isProducer = await isProducerFile(filePath);

    if (isProducer) {
      logger.info('Detected producer YAML file. Running producer input setup...');
      return runProducerInteractiveInputs({
        producerPath: filePath,
        cliConfig,
        logger,
        outputDir,
      });
    }

    // It's a blueprint - use the existing flow
    return runInteractiveInputs({
      blueprint: specifier,
      cliConfig,
      logger,
      outputDir,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to process file: ${message}`);
    return {
      success: false,
      error: message,
    };
  }
}
