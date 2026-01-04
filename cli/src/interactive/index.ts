// Main entry point
export {
  runInteractiveInputs,
  type InteractiveInputsOptions,
  type InteractiveInputsResult,
} from './interactive-inputs.js';

// Utilities
export {
  detectAvailableProviders,
  filterModelsByAvailability,
  groupModelsByProvider,
  type ProviderAvailability,
} from './utils/api-key-detector.js';

export {
  extractProducers,
  ProducerExtractionError,
  type ExtractedProducer,
  type ProducerCategory,
} from './utils/producer-extractor.js';

export { PROMPT_PROVIDERS, type PromptProvider } from './utils/prompt-providers.js';

export {
  loadAssetProducerModels,
  loadAllAssetModels,
  type AssetModelOption,
} from './utils/asset-model-loader.js';

export {
  schemaToFields,
  schemaFileToFields,
  blueprintInputsToFields,
  filterUserFacingFields,
  type FormFieldConfig,
  type FieldType,
} from './utils/schema-to-fields.js';

export {
  writeInputsYaml,
  formatInputsPreview,
  generateInputsFileName,
  generateTimelineConfigTemplate,
  type InputsYamlData,
  type ModelSelectionInput,
  type InputsFileNameOptions,
} from './utils/yaml-writer.js';

// Components (for testing and customization)
export { InteractiveApp, InteractiveAppWrapper } from './components/interactive-app.js';
export { ModelSelector, MultiProducerSelector, type ModelOption } from './components/model-selector.js';
export { InputGatherer, SimpleInputGatherer, InputSummary } from './components/input-gatherer.js';
export { FormField, TextField, NumberField, BooleanField, SelectField, useFormState } from './components/form-fields.js';
export {
  ProgressHeader,
  StepIndicator,
  NavigationFooter,
  ErrorMessage,
  SuccessMessage,
  WarningMessage,
  type InteractiveStep,
} from './components/progress-header.js';
