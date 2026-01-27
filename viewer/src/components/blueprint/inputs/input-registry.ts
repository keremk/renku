/**
 * Pluggable input editor registry.
 * Allows registering custom editors for specific input names/types.
 */

import type { ComponentType } from "react";
import type { BlueprintInputDef } from "@/types/blueprint-graph";

/**
 * Common props for all input editors.
 */
export interface InputEditorProps {
  input: BlueprintInputDef;
  value: unknown;
  onChange: (value: unknown) => void;
  isEditable: boolean;
}

/**
 * Type for input editor components.
 */
export type InputEditorComponent = ComponentType<InputEditorProps>;

/**
 * Registry of input editors by name pattern.
 * Key can be a string (exact match) or a RegExp (pattern match).
 */
type InputEditorRegistry = Map<string | RegExp, InputEditorComponent>;

// Registry with pattern matching for custom editors
// Add custom editors here as needed:
// registry.set('VoiceId', VoiceIdSelector);
// registry.set(/.*Style$/, StyleEditor);
const registry: InputEditorRegistry = new Map([
  // Future: ['VoiceId', VoiceIdSelector],
  // Future: ['AspectRatio', AspectRatioSelector],
]);

/**
 * Resolves the appropriate editor component for an input.
 * Checks exact match first, then regex patterns, finally falls back to default.
 */
export function getInputEditor(inputName: string): InputEditorComponent | null {
  // Check exact match first
  const exactMatch = registry.get(inputName);
  if (exactMatch) {
    return exactMatch;
  }

  // Check regex patterns
  for (const [pattern, component] of registry) {
    if (pattern instanceof RegExp && pattern.test(inputName)) {
      return component;
    }
  }

  // Return null to use default editor
  return null;
}

/**
 * Registers a custom input editor.
 */
export function registerInputEditor(
  pattern: string | RegExp,
  editor: InputEditorComponent
): void {
  registry.set(pattern, editor);
}

/**
 * Formats a value as a string for display/editing.
 */
export function formatValueAsString(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value) || typeof value === "object") {
    return JSON.stringify(value, null, 2);
  }
  return String(value);
}
