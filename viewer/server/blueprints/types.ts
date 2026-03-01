/**
 * Type definitions for the blueprints module.
 */

/**
 * Available model option for a producer.
 */
export interface AvailableModelOption {
  provider: string;
  model: string;
}

/**
 * Producer category types.
 */
export type ProducerCategory = 'asset' | 'prompt' | 'composition';

/**
 * Producer model information.
 */
export interface ProducerModelInfo {
  description?: string;
  producerType?: string;
  category: ProducerCategory;
  availableModels: AvailableModelOption[];
}

/**
 * Response from GET /blueprints/producer-models
 */
export interface ProducerModelsResponse {
  producers: Record<string, ProducerModelInfo>;
}

/**
 * Resolved blueprint information.
 */
export interface ResolvedBlueprintInfo {
  blueprintPath: string;
  blueprintFolder: string;
  inputsPath: string;
  buildsFolder: string;
  catalogRoot?: string;
}

/**
 * Endpoint type classification for edge resolution.
 */
export type EndpointType = 'input' | 'producer' | 'output' | 'unknown';

/**
 * Endpoint resolution result.
 */
export interface EndpointInfo {
  type: EndpointType;
  producer?: string;
}

/**
 * Edge endpoints resolution result.
 */
export interface EdgeEndpoints {
  sourceType: EndpointType;
  sourceProducer?: string;
  targetType: EndpointType;
  targetProducer?: string;
}

/**
 * A blueprint entry in the list response.
 */
export interface BlueprintListItem {
  name: string;
}

/**
 * Response from GET /blueprints/list
 */
export interface BlueprintListResponse {
  blueprints: BlueprintListItem[];
}

/**
 * A catalog blueprint template entry.
 */
export interface CatalogTemplateItem {
  /** Template folder name in catalog/blueprints */
  name: string;
  /** Human title from blueprint meta.name */
  title: string;
  /** Description from blueprint meta.description */
  description: string;
}

/**
 * Response from GET /blueprints/templates
 */
export interface CatalogTemplateListResponse {
  templates: CatalogTemplateItem[];
}

/**
 * Request for POST /blueprints/templates/create
 */
export interface CreateBlueprintFromTemplateRequest {
  templateName: string;
  blueprintName: string;
}

/**
 * Response from POST /blueprints/templates/create
 */
export interface CreateBlueprintFromTemplateResponse {
  name: string;
  blueprintPath: string;
  blueprintFolder: string;
  inputTemplatePath: string;
}
