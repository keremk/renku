import React from 'react';
import { render } from 'ink';
import { resolve } from 'node:path';
import {
  loadModelCatalog,
  createProviderRegistry,
  type LoadedModelCatalog,
} from '@gorenku/providers';
import type { BlueprintTreeNode, Logger } from '@gorenku/core';
import { loadBlueprintBundle } from '../lib/blueprint-loader/index.js';
import { resolveBlueprintSpecifier } from '../lib/config-assets.js';
import type { CliConfig } from '../lib/cli-config.js';
import {
  extractProducers,
  extractCompositionProducers,
  type ExtractedCompositionProducer,
} from './utils/producer-extractor.js';
import { loadAllAssetModels, type AssetModelOption } from './utils/asset-model-loader.js';
import { detectAvailableProviders } from './utils/api-key-detector.js';
import {
  writeInputsYaml,
  generateTimelineConfigTemplate,
  type InputsYamlData,
  type CompositionModelInput,
} from './utils/yaml-writer.js';
import { blueprintInputsToFields } from './utils/schema-to-fields.js';
import { InteractiveApp } from './components/interactive-app.js';

/**
 * Options for running interactive input gathering.
 */
export interface InteractiveInputsOptions {
  /** Blueprint specifier (path or catalog reference) */
  blueprint: string;
  /** CLI configuration */
  cliConfig: CliConfig;
  /** Logger instance */
  logger: Logger;
  /** Output directory for the generated file (defaults to cwd) */
  outputDir?: string;
}

/**
 * Result of interactive input gathering.
 */
export interface InteractiveInputsResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Path to the generated inputs file (if successful) */
  inputsPath?: string;
  /** Whether the user cancelled */
  cancelled?: boolean;
  /** Error message (if failed) */
  error?: string;
}

/**
 * Run the interactive input gathering flow.
 *
 * This function:
 * 1. Loads the blueprint and extracts producers
 * 2. Loads the model catalog and checks API key availability
 * 3. Renders an interactive Ink application for user input
 * 4. Saves the collected inputs to a YAML file
 *
 * @param options - Configuration options
 * @returns Result with success status and file path
 */
export async function runInteractiveInputs(
  options: InteractiveInputsOptions,
): Promise<InteractiveInputsResult> {
  const { blueprint: blueprintSpecifier, cliConfig, logger } = options;

  try {
    // 1. Resolve and load blueprint
    logger.info('Loading blueprint...');
    const blueprintPath = await resolveBlueprintSpecifier(blueprintSpecifier, {
      cliRoot: cliConfig.storage.root,
    });

    const { root: blueprintRoot } = await loadBlueprintBundle(blueprintPath, {
      catalogRoot: cliConfig.catalog?.root,
    });

    // 2. Load model catalog
    logger.info('Loading model catalog...');
    const catalogModelsDir = cliConfig.catalog?.root
      ? resolve(cliConfig.catalog.root, 'models')
      : undefined;

    let modelCatalog: LoadedModelCatalog | undefined;
    if (catalogModelsDir) {
      modelCatalog = await loadModelCatalog(catalogModelsDir);
    }

    // 3. Create provider registry and detect available providers
    logger.info('Checking available providers...');
    const registry = createProviderRegistry({ mode: 'live', catalog: modelCatalog });

    let availableProviders = new Set<string>();
    if (modelCatalog) {
      const availability = await detectAvailableProviders(modelCatalog, registry);
      availableProviders = availability.availableProviders;

      // Log info about available providers
      if (availableProviders.size > 0) {
        logger.info(`Available providers: ${[...availableProviders].join(', ')}`);
      } else {
        logger.warn('No providers available. Check your API keys in .env file.');
      }

      // Log warnings for unavailable providers (these explain why each failed)
      for (const [provider, reason] of availability.unavailableReasons) {
        logger.warn(`Provider ${provider} not available: ${reason}`);
      }
    } else {
      logger.warn('No model catalog found. Check your catalog configuration.');
    }

    // 4. Extract producers from blueprint
    const producers = extractProducers(blueprintRoot);
    const compositionProducers = extractCompositionProducers(blueprintRoot);

    // 5. Load asset models for asset producers
    const catalogRoot = cliConfig.catalog?.root ?? '';
    const assetProducerRefs = producers
      .filter((p) => p.category === 'asset')
      .map((p) => p.producerRef);
    const assetModels = await loadAllAssetModels(assetProducerRefs, catalogRoot);

    // 6. Get blueprint input field configurations
    const blueprintInputs = blueprintRoot.document.inputs ?? [];
    const blueprintFields = blueprintInputsToFields(blueprintInputs);

    // 7. Run the interactive application
    return await runInteractiveApp({
      blueprint: blueprintRoot,
      producers,
      compositionProducers,
      modelCatalog,
      availableProviders,
      assetModels,
      blueprintFields,
      blueprintId: blueprintRoot.document.meta.id,
      blueprintName: blueprintRoot.document.meta.name ?? blueprintRoot.document.meta.id,
      logger,
      outputDir: options.outputDir,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start interactive mode: ${message}`);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Internal function to render and manage the Ink application.
 */
async function runInteractiveApp(options: {
  blueprint: BlueprintTreeNode;
  producers: ReturnType<typeof extractProducers>;
  compositionProducers: ExtractedCompositionProducer[];
  modelCatalog?: LoadedModelCatalog;
  availableProviders: Set<string>;
  assetModels: Map<string, AssetModelOption[]>;
  blueprintFields: ReturnType<typeof blueprintInputsToFields>;
  blueprintId: string;
  blueprintName: string;
  logger: Logger;
  outputDir?: string;
}): Promise<InteractiveInputsResult> {
  const {
    blueprint,
    producers,
    compositionProducers,
    modelCatalog,
    availableProviders,
    assetModels,
    blueprintFields,
    blueprintId,
    blueprintName,
    logger,
    outputDir,
  } = options;

  return new Promise((resolvePromise) => {
    let result: InteractiveInputsResult = { success: false, cancelled: true };

    const handleComplete = async (data: InputsYamlData) => {
      try {
        logger.info('Saving inputs file...');

        // Create composition model entries with timeline config templates
        const compositionModels: CompositionModelInput[] = compositionProducers.map(
          (producer) => ({
            producerId: producer.alias,
            model: 'timeline/ordered',
            provider: 'renku',
            config: generateTimelineConfigTemplate(),
          }),
        );

        const filePath = await writeInputsYaml(
          {
            ...data,
            compositionModels,
          },
          {
            blueprintId,
            blueprintName,
            outputDir,
            blueprintFields, // Include all fields in template
          },
        );
        logger.info(`Inputs saved to: ${filePath}`);
        result = { success: true, inputsPath: filePath };
        instance.unmount();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to save inputs: ${message}`);
        result = { success: false, error: message };
        instance.unmount();
      }
    };

    const handleCancel = () => {
      result = { success: false, cancelled: true };
      instance.unmount();
    };

    const instance = render(
      React.createElement(InteractiveApp, {
        blueprint,
        producers,
        modelCatalog,
        availableProviders,
        assetModels,
        blueprintFields,
        onComplete: handleComplete,
        onCancel: handleCancel,
      }),
    );

    instance.waitUntilExit().then(() => {
      resolvePromise(result);
    });
  });
}
