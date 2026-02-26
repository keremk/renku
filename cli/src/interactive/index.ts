// Main entry point
export {
	runInteractiveInputs,
	runProducerInteractiveInputs,
	type InteractiveInputsOptions,
	type InteractiveInputsResult,
	type ProducerInteractiveInputsOptions,
} from './interactive-inputs.js';

// Utilities
export {
	detectAvailableProviders,
	filterModelsByAvailability,
	groupModelsByProvider as groupModelsByProviderForBlueprint,
	type ProviderAvailability,
} from './utils/api-key-detector.js';

export {
	extractProducers,
	extractCompositionProducers,
	ProducerExtractionError,
	type ExtractedProducer,
	type ExtractedCompositionProducer,
	type ProducerCategory,
} from './utils/producer-extractor.js';

export {
	PROMPT_PROVIDERS,
	type PromptProvider,
} from './utils/prompt-providers.js';

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
	categorizeSchemaFields,
	extractProducerInputMappings,
	getMappedSchemaFieldNames,
	isBlobInput,
	getExtensionsForBlobType,
	createBlobFieldConfig,
	type FormFieldConfig,
	type FieldType,
	type BlobType,
	type ProducerInputMapping,
	type ProducerInputDef,
} from './utils/schema-to-fields.js';

export {
	writeInputsYaml,
	writeProducerInputsYaml,
	formatInputsPreview,
	formatProducerInputsPreview,
	generateInputsFileName,
	generateProducerInputsFileName,
	formatFileValue,
	formatInputsWithFilePrefix,
	type InputsYamlData,
	type ModelSelectionInput,
	type InputsFileNameOptions,
	type ProducerInputsFileOptions,
} from './utils/yaml-writer.js';

// Producer utilities
export {
	loadProducerDocument,
	isProducerYaml,
	extractModelsFromMappings,
	groupModelsByProvider,
	filterAvailableModels,
	getProducerInputNames,
	type ProducerDocument,
} from './utils/producer-loader.js';

// Producer types
export type {
	ProducerModelOption,
	CategorizedSchemaFields,
	ProducerDocumentMeta,
	ProducerInputDefinition,
	ProducerArtifactDefinition,
	ProducerInteractiveStep,
	ProducerAppState,
	ProducerInputsYamlData,
} from './types/producer-mode.js';

// Components (for testing and customization)
export {
	InteractiveApp,
	InteractiveAppWrapper,
} from './components/interactive-app.js';
export {
	ModelSelector,
	MultiProducerSelector,
	type ModelOption,
} from './components/model-selector.js';
export {
	InputGatherer,
	SimpleInputGatherer,
	InputSummary,
} from './components/input-gatherer.js';
export {
	FormField,
	TextField,
	NumberField,
	BooleanField,
	SelectField,
	useFormState,
} from './components/form-fields.js';
export { FilePicker, type FilePickerProps } from './components/file-picker.js';
export {
	ProgressHeader,
	StepIndicator,
	NavigationFooter,
	ErrorMessage,
	SuccessMessage,
	WarningMessage,
	type InteractiveStep,
} from './components/progress-header.js';

// Producer components
export {
	ProducerApp,
	type ProducerAppProps,
} from './components/producer-app.js';
export {
	ProducerModelSelector,
	type ProducerModelSelectorProps,
} from './components/producer-model-selector.js';
export {
	SchemaFieldEditor,
	FieldSummary,
	type SchemaFieldEditorProps,
	type FieldSummaryProps,
} from './components/schema-field-editor.js';
