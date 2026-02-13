/**
 * Default text editor for input values.
 * Handles both short and long text with appropriate input types.
 */

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { InputEditorProps } from "./input-registry";
import { formatValueAsString } from "./input-registry";

/**
 * Read-only value display component.
 */
function ReadOnlyValue({ value }: { value: unknown }) {
  const hasValue = value !== undefined && value !== null && value !== "";

  if (!hasValue) {
    return (
      <span className="text-xs text-muted-foreground/60 italic">
        not provided
      </span>
    );
  }

  return (
    <div className="text-xs text-foreground font-mono bg-muted/70 px-2 py-1 rounded border border-border/50 break-all whitespace-pre-wrap max-h-48 overflow-y-auto">
      {formatValueAsString(value)}
    </div>
  );
}

/**
 * Check if the input type is numeric (int or number).
 */
function isNumericType(type: string): boolean {
  return type === "int" || type === "integer" || type === "number";
}

/**
 * Parse a string value to a number, returning undefined for empty/invalid values.
 */
function parseNumericValue(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/**
 * Default text editor that handles both short and long text.
 * Uses Input for short text and Textarea for long/multiline text.
 * Properly converts numeric types to numbers.
 */
export function DefaultTextEditor({
  input,
  value,
  onChange,
  isEditable,
}: InputEditorProps) {
  const stringValue = formatValueAsString(value);
  const isLongText = stringValue.length > 100 || stringValue.includes("\n");
  const isNumeric = isNumericType(input.type);

  // Handler that converts to number for numeric types
  const handleChange = (newValue: string) => {
    if (isNumeric) {
      onChange(parseNumericValue(newValue));
    } else {
      onChange(newValue);
    }
  };

  if (!isEditable) {
    return <ReadOnlyValue value={value} />;
  }

  if (isLongText) {
    return (
      <Textarea
        value={stringValue}
        onChange={(e) => handleChange(e.target.value)}
        className="text-xs font-mono min-h-[60px] max-h-48 resize-y
          bg-muted/30 border-border/50
          focus:bg-background focus:border-primary/50"
        placeholder={`Enter ${input.name}...`}
      />
    );
  }

  return (
    <Input
      type={isNumeric ? "number" : "text"}
      value={stringValue}
      onChange={(e) => handleChange(e.target.value)}
      className="text-xs font-mono h-8
        bg-muted/30 border-border/50
        focus:bg-background focus:border-primary/50"
      placeholder={`Enter ${input.name}...`}
    />
  );
}
