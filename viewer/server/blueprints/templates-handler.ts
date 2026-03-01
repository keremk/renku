/**
 * Catalog template handlers for blueprint home page.
 */

import {
  createBlueprintFromTemplate as createBlueprintFromTemplateInCore,
  listCatalogBlueprintTemplates,
} from '@gorenku/core';
import { readCliConfig } from '../generation/index.js';
import type {
  CatalogTemplateListResponse,
  CreateBlueprintFromTemplateResponse,
} from './types.js';

/**
 * Lists blueprint templates from the configured catalog.
 */
export async function listCatalogTemplates(): Promise<CatalogTemplateListResponse> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  if (!cliConfig.catalog?.root) {
    throw new Error(
      'Renku catalog is not configured. Run "renku init" to set up the catalog.'
    );
  }

  const templates = await listCatalogBlueprintTemplates(cliConfig.catalog.root);
  return {
    templates,
  };
}

/**
 * Creates a new blueprint in storage from a catalog template.
 */
export async function createBlueprintFromCatalogTemplate(
  templateName: string,
  blueprintName: string
): Promise<CreateBlueprintFromTemplateResponse> {
  const cliConfig = await readCliConfig();
  if (!cliConfig) {
    throw new Error('Renku CLI is not initialized. Run "renku init" first.');
  }
  if (!cliConfig.catalog?.root) {
    throw new Error(
      'Renku catalog is not configured. Run "renku init" to set up the catalog.'
    );
  }

  const created = await createBlueprintFromTemplateInCore({
    blueprintName,
    templateName,
    outputDir: cliConfig.storage.root,
    catalogRoot: cliConfig.catalog.root,
  });

  return {
    name: blueprintName.trim(),
    blueprintPath: created.blueprintPath,
    blueprintFolder: created.folderPath,
    inputTemplatePath: created.inputTemplatePath,
  };
}
