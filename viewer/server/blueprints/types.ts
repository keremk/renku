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
export type ProducerCategory = "asset" | "prompt" | "composition";

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
export type EndpointType = "input" | "producer" | "output" | "unknown";

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
