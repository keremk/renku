import { dirname } from 'node:path';
import {
  createBlueprintBuild,
  createRuntimeError,
  RuntimeErrorCode,
} from '@gorenku/core';
import { detectBlueprintInDirectory } from '../lib/blueprint-detection.js';
import { readCliConfig } from '../lib/cli-config.js';
import { resolveBlueprintSpecifier } from '../lib/config-assets.js';

export interface NewVideoOptions {
  blueprint?: string;
  displayName?: string;
}

export interface NewVideoResult {
  movieId: string;
  blueprintPath: string;
  blueprintFolder: string;
  buildDir: string;
  inputsPath: string;
}

export async function runNewVideo(
  options: NewVideoOptions = {}
): Promise<NewVideoResult> {
  const explicitBlueprint = options.blueprint?.trim();

  let blueprintPath: string;
  let blueprintFolder: string;

  if (explicitBlueprint && explicitBlueprint.length > 0) {
    const cliConfig = await readCliConfig();
    blueprintPath = await resolveBlueprintSpecifier(explicitBlueprint, {
      cliRoot: cliConfig?.storage.root,
    });
    blueprintFolder = dirname(blueprintPath);
  } else {
    const detected = await detectBlueprintInDirectory();
    if (!detected) {
      throw createRuntimeError(
        RuntimeErrorCode.MISSING_REQUIRED_INPUT,
        'No blueprint found in the current directory. Provide one with --blueprint/--bp or run this command from a blueprint folder.',
        {
          suggestion:
            'Run this command from a blueprint folder, or pass --blueprint=/path/to/blueprint.yaml.',
        }
      );
    }
    blueprintPath = detected.blueprintPath;
    blueprintFolder = detected.blueprintFolder;
  }

  const result = await createBlueprintBuild({
    blueprintFolder,
    blueprintPath,
    displayName: options.displayName,
  });

  return {
    movieId: result.movieId,
    blueprintPath,
    blueprintFolder,
    buildDir: result.buildDir,
    inputsPath: result.inputsPath,
  };
}
