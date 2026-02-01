/**
 * Editor for config properties with type-aware inputs.
 * Shows all unmapped properties from the model's JSON schema.
 * Filters out complex types (object, array) that need specialized editors.
 */

import { useMemo } from "react";
import { AlertCircle } from "lucide-react";
import { ConfigPropertyRow } from "./config-property-row";
import { ModelSelector } from "./model-selector";
import { isComplexProperty } from "./config-utils";
import { PropertyRow } from "../shared/property-row";
import type { ConfigProperty } from "@/types/blueprint-graph";
import type { AvailableModelOption, ModelSelectionValue } from "@/types/blueprint-graph";

interface ConfigPropertiesEditorProps {
  /** List of config properties from the model schema */
  properties: ConfigProperty[];
  /** Current config values */
  values: Record<string, unknown>;
  /** Whether editing is enabled */
  isEditable: boolean;
  /** Callback when a config value changes */
  onChange: (key: string, value: unknown) => void;
  /** Error message if schema failed to load */
  schemaError?: string | null;
  /** Producer ID for model selection */
  producerId?: string;
  /** Available models for selection */
  availableModels?: AvailableModelOption[];
  /** Current model selection */
  currentModelSelection?: ModelSelectionValue;
  /** Whether this is a composition producer (no model needed) */
  isComposition?: boolean;
  /** Callback when model selection changes */
  onModelChange?: (selection: ModelSelectionValue) => void;
}

/**
 * Renders a form for editing config properties.
 * Lists all properties flat (required first, then optional, both sorted alphabetically).
 * Optionally renders model selection as the first row.
 */
export function ConfigPropertiesEditor({
  properties,
  values,
  isEditable,
  onChange,
  schemaError,
  producerId,
  availableModels,
  currentModelSelection,
  isComposition = false,
  onModelChange,
}: ConfigPropertiesEditorProps) {
  // Combine all properties into a flat sorted list (required first, then optional)
  const { sortedProperties, complexCount } = useMemo(() => {
    const required: ConfigProperty[] = [];
    const optional: ConfigProperty[] = [];
    let complex = 0;

    for (const prop of properties) {
      if (isComplexProperty(prop)) {
        complex++;
        continue;
      }
      if (prop.required) {
        required.push(prop);
      } else {
        optional.push(prop);
      }
    }

    // Sort alphabetically within each group
    required.sort((a, b) => a.key.localeCompare(b.key));
    optional.sort((a, b) => a.key.localeCompare(b.key));

    return { sortedProperties: [...required, ...optional], complexCount: complex };
  }, [properties]);

  // Show error state when schema failed to load
  if (schemaError) {
    return (
      <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
        <AlertCircle className="size-4 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Failed to load config schema</p>
          <p className="text-xs mt-1 text-destructive/80">{schemaError}</p>
        </div>
      </div>
    );
  }

  // Check if we should show model selection
  const showModelSelection = producerId && availableModels && onModelChange && !isComposition;

  // No properties and no model selection
  if (properties.length === 0 && !showModelSelection) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        No configurable properties available.
      </div>
    );
  }

  // Only complex properties, no model selection
  if (sortedProperties.length === 0 && complexCount > 0 && !showModelSelection) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        {complexCount} complex {complexCount === 1 ? "property" : "properties"} not shown (requires specialized editor).
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Model selection row (first) */}
      {showModelSelection && (
        <PropertyRow name="Model" type="select" required>
          <ModelSelector
            producerId={producerId}
            availableModels={availableModels}
            currentSelection={currentModelSelection}
            isEditable={isEditable}
            onChange={onModelChange}
          />
        </PropertyRow>
      )}

      {/* All properties in flat list */}
      {sortedProperties.map((prop) => (
        <ConfigPropertyRow
          key={prop.key}
          property={prop}
          value={values[prop.key]}
          isEditable={isEditable}
          onChange={(value) => onChange(prop.key, value)}
        />
      ))}

      {/* Hidden complex properties indicator */}
      {complexCount > 0 && (
        <div className="text-xs text-muted-foreground italic">
          {complexCount} complex {complexCount === 1 ? "property" : "properties"} not shown.
        </div>
      )}
    </div>
  );
}
