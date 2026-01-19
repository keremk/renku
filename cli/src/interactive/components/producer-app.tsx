import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { LoadedModelCatalog, SchemaFile } from '@gorenku/providers';
import type {
  ProducerDocument,
  ProducerAppState,
  ProducerInputsYamlData,
  ProducerInteractiveStep,
} from '../types/producer-mode.js';
import type { FormFieldConfig, ProducerInputMapping } from '../utils/schema-to-fields.js';
import { categorizeSchemaFields, extractProducerInputMappings } from '../utils/schema-to-fields.js';
import { extractModelsFromMappings } from '../utils/producer-loader.js';
import { ProducerModelSelector } from './producer-model-selector.js';
import { SchemaFieldEditor, FieldSummary } from './schema-field-editor.js';
import { NavigationFooter, ErrorMessage } from './progress-header.js';

/**
 * Props for the ProducerApp component.
 */
export interface ProducerAppProps {
  /** Parsed producer document */
  producer: ProducerDocument;
  /** Model catalog for schema loading */
  modelCatalog: LoadedModelCatalog;
  /** Catalog models directory path */
  catalogModelsDir: string;
  /** Available providers (with API keys configured) */
  availableProviders: Set<string>;
  /** Schema loader function */
  loadSchemaFile: (provider: string, model: string) => Promise<SchemaFile | null>;
  /** Callback when complete */
  onComplete: (data: ProducerInputsYamlData) => void;
  /** Callback when cancelled */
  onCancel: () => void;
}

/**
 * Step configuration for progress display.
 */
const STEP_CONFIG: Record<ProducerInteractiveStep, { label: string; number: number }> = {
  'model-selection': { label: 'Select Model', number: 1 },
  'input-editing': { label: 'Producer Inputs', number: 2 },
  'config-editing': { label: 'Configuration', number: 3 },
  confirmation: { label: 'Confirm', number: 4 },
  saving: { label: 'Saving...', number: 5 },
};

const TOTAL_STEPS = 4;

/**
 * Main producer interactive application component.
 */
export const ProducerApp: React.FC<ProducerAppProps> = ({
  producer,
  modelCatalog: _modelCatalog,
  catalogModelsDir: _catalogModelsDir,
  availableProviders,
  loadSchemaFile,
  onComplete,
  onCancel,
}) => {
  const { exit } = useApp();

  // Application state
  const [state, setState] = useState<ProducerAppState>({
    step: 'model-selection',
    inputValues: {},
    configValues: {},
  });

  // Schema state (loaded after model selection)
  const [schemaFile, setSchemaFile] = useState<SchemaFile | null>(null);
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [modelMappings, setModelMappings] = useState<Record<string, unknown> | null>(null);

  // Extract all models from producer mappings
  const allModels = useMemo(
    () => extractModelsFromMappings(producer.mappings),
    [producer.mappings]
  );

  // Extract producer input to schema field mappings
  const inputMappings = useMemo((): ProducerInputMapping[] => {
    if (!modelMappings) {
      return [];
    }
    return extractProducerInputMappings(modelMappings);
  }, [modelMappings]);

  // Categorize schema fields when schema is loaded
  // Input fields will use producer input names (Prompt, NumImages)
  // Config fields will use schema field names (acceleration, enable_safety_checker)
  // Pass producer inputs for blob type detection (image, audio, video)
  const { inputFields, configFields } = useMemo(() => {
    if (!schemaFile) {
      return { inputFields: [], configFields: [] };
    }
    return categorizeSchemaFields(schemaFile, inputMappings, producer.inputs);
  }, [schemaFile, inputMappings, producer.inputs]);

  // Handle model selection
  const handleModelSelect = useCallback(
    async (provider: string, model: string) => {
      setState((prev) => ({
        ...prev,
        selectedProvider: provider,
        selectedModel: model,
        error: undefined,
      }));

      // Get the mappings for this specific model
      const providerMappings = producer.mappings[provider];
      const mappings = providerMappings?.[model] as Record<string, unknown> | undefined;
      setModelMappings(mappings ?? null);

      // Load schema for selected model
      setIsLoadingSchema(true);
      try {
        const schema = await loadSchemaFile(provider, model);
        setSchemaFile(schema);

        // Move to next step
        setState((prev) => ({
          ...prev,
          step: 'input-editing',
        }));
      } catch (error) {
        setState((prev) => ({
          ...prev,
          error: `Failed to load schema: ${error instanceof Error ? error.message : String(error)}`,
        }));
      } finally {
        setIsLoadingSchema(false);
      }
    },
    [loadSchemaFile, producer.mappings]
  );

  // Filter out values that equal their field defaults
  // We only want to include values the user explicitly changed
  const filterNonDefaultValues = useCallback(
    (values: Record<string, unknown>, fields: FormFieldConfig[]): Record<string, unknown> => {
      const fieldDefaults = new Map(
        fields.map((f) => [f.name, f.defaultValue])
      );
      const filtered: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        const defaultValue = fieldDefaults.get(key);
        // Include if no default, or value differs from default
        if (defaultValue === undefined || value !== defaultValue) {
          // Also exclude empty strings and undefined
          if (value !== undefined && value !== '') {
            filtered[key] = value;
          }
        }
      }
      return filtered;
    },
    []
  );

  // Handle input editing complete
  const handleInputsComplete = useCallback((values: Record<string, unknown>) => {
    // Filter out values that equal their defaults
    const filteredValues = filterNonDefaultValues(values, inputFields);
    setState((prev) => ({
      ...prev,
      inputValues: filteredValues,
      step: configFields.length > 0 ? 'config-editing' : 'confirmation',
    }));
  }, [configFields.length, filterNonDefaultValues, inputFields]);

  // Handle config editing complete
  const handleConfigComplete = useCallback((values: Record<string, unknown>) => {
    // Filter out values that equal their defaults
    const filteredValues = filterNonDefaultValues(values, configFields);
    setState((prev) => ({
      ...prev,
      configValues: filteredValues,
      step: 'confirmation',
    }));
  }, [filterNonDefaultValues, configFields]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    setState((prev) => {
      switch (prev.step) {
        case 'input-editing':
          return { ...prev, step: 'model-selection' };
        case 'config-editing':
          return { ...prev, step: 'input-editing' };
        case 'confirmation':
          return {
            ...prev,
            step: configFields.length > 0 ? 'config-editing' : 'input-editing',
          };
        default:
          return prev;
      }
    });
  }, [configFields.length]);

  // Handle confirmation
  const handleConfirm = useCallback(() => {
    if (!state.selectedProvider || !state.selectedModel) {
      return;
    }

    const data: ProducerInputsYamlData = {
      provider: state.selectedProvider,
      model: state.selectedModel,
      producerId: producer.meta.id,
      inputs: state.inputValues,
      config: state.configValues,
      inputFields, // Include field configs for type-aware formatting (file: prefix)
    };
    onComplete(data);
  }, [state.selectedProvider, state.selectedModel, state.inputValues, state.configValues, producer.meta.id, inputFields, onComplete]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onCancel();
    exit();
  }, [onCancel, exit]);

  // Render loading state
  if (isLoadingSchema) {
    return (
      <Box flexDirection="column">
        <ProducerProgressHeader
          step={state.step}
          producerName={producer.meta.name}
        />
        <Text color="yellow">Loading schema for {state.selectedModel}...</Text>
      </Box>
    );
  }

  // Render current step
  const renderStep = () => {
    switch (state.step) {
      case 'model-selection':
        return (
          <ProducerModelSelector
            producerName={producer.meta.name}
            producerDescription={producer.meta.description}
            allModels={allModels}
            availableProviders={availableProviders}
            onSelect={handleModelSelect}
            onCancel={handleCancel}
          />
        );

      case 'input-editing':
        return (
          <SchemaFieldEditor
            key="input-editor"
            sectionTitle="Producer Inputs"
            fields={inputFields}
            existingValues={state.inputValues}
            onComplete={handleInputsComplete}
            onBack={handleBack}
            onCancel={handleCancel}
            canGoBack
            continueLabel={configFields.length > 0 ? 'Next: Configuration' : 'Review'}
          />
        );

      case 'config-editing':
        return (
          <SchemaFieldEditor
            key="config-editor"
            sectionTitle="Configuration"
            fields={configFields}
            existingValues={state.configValues}
            onComplete={handleConfigComplete}
            onBack={handleBack}
            onCancel={handleCancel}
            canGoBack
            continueLabel="Review"
            allowSkip
          />
        );

      case 'confirmation':
        return (
          <ConfirmationView
            provider={state.selectedProvider!}
            model={state.selectedModel!}
            inputValues={state.inputValues}
            configValues={state.configValues}
            inputFields={inputFields}
            configFields={configFields}
            onConfirm={handleConfirm}
            onBack={handleBack}
            onCancel={handleCancel}
          />
        );

      case 'saving':
        return <Text color="yellow">Saving inputs file...</Text>;

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column">
      <ProducerProgressHeader
        step={state.step}
        producerName={producer.meta.name}
        selectedModel={state.selectedModel}
      />
      {state.error && <ErrorMessage message={state.error} />}
      {renderStep()}
    </Box>
  );
};

/**
 * Progress header for producer mode.
 */
interface ProducerProgressHeaderProps {
  step: ProducerInteractiveStep;
  producerName: string;
  selectedModel?: string;
}

const ProducerProgressHeader: React.FC<ProducerProgressHeaderProps> = ({
  step,
  producerName,
  selectedModel,
}) => {
  const stepConfig = STEP_CONFIG[step];
  const isMainStep = stepConfig.number >= 1 && stepConfig.number <= TOTAL_STEPS;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Title bar */}
      <Box>
        <Text bold color="cyan">
          ◆ Producer Input Setup
        </Text>
        <Text dimColor> • {producerName}</Text>
      </Box>

      {/* Selected model */}
      {selectedModel && (
        <Box>
          <Text dimColor>Model: </Text>
          <Text color="green">{selectedModel}</Text>
        </Box>
      )}

      {/* Progress indicator */}
      {isMainStep && (
        <Box marginTop={1}>
          <Text>Step </Text>
          <Text bold color="cyan">{stepConfig.number}</Text>
          <Text> of </Text>
          <Text>{TOTAL_STEPS}</Text>
          <Text>: </Text>
          <Text bold>{stepConfig.label}</Text>
        </Box>
      )}

      {/* Separator */}
      <Box marginTop={1}>
        <Text dimColor>{'─'.repeat(50)}</Text>
      </Box>
    </Box>
  );
};

/**
 * Confirmation view before saving.
 */
interface ConfirmationViewProps {
  provider: string;
  model: string;
  inputValues: Record<string, unknown>;
  configValues: Record<string, unknown>;
  inputFields: FormFieldConfig[];
  configFields: FormFieldConfig[];
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
}

const ConfirmationView: React.FC<ConfirmationViewProps> = ({
  provider,
  model,
  inputValues,
  configValues,
  inputFields,
  configFields,
  onConfirm,
  onBack,
  onCancel,
}) => {
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.escape) {
      onBack();
    } else if (key.return) {
      onConfirm();
    } else if (key.ctrl && input === 'c') {
      onCancel();
      exit();
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold color="green">Review your selections:</Text>

      {/* Model selection */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="blue">Model:</Text>
        <Box marginLeft={2}>
          <Text dimColor>Provider: </Text>
          <Text>{provider}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>Model: </Text>
          <Text>{model}</Text>
        </Box>
      </Box>

      {/* Input values */}
      {inputFields.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <FieldSummary
            title="Producer Inputs"
            values={inputValues}
            fields={inputFields}
          />
        </Box>
      )}

      {/* Config values */}
      {configFields.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <FieldSummary
            title="Configuration"
            values={configValues}
            fields={configFields}
          />
        </Box>
      )}

      <NavigationFooter canGoBack nextLabel="Save & Continue" showCancel />
    </Box>
  );
};
