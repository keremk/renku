import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { FormFieldConfig } from '../utils/schema-to-fields.js';

/**
 * Props for all form field components.
 */
export interface FieldProps {
  field: FormFieldConfig;
  value: unknown;
  onChange: (value: unknown) => void;
  isFocused: boolean;
}

/**
 * Text input field component.
 */
export const TextField: React.FC<FieldProps> = ({ field, value, onChange, isFocused }) => {
  const [cursorPosition, setCursorPosition] = useState((value as string)?.length ?? 0);
  const textValue = (value as string) ?? '';

  useInput(
    (input, key) => {
      if (!isFocused) {return;}

      if (key.backspace || key.delete) {
        if (cursorPosition > 0) {
          const newValue = textValue.slice(0, cursorPosition - 1) + textValue.slice(cursorPosition);
          onChange(newValue);
          setCursorPosition(cursorPosition - 1);
        }
      } else if (key.leftArrow) {
        setCursorPosition(Math.max(0, cursorPosition - 1));
      } else if (key.rightArrow) {
        setCursorPosition(Math.min(textValue.length, cursorPosition + 1));
      } else if (!key.ctrl && !key.meta && input) {
        const newValue = textValue.slice(0, cursorPosition) + input + textValue.slice(cursorPosition);
        onChange(newValue);
        setCursorPosition(cursorPosition + input.length);
      }
    },
    { isActive: isFocused },
  );

  // Display the text with a cursor indicator when focused
  const displayValue = isFocused
    ? textValue.slice(0, cursorPosition) + '|' + textValue.slice(cursorPosition)
    : textValue || (field.defaultValue as string) || '';

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={isFocused ? 'cyan' : undefined}>
          {field.label}
          {field.required && <Text color="red">*</Text>}:{' '}
        </Text>
        <Text color={isFocused ? 'white' : 'gray'}>{displayValue || '(empty)'}</Text>
      </Box>
      {isFocused && field.description && (
        <Text dimColor>  {field.description}</Text>
      )}
    </Box>
  );
};

/**
 * Number input field component.
 */
export const NumberField: React.FC<FieldProps> = ({ field, value, onChange, isFocused }) => {
  const [inputBuffer, setInputBuffer] = useState('');
  const numValue = value as number | undefined;

  useInput(
    (input, key) => {
      if (!isFocused) {return;}

      if (key.backspace || key.delete) {
        if (inputBuffer.length > 0) {
          const newBuffer = inputBuffer.slice(0, -1);
          setInputBuffer(newBuffer);
          onChange(newBuffer ? parseFloat(newBuffer) : undefined);
        } else if (numValue !== undefined) {
          const str = String(numValue).slice(0, -1);
          setInputBuffer(str);
          onChange(str ? parseFloat(str) : undefined);
        }
      } else if (/^[\d.-]$/.test(input)) {
        const newBuffer = inputBuffer + input;
        const parsed = parseFloat(newBuffer);
        if (!isNaN(parsed)) {
          setInputBuffer(newBuffer);
          // Apply min/max constraints
          let constrained = parsed;
          if (field.min !== undefined && parsed < field.min) {constrained = field.min;}
          if (field.max !== undefined && parsed > field.max) {constrained = field.max;}
          onChange(constrained);
        }
      }
    },
    { isActive: isFocused },
  );

  const displayValue =
    inputBuffer || (numValue !== undefined ? String(numValue) : (field.defaultValue as string) ?? '');
  const constraints = [];
  if (field.min !== undefined) {constraints.push(`min: ${field.min}`);}
  if (field.max !== undefined) {constraints.push(`max: ${field.max}`);}

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={isFocused ? 'cyan' : undefined}>
          {field.label}
          {field.required && <Text color="red">*</Text>}:{' '}
        </Text>
        <Text color={isFocused ? 'white' : 'gray'}>{displayValue || '(empty)'}</Text>
        {constraints.length > 0 && <Text dimColor> ({constraints.join(', ')})</Text>}
      </Box>
      {isFocused && field.description && (
        <Text dimColor>  {field.description}</Text>
      )}
    </Box>
  );
};

/**
 * Boolean toggle field component.
 */
export const BooleanField: React.FC<FieldProps> = ({ field, value, onChange, isFocused }) => {
  const boolValue = (value as boolean) ?? (field.defaultValue as boolean) ?? false;

  useInput(
    (input, key) => {
      if (!isFocused) {return;}

      if (input === ' ' || key.return) {
        onChange(!boolValue);
      } else if (input === 'y' || input === 'Y') {
        onChange(true);
      } else if (input === 'n' || input === 'N') {
        onChange(false);
      }
    },
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={isFocused ? 'cyan' : undefined}>
          {field.label}
          {field.required && <Text color="red">*</Text>}:{' '}
        </Text>
        <Text color={boolValue ? 'green' : 'red'}>{boolValue ? '[✓] Yes' : '[ ] No'}</Text>
        {isFocused && <Text dimColor> (space to toggle)</Text>}
      </Box>
      {isFocused && field.description && (
        <Text dimColor>  {field.description}</Text>
      )}
    </Box>
  );
};

/**
 * Select field component with arrow navigation.
 */
export const SelectField: React.FC<FieldProps> = ({ field, value, onChange, isFocused }) => {
  const options = useMemo(() => field.options ?? [], [field.options]);
  const currentValue = value ?? field.defaultValue;
  const selectedIndex = options.findIndex((opt) => opt.value === currentValue);
  const [highlightIndex, setHighlightIndex] = useState(selectedIndex >= 0 ? selectedIndex : 0);

  useInput(
    (input, key) => {
      if (!isFocused) {return;}

      if (key.upArrow) {
        setHighlightIndex((i) => Math.max(0, i - 1));
      } else if (key.downArrow) {
        setHighlightIndex((i) => Math.min(options.length - 1, i + 1));
      } else if (key.return || input === ' ') {
        const selected = options[highlightIndex];
        if (selected) {
          onChange(selected.value);
        }
      }
    },
    { isActive: isFocused },
  );

  // Update highlight when value changes externally
  React.useEffect(() => {
    const idx = options.findIndex((opt) => opt.value === currentValue);
    if (idx >= 0) {setHighlightIndex(idx);}
  }, [currentValue, options]);

  const selectedOption = options.find((opt) => opt.value === currentValue);

  if (!isFocused) {
    // Collapsed view when not focused
    return (
      <Box>
        <Text bold>
          {field.label}
          {field.required && <Text color="red">*</Text>}:{' '}
        </Text>
        <Text color="gray">{selectedOption?.label ?? '(not selected)'}</Text>
      </Box>
    );
  }

  // Expanded view when focused
  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        {field.label}
        {field.required && <Text color="red">*</Text>}:
      </Text>
      {field.description && <Text dimColor>  {field.description}</Text>}
      <Box flexDirection="column" marginLeft={2}>
        {options.map((option, index) => {
          const isHighlighted = index === highlightIndex;
          const isSelected = option.value === currentValue;
          return (
            <Box key={String(option.value)}>
              <Text color={isHighlighted ? 'cyan' : undefined}>
                {isHighlighted ? '>' : ' '} {isSelected ? '●' : '○'} {option.label}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Text dimColor>  ↑↓ to navigate, Enter to select</Text>
    </Box>
  );
};

/**
 * Renders the appropriate field component based on field type.
 */
export const FormField: React.FC<FieldProps> = (props) => {
  switch (props.field.type) {
    case 'boolean':
      return <BooleanField {...props} />;
    case 'number':
      return <NumberField {...props} />;
    case 'select':
      return <SelectField {...props} />;
    case 'multiline':
    case 'text':
    default:
      return <TextField {...props} />;
  }
};

/**
 * Hook to manage form state for multiple fields.
 */
export function useFormState(fields: FormFieldConfig[]): {
  values: Record<string, unknown>;
  setValue: (name: string, value: unknown) => void;
  getFieldProps: (field: FormFieldConfig, isFocused: boolean) => FieldProps;
  isValid: boolean;
} {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const field of fields) {
      if (field.defaultValue !== undefined) {
        initial[field.name] = field.defaultValue;
      }
    }
    return initial;
  });

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [name]: value }));
  }, []);

  const getFieldProps = useCallback(
    (field: FormFieldConfig, isFocused: boolean): FieldProps => ({
      field,
      value: values[field.name],
      onChange: (value: unknown) => setValue(field.name, value),
      isFocused,
    }),
    [values, setValue],
  );

  const isValid = fields.every((field) => {
    if (!field.required) {return true;}
    const value = values[field.name];
    return value !== undefined && value !== '' && value !== null;
  });

  return { values, setValue, getFieldProps, isValid };
}
