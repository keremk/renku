import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { BlueprintTreeNode } from '@gorenku/core';
import type { LoadedModelCatalog } from '@gorenku/providers';
import type { ExtractedProducer } from '../utils/producer-extractor.js';
import type { ModelSelectionInput, InputsYamlData } from '../utils/yaml-writer.js';
import type { FormFieldConfig } from '../utils/schema-to-fields.js';
import type { AssetModelOption } from '../utils/asset-model-loader.js';
import { PROMPT_PROVIDERS } from '../utils/prompt-providers.js';
import {
  ProgressHeader,
  NavigationFooter,
  ErrorMessage,
  type InteractiveStep,
} from './progress-header.js';
import { MultiProducerSelector, type ModelOption } from './model-selector.js';
import { SimpleInputGatherer, InputSummary } from './input-gatherer.js';

/**
 * Props for the InteractiveApp component.
 */
export interface InteractiveAppProps {
  /** Loaded blueprint tree */
  blueprint: BlueprintTreeNode;
  /** Producers that need model selection */
  producers: ExtractedProducer[];
  /** Loaded model catalog */
  modelCatalog?: LoadedModelCatalog;
  /** Set of available provider names (with API keys configured) */
  availableProviders: Set<string>;
  /** Asset models loaded from producer YAML files */
  assetModels: Map<string, AssetModelOption[]>;
  /** Blueprint input field configurations */
  blueprintFields: FormFieldConfig[];
  /** Callback when complete with final data */
  onComplete: (data: InputsYamlData) => void;
  /** Callback when cancelled */
  onCancel: () => void;
}

/**
 * Application state for the interactive flow.
 */
interface AppState {
  step: InteractiveStep;
  modelSelections: ModelSelectionInput[];
  inputValues: Record<string, unknown>;
  error?: string;
}

/**
 * Main interactive application component.
 * Orchestrates the flow through model selection, input gathering, and confirmation.
 */
export const InteractiveApp: React.FC<InteractiveAppProps> = ({
  blueprint,
  producers,
  modelCatalog,
  availableProviders,
  assetModels,
  blueprintFields,
  onComplete,
  onCancel,
}) => {
  const { exit } = useApp();
  const blueprintName = blueprint.document.meta.name ?? blueprint.document.meta.id;

  // Application state
  const [state, setState] = useState<AppState>({
    step: producers.length > 0 ? 'model-selection' : 'input-gathering',
    modelSelections: [],
    inputValues: {},
  });

  // Build prompt models from catalog (openai/vercel text models)
  const promptModels = useMemo(() => {
    return getPromptModels(modelCatalog, availableProviders);
  }, [modelCatalog, availableProviders]);

  // Function to get models for a producer based on its category
  const getModelsForProducer = useCallback(
    (producer: ExtractedProducer): ModelOption[] => {
      if (producer.category === 'prompt') {
        return promptModels;
      } else if (producer.category === 'asset') {
        // Get models from the asset producer YAML, filtered by available providers
        const models = assetModels.get(producer.producerRef) ?? [];
        return models
          .filter((m) => availableProviders.has(m.provider))
          .map((m) => ({ provider: m.provider, model: m.model }));
      }
      return [];
    },
    [promptModels, assetModels, availableProviders],
  );

  // Handle model selection complete
  const handleModelsComplete = useCallback((selections: ModelSelectionInput[]) => {
    setState((prev) => ({
      ...prev,
      step: 'input-gathering',
      modelSelections: selections,
    }));
  }, []);

  // Handle input gathering complete
  const handleInputsComplete = useCallback((values: Record<string, unknown>) => {
    setState((prev) => ({
      ...prev,
      step: 'confirmation',
      inputValues: values,
    }));
  }, []);

  // Handle back navigation
  const handleBack = useCallback(() => {
    setState((prev) => {
      if (prev.step === 'input-gathering' && producers.length > 0) {
        return { ...prev, step: 'model-selection' };
      }
      if (prev.step === 'confirmation') {
        return { ...prev, step: 'input-gathering' };
      }
      return prev;
    });
  }, [producers.length]);

  // Handle confirmation
  const handleConfirm = useCallback(() => {
    const data: InputsYamlData = {
      inputs: state.inputValues,
      models: state.modelSelections,
    };
    onComplete(data);
  }, [state.inputValues, state.modelSelections, onComplete]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    onCancel();
    exit();
  }, [onCancel, exit]);

  // Render based on current step
  const renderStep = () => {
    switch (state.step) {
      case 'loading':
        return <Text>Loading...</Text>;

      case 'model-selection':
        return (
          <MultiProducerSelector
            producers={producers}
            getModelsForProducer={getModelsForProducer}
            onComplete={handleModelsComplete}
            onCancel={handleCancel}
          />
        );

      case 'input-gathering':
        return (
          <SimpleInputGatherer
            fields={blueprintFields}
            onComplete={handleInputsComplete}
            onBack={handleBack}
            onCancel={handleCancel}
          />
        );

      case 'confirmation':
        return (
          <ConfirmationView
            modelSelections={state.modelSelections}
            inputValues={state.inputValues}
            blueprintFields={blueprintFields}
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
      <ProgressHeader
        currentStep={state.step}
        blueprintName={blueprintName}
      />
      {state.error && <ErrorMessage message={state.error} />}
      {renderStep()}
    </Box>
  );
};

/**
 * Get text models from prompt providers (openai, vercel).
 */
function getPromptModels(
  catalog: LoadedModelCatalog | undefined,
  availableProviders: Set<string>,
): ModelOption[] {
  const models: ModelOption[] = [];

  if (!catalog) {
    return models;
  }

  for (const provider of PROMPT_PROVIDERS) {
    if (!availableProviders.has(provider)) {
      continue;
    }

    const providerModels = catalog.providers.get(provider);
    if (providerModels) {
      for (const [name, def] of providerModels) {
        if (def.type === 'text') {
          models.push({ provider, model: name });
        }
      }
    }
  }

  return models;
}

/**
 * Confirmation view before saving.
 */
interface ConfirmationViewProps {
  modelSelections: ModelSelectionInput[];
  inputValues: Record<string, unknown>;
  blueprintFields: FormFieldConfig[];
  onConfirm: () => void;
  onBack: () => void;
  onCancel: () => void;
}

const ConfirmationView: React.FC<ConfirmationViewProps> = ({
  modelSelections,
  inputValues,
  blueprintFields,
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

      {/* Model selections */}
      {modelSelections.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="blue">Models:</Text>
          <Box flexDirection="column" marginLeft={2}>
            {modelSelections.map((selection) => (
              <Box key={selection.producerId}>
                <Text dimColor>{selection.producerId}: </Text>
                <Text>{selection.provider}/{selection.model}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Input values */}
      {Object.keys(inputValues).length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="blue">Inputs:</Text>
          <Box marginLeft={2}>
            <InputSummary values={inputValues} fields={blueprintFields} />
          </Box>
        </Box>
      )}

      <NavigationFooter
        canGoBack
        nextLabel="Save & Continue"
        showCancel
      />
    </Box>
  );
};

/**
 * Wrapper component that handles errors.
 */
export interface InteractiveAppWrapperProps extends InteractiveAppProps {
  /** Optional loading state */
  isLoading?: boolean;
}

export const InteractiveAppWrapper: React.FC<InteractiveAppWrapperProps> = ({
  isLoading,
  ...props
}) => {
  if (isLoading) {
    return (
      <Box flexDirection="column">
        <ProgressHeader currentStep="loading" blueprintName={props.blueprint.document.meta.name} />
        <Text>Loading blueprint and models...</Text>
      </Box>
    );
  }

  return <InteractiveApp {...props} />;
};
