import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type { FormFieldConfig } from '../utils/schema-to-fields.js';
import { FormField, useFormState } from './form-fields.js';
import { NavigationFooter } from './progress-header.js';

/**
 * Props for the SchemaFieldEditor component.
 */
export interface SchemaFieldEditorProps {
  /** Section title (e.g., "Producer Inputs", "Configuration") */
  sectionTitle: string;
  /** Fields to edit */
  fields: FormFieldConfig[];
  /** Existing values to pre-fill */
  existingValues?: Record<string, unknown>;
  /** Callback when editing is complete */
  onComplete: (values: Record<string, unknown>) => void;
  /** Callback to go back */
  onBack: () => void;
  /** Callback to cancel */
  onCancel: () => void;
  /** Whether back navigation is allowed */
  canGoBack?: boolean;
  /** Custom label for the continue button */
  continueLabel?: string;
  /** Whether to show skip option for optional sections */
  allowSkip?: boolean;
}

/**
 * Component for editing a section of schema fields.
 * Separates fields into required and optional groups for better UX.
 */
export const SchemaFieldEditor: React.FC<SchemaFieldEditorProps> = ({
  sectionTitle,
  fields,
  existingValues = {},
  onComplete,
  onBack,
  onCancel,
  canGoBack = true,
  continueLabel = 'Continue',
  allowSkip = false,
}) => {
  const { exit } = useApp();

  // Separate required and optional fields
  const { requiredFields, optionalFields } = useMemo(() => {
    const required: FormFieldConfig[] = [];
    const optional: FormFieldConfig[] = [];

    for (const field of fields) {
      if (field.required) {
        required.push(field);
      } else {
        optional.push(field);
      }
    }

    return { requiredFields: required, optionalFields: optional };
  }, [fields]);

  // Initialize form state
  const { values, setValue, getFieldProps, isValid } = useFormState(fields);

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

  // Build flat list of items: all fields + Continue button + optional Skip button
  const actionButtons = allowSkip && !isValid ? 2 : 1;
  const totalItems = fields.length + actionButtons;
  const continueButtonIndex = fields.length;
  const skipButtonIndex = fields.length + 1;

  const isOnContinueButton = focusedIndex === continueButtonIndex;
  const isOnSkipButton = allowSkip && focusedIndex === skipButtonIndex;

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      onCancel();
      exit();
      return;
    }

    if (key.escape && canGoBack) {
      onBack();
      return;
    }

    if (key.tab && !key.shift) {
      // Move to next item
      setFocusedIndex((i) => Math.min(totalItems - 1, i + 1));
    } else if (key.tab && key.shift) {
      // Move to previous item
      setFocusedIndex((i) => Math.max(0, i - 1));
    } else if (key.return) {
      if (isOnContinueButton && isValid) {
        onComplete(values);
      } else if (isOnSkipButton && allowSkip) {
        // Skip with empty values for optional fields
        const emptyValues: Record<string, unknown> = {};
        for (const field of fields) {
          emptyValues[field.name] = values[field.name] ?? field.defaultValue;
        }
        onComplete(emptyValues);
      }
    }
  });

  if (fields.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color="green">{sectionTitle}</Text>
        <Text dimColor>No fields to configure.</Text>
        <Box marginTop={1}>
          <Text bold color="cyan">▶ [Continue]</Text>
        </Box>
        <NavigationFooter canGoBack={canGoBack} nextLabel={continueLabel} showCancel />
      </Box>
    );
  }

  // Calculate field indices for focus tracking
  let fieldIndex = 0;

  return (
    <Box flexDirection="column">
      <Text bold color="green">{sectionTitle}</Text>

      {/* Required fields section */}
      {requiredFields.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="yellow">Required Fields</Text>
          <Box flexDirection="column" marginTop={1} marginLeft={1}>
            {requiredFields.map((field) => {
              const currentIndex = fieldIndex++;
              return (
                <Box key={field.name} marginBottom={1}>
                  <FormField {...getFieldProps(field, focusedIndex === currentIndex)} />
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Optional fields section */}
      {optionalFields.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="gray">Optional Fields</Text>
          <Box flexDirection="column" marginTop={1} marginLeft={1}>
            {optionalFields.map((field) => {
              const currentIndex = fieldIndex++;
              return (
                <Box key={field.name} marginBottom={1}>
                  <FormField {...getFieldProps(field, focusedIndex === currentIndex)} />
                </Box>
              );
            })}
          </Box>
        </Box>
      )}

      {/* Action buttons */}
      <Box flexDirection="column" marginTop={1}>
        {/* Continue button */}
        <Box>
          <Text
            bold={isOnContinueButton}
            color={isOnContinueButton ? (isValid ? 'cyan' : 'red') : 'gray'}
          >
            {isOnContinueButton ? '▶ ' : '  '}
            [{continueLabel}]
            {!isValid && isOnContinueButton && (
              <Text color="red"> (fill required fields first)</Text>
            )}
          </Text>
        </Box>

        {/* Skip button (only if allowSkip and not all required filled) */}
        {allowSkip && (
          <Box>
            <Text
              bold={isOnSkipButton}
              color={isOnSkipButton ? 'yellow' : 'gray'}
            >
              {isOnSkipButton ? '▶ ' : '  '}
              [Skip with defaults]
            </Text>
          </Box>
        )}
      </Box>

      <NavigationFooter
        canGoBack={canGoBack}
        nextLabel="Tab: Navigate, Enter: Select"
        showCancel
        hints={['Tab: Next field', 'Shift+Tab: Previous field']}
      />
    </Box>
  );
};

/**
 * Summary view for schema fields.
 */
export interface FieldSummaryProps {
  /** Section title */
  title: string;
  /** Collected values */
  values: Record<string, unknown>;
  /** Field configurations */
  fields: FormFieldConfig[];
}

export const FieldSummary: React.FC<FieldSummaryProps> = ({ title, values, fields }) => {
  // Only show fields that have values
  const fieldsWithValues = fields.filter((field) => {
    const value = values[field.name];
    return value !== undefined && value !== null && value !== '';
  });

  if (fieldsWithValues.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold color="blue">{title}</Text>
        <Box marginLeft={2}>
          <Text dimColor>(no values set)</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold color="blue">{title}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {fieldsWithValues.map((field) => {
          const value = values[field.name];
          const displayValue = formatValue(value);
          return (
            <Box key={field.name}>
              <Text dimColor>{field.label}: </Text>
              <Text>{displayValue}</Text>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

/**
 * Format a value for display.
 */
function formatValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '(not set)';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  const str = String(value);
  // Truncate long values
  if (str.length > 50) {
    return str.slice(0, 47) + '...';
  }
  return str;
}
