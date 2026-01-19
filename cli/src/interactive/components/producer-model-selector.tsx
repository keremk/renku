import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { ProducerModelOption } from '../types/producer-mode.js';
import { groupModelsByProvider } from '../utils/producer-loader.js';
import { NavigationFooter, WarningMessage } from './progress-header.js';

/**
 * Props for the ProducerModelSelector component.
 */
export interface ProducerModelSelectorProps {
  /** Producer name for display */
  producerName: string;
  /** Producer description */
  producerDescription?: string;
  /** All available models from producer mappings */
  allModels: ProducerModelOption[];
  /** Set of providers with API keys configured */
  availableProviders: Set<string>;
  /** Callback when a model is selected */
  onSelect: (provider: string, model: string) => void;
  /** Callback to cancel */
  onCancel: () => void;
}

/**
 * Component for selecting a model from producer mappings.
 * Groups models by provider and shows availability status.
 */
export const ProducerModelSelector: React.FC<ProducerModelSelectorProps> = ({
  producerName,
  producerDescription,
  allModels,
  availableProviders,
  onSelect,
  onCancel,
}) => {
  const { exit } = useApp();

  // Separate available and unavailable models
  const { availableModels, unavailableModels } = useMemo(() => {
    const available: ProducerModelOption[] = [];
    const unavailable: ProducerModelOption[] = [];

    for (const model of allModels) {
      if (availableProviders.has(model.provider)) {
        available.push(model);
      } else {
        unavailable.push(model);
      }
    }

    return { availableModels: available, unavailableModels: unavailable };
  }, [allModels, availableProviders]);

  // Group models by provider for display
  const modelsByProvider = useMemo(
    () => groupModelsByProvider(availableModels),
    [availableModels]
  );
  const providers = Array.from(modelsByProvider.keys());

  // Build flat list for navigation
  const flatOptions = useMemo(() => {
    const flat: ProducerModelOption[] = [];
    for (const [, models] of modelsByProvider) {
      flat.push(...models);
    }
    return flat;
  }, [modelsByProvider]);

  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
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
        onSelect(selected.provider, selected.model);
      }
    }
  });

  // Get list of unavailable providers
  const unavailableProviders = useMemo(() => {
    const providers = new Set<string>();
    for (const model of unavailableModels) {
      providers.add(model.provider);
    }
    return Array.from(providers);
  }, [unavailableModels]);

  if (flatOptions.length === 0) {
    return (
      <Box flexDirection="column">
        <ProducerHeader name={producerName} description={producerDescription} />
        <WarningMessage message="No models available. API keys are missing for all providers." />
        {unavailableProviders.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Providers without API keys:</Text>
            {unavailableProviders.map((provider) => (
              <Text key={provider} dimColor>
                {' '}• {provider}
              </Text>
            ))}
          </Box>
        )}
        <NavigationFooter canGoBack={false} nextLabel="Cancel" showCancel />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <ProducerHeader name={producerName} description={producerDescription} />

      <Box marginTop={1}>
        <Text bold color="green">
          Select a model:
        </Text>
      </Box>

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
                    (opt) => opt.provider === provider && opt.model === model.model
                  );
                  const isHighlighted = optionIndex === selectedIndex;

                  return (
                    <Box key={model.model}>
                      <Text color={isHighlighted ? 'cyan' : undefined}>
                        {isHighlighted ? '❯ ' : '  '}○ {model.model}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* Show unavailable providers in dimmed state */}
      {unavailableProviders.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Unavailable (no API key):</Text>
          {unavailableProviders.map((provider) => (
            <Text key={provider} dimColor>
              {'  '}
              {provider}
            </Text>
          ))}
        </Box>
      )}

      <NavigationFooter canGoBack={false} nextLabel="Select" showCancel />
    </Box>
  );
};

/**
 * Header showing producer information.
 */
const ProducerHeader: React.FC<{ name: string; description?: string }> = ({
  name,
  description,
}) => (
  <Box flexDirection="column">
    <Box>
      <Text bold>Producer: </Text>
      <Text color="cyan">{name}</Text>
    </Box>
    {description && <Text dimColor>{description}</Text>}
  </Box>
);
