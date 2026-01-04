import React, { useState, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { FormFieldConfig } from '../utils/schema-to-fields.js';
import { FormField, useFormState } from './form-fields.js';
import { NavigationFooter } from './progress-header.js';

/**
 * Props for the InputGatherer component.
 */
export interface InputGathererProps {
  /** Blueprint input fields to collect */
  blueprintFields: FormFieldConfig[];
  /** Additional model-specific fields (optional) */
  modelFields?: FormFieldConfig[];
  /** Existing values to pre-fill */
  existingValues?: Record<string, unknown>;
  /** Callback when all inputs are collected */
  onComplete: (values: Record<string, unknown>) => void;
  /** Callback to go back to model selection */
  onBack: () => void;
  /** Callback to cancel */
  onCancel: () => void;
}

/**
 * Component for collecting all input values.
 */
export const InputGatherer: React.FC<InputGathererProps> = ({
  blueprintFields,
  modelFields = [],
  existingValues = {},
  onComplete,
  onBack,
  onCancel,
}) => {
  const { exit } = useApp();

  // Combine all fields
  const allFields = [...blueprintFields, ...modelFields];

  // Initialize form state
  const { values, setValue, getFieldProps, isValid: _isValid } = useFormState(allFields);

  // Merge in existing values
  React.useEffect(() => {
    for (const [key, value] of Object.entries(existingValues)) {
      if (value !== undefined) {
        setValue(key, value);
      }
    }
  }, [existingValues, setValue]);

  // Track focused field
  const [focusedIndex, setFocusedIndex] = useState(0);

  // Total focusable items: all fields + Continue button
  const totalItems = allFields.length + 1;
  const isOnContinueButton = focusedIndex === allFields.length;

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCancel();
      exit();
      return;
    }

    if (key.tab && !key.shift) {
      // Move to next item (including Continue button)
      setFocusedIndex((i) => Math.min(totalItems - 1, i + 1));
    } else if (key.tab && key.shift) {
      // Move to previous item
      setFocusedIndex((i) => Math.max(0, i - 1));
    } else if (key.return && isOnContinueButton) {
      // Submit form when on Continue button
      onComplete(values);
    }
  });

  // Reserved for future use - field-level key handling
  const _handleFieldKeyDown = useCallback(
    (key: { return?: boolean }) => {
      if (key.return) {
        // Move to next field on Enter (unless it's the last field)
        if (focusedIndex < allFields.length - 1) {
          setFocusedIndex(focusedIndex + 1);
        }
      }
    },
    [focusedIndex, allFields.length],
  );

  if (allFields.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>No inputs required</Text>
        <Text dimColor>This blueprint has no configurable inputs.</Text>
        <NavigationFooter canGoBack nextLabel="Continue" showCancel />
      </Box>
    );
  }

  // Separate blueprint and model fields for display
  const hasBlueprintFields = blueprintFields.length > 0;
  const hasModelFields = modelFields.length > 0;

  return (
    <Box flexDirection="column">
      {/* Blueprint inputs section */}
      {hasBlueprintFields && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="blue">Blueprint Inputs</Text>
          <Box flexDirection="column" marginTop={1}>
            {blueprintFields.map((field, index) => (
              <Box key={field.name} marginBottom={1}>
                <FormField
                  {...getFieldProps(field, focusedIndex === index)}
                />
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {/* Model config section */}
      {hasModelFields && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="blue">Model Configuration</Text>
          <Box flexDirection="column" marginTop={1}>
            {modelFields.map((field, index) => {
              const actualIndex = blueprintFields.length + index;
              return (
                <Box key={field.name} marginBottom={1}>
                  <FormField
                    {...getFieldProps(field, focusedIndex === actualIndex)}
                  />
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Continue button */}
      <Box marginTop={1}>
        <Text
          bold={isOnContinueButton}
          color={isOnContinueButton ? 'cyan' : 'gray'}
        >
          {isOnContinueButton ? '▶ ' : '  '}
          [Continue and Save]
        </Text>
      </Box>

      <NavigationFooter
        canGoBack={false}
        nextLabel="Press Enter on [Continue and Save]"
        showCancel
        hints={['Tab: Next field', 'Shift+Tab: Previous field']}
      />
    </Box>
  );
};

/**
 * Simplified input gatherer for just blueprint inputs.
 */
export interface SimpleInputGathererProps {
  /** Fields to collect */
  fields: FormFieldConfig[];
  /** Callback when complete */
  onComplete: (values: Record<string, unknown>) => void;
  /** Callback to go back */
  onBack: () => void;
  /** Callback to cancel */
  onCancel: () => void;
}

export const SimpleInputGatherer: React.FC<SimpleInputGathererProps> = ({
  fields,
  onComplete,
  onBack,
  onCancel,
}) => {
  return (
    <InputGatherer
      blueprintFields={fields}
      onComplete={onComplete}
      onBack={onBack}
      onCancel={onCancel}
    />
  );
};

/**
 * Summary view of collected inputs.
 */
export interface InputSummaryProps {
  /** Collected input values */
  values: Record<string, unknown>;
  /** Field configurations for display */
  fields: FormFieldConfig[];
}

export const InputSummary: React.FC<InputSummaryProps> = ({ values, fields }) => {
  return (
    <Box flexDirection="column">
      {fields.map((field) => {
        const value = values[field.name];
        const displayValue = formatValueForDisplay(value);
        return (
          <Box key={field.name}>
            <Text dimColor>{field.label}: </Text>
            <Text>{displayValue}</Text>
          </Box>
        );
      })}
    </Box>
  );
};

/**
 * Format a value for display in the summary.
 */
function formatValueForDisplay(value: unknown): string {
  if (value === undefined || value === null) {
    return '(not set)';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}
