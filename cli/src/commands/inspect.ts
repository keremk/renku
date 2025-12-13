import { readCliConfig } from '../lib/cli-config.js';
import { formatMovieId } from './execute.js';
import { readPromptFile, promptsToToml, type PromptMap } from '../lib/prompts.js';
import { resolve } from 'node:path';

export interface InspectOptions {
  movieId: string;
  prompts?: boolean;
}

export interface InspectResult {
  promptsToml?: string;
}

export async function runInspect(options: InspectOptions): Promise<InspectResult> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  if (!options.movieId) {
    throw new Error('Movie ID is required for inspect.');
  }

  const storageMovieId = formatMovieId(options.movieId);
  const storageRoot = cliConfig.storage.root;
  const basePath = cliConfig.storage.basePath;
  const movieDir = resolve(storageRoot, basePath, storageMovieId);

  const promptMap: PromptMap = {};
  if (options.prompts !== false) {
    const inquiry = await readPromptFile(movieDir, 'prompts/inquiry.txt');
    if (inquiry !== null) {
      promptMap.inquiry = inquiry;
    }
  }

  const result: InspectResult = {};
  if (Object.keys(promptMap).length > 0) {
    result.promptsToml = promptsToToml(promptMap);
  }
  return result;
}
