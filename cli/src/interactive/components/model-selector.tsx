import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { ExtractedProducer } from '../utils/producer-extractor.js';
import type { ModelSelectionInput } from '../utils/yaml-writer.js';
import { NavigationFooter, WarningMessage } from './progress-header.js';

/**
 * Available model option for selection.
 */
export interface ModelOption {
  provider: string;
  model: string;
}

/**
 * Props for the ModelSelector component.
 */
export interface ModelSelectorProps {
  /** Producer that needs model selection */
  producer: ExtractedProducer;
  /** Available models for this producer */
  availableModels: ModelOption[];
  /** Current selection (if any) */
  currentSelection?: ModelSelectionInput;
  /** Callback when a model is selected */
  onSelect: (selection: ModelSelectionInput) => void;
  /** Callback to go back to previous producer */
  onBack?: () => void;
  /** Callback to cancel the entire flow */
  onCancel: () => void;
  /** Whether this is the first producer (can't go back) */
  isFirst?: boolean;
}

/**
 * Component for selecting a model for a single producer.
 */
export const ModelSelector: React.FC<ModelSelectorProps> = ({
  producer,
  availableModels,
  currentSelection,
  onSelect,
  onBack,
  onCancel,
  isFirst = false,
}) => {
  const { exit } = useApp();

  // Group models by provider for better display
  const modelsByProvider = groupByProvider(availableModels);
  const providers = Array.from(modelsByProvider.keys());

  // Build flat list for navigation
  const flatOptions = buildFlatOptions(modelsByProvider);

  // Find current selection in flat list
  const initialIndex = currentSelection
    ? flatOptions.findIndex(
        (opt) => opt.provider === currentSelection.provider && opt.model === currentSelection.model,
      )
    : 0;

  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, initialIndex));

  useInput((input, key) => {
    if (key.escape) {
      if (onBack && !isFirst) {
        onBack();
      }
      return;
    }

    if (key.ctrl && input === 'c') {
      onCancel();
      exit();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIndex((i) => Math.min(flatOptions.length - 1, i + 1));
    } else if (key.return) {
      const selected = flatOptions[selectedIndex];
      if (selected) {
        onSelect({
          producerId: producer.alias,
          provider: selected.provider,
          model: selected.model,
        });
      }
    }
  });

  if (flatOptions.length === 0) {
    return (
      <Box flexDirection="column">
        <ProducerHeader producer={producer} />
        <WarningMessage message="No models available for this producer. Make sure you have API keys configured." />
        <Text dimColor>
          Available providers need API keys set in environment variables.
        </Text>
        <NavigationFooter
          canGoBack={!isFirst && !!onBack}
          nextLabel="Skip"
          showCancel
        />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <ProducerHeader producer={producer} />

      <Box flexDirection="column" marginTop={1}>
        {providers.map((provider) => {
          const models = modelsByProvider.get(provider) ?? [];
          return (
            <Box key={provider} flexDirection="column" marginBottom={1}>
              <Text bold color="blue">
                {provider}
              </Text>
              <Box flexDirection="column" marginLeft={2}>
                {models.map((model) => {
                  const optionIndex = flatOptions.findIndex(
                    (opt) => opt.provider === provider && opt.model === model.model,
                  );
                  const isHighlighted = optionIndex === selectedIndex;
                  const isSelected =
                    currentSelection?.provider === provider &&
                    currentSelection?.model === model.model;

                  return (
                    <Box key={model.model}>
                      <Text color={isHighlighted ? 'cyan' : undefined}>
                        {isHighlighted ? '❯ ' : '  '}
                        {isSelected ? '●' : '○'} {model.model}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>

      <NavigationFooter
        canGoBack={!isFirst && !!onBack}
        nextLabel="Select"
        showCancel
      />
    </Box>
  );
};

/**
 * Header showing producer information.
 */
const ProducerHeader: React.FC<{ producer: ExtractedProducer }> = ({ producer }) => (
  <Box flexDirection="column">
    <Box>
      <Text bold>Producer: </Text>
      <Text color="cyan">{producer.alias}</Text>
    </Box>
    {producer.description && (
      <Text dimColor>{producer.description}</Text>
    )}
    <Text dimColor>Category: {producer.category}</Text>
  </Box>
);

/**
 * Group models by provider for display.
 */
function groupByProvider(models: ModelOption[]): Map<string, ModelOption[]> {
  const grouped = new Map<string, ModelOption[]>();
  for (const model of models) {
    const existing = grouped.get(model.provider) ?? [];
    existing.push(model);
    grouped.set(model.provider, existing);
  }
  return grouped;
}

/**
 * Build flat list of options for keyboard navigation.
 */
function buildFlatOptions(modelsByProvider: Map<string, ModelOption[]>): ModelOption[] {
  const flat: ModelOption[] = [];
  for (const [, models] of modelsByProvider) {
    flat.push(...models);
  }
  return flat;
}

/**
 * Function to get models for a producer based on its category.
 */
export type GetModelsForProducer = (producer: ExtractedProducer) => ModelOption[];

/**
 * Props for the MultiProducerSelector component.
 */
export interface MultiProducerSelectorProps {
  /** All producers that need model selection */
  producers: ExtractedProducer[];
  /** Function to get available models for each producer */
  getModelsForProducer: GetModelsForProducer;
  /** Callback when all selections are complete */
  onComplete: (selections: ModelSelectionInput[]) => void;
  /** Callback to cancel */
  onCancel: () => void;
}

/**
 * Component for selecting models for multiple producers.
 */
export const MultiProducerSelector: React.FC<MultiProducerSelectorProps> = ({
  producers,
  getModelsForProducer,
  onComplete,
  onCancel,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selections, setSelections] = useState<Map<string, ModelSelectionInput>>(new Map());

  const currentProducer = producers[currentIndex];

  const handleSelect = useCallback(
    (selection: ModelSelectionInput) => {
      setSelections((prev) => {
        const next = new Map(prev);
        next.set(selection.producerId, selection);
        return next;
      });

      // Move to next producer or complete
      if (currentIndex < producers.length - 1) {
        setCurrentIndex(currentIndex + 1);
      } else {
        onComplete(Array.from(selections.values()).concat([selection]));
      }
    },
    [currentIndex, producers.length, selections, onComplete],
  );

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex]);

  if (!currentProducer) {
    return null;
  }

  // Get available models for this producer
  const availableModels = getModelsForProducer(currentProducer);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text dimColor>
          Producer {currentIndex + 1} of {producers.length}
        </Text>
      </Box>
      <ModelSelector
        producer={currentProducer}
        availableModels={availableModels}
        currentSelection={selections.get(currentProducer.alias)}
        onSelect={handleSelect}
        onBack={handleBack}
        onCancel={onCancel}
        isFirst={currentIndex === 0}
      />
    </Box>
  );
};
