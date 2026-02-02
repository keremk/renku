/**
 * Editor for config properties with type-aware inputs.
 * Shows all unmapped properties from the model's JSON schema.
 * Supports specialized editors for complex types via the config editor registry.
 */

import { useMemo, type ComponentType } from "react";
import { AlertCircle } from "lucide-react";
import { ConfigPropertyRow } from "./config-property-row";
import { ModelSelector } from "./model-selector";
import { NestedModelSelector } from "./nested-model-selector";
import { isComplexProperty } from "./config-utils";
import { getNestedModelSelection } from "./stt-helpers";
import { getEditorComponent, type ConfigEditorProps } from "./config-editors";
import { PropertyRow, MediaGrid } from "../shared";
import type { ConfigProperty, NestedModelConfigSchema } from "@/types/blueprint-graph";
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
  /** Nested model schemas (if this producer has nested model declarations) */
  nestedModelSchemas?: NestedModelConfigSchema[];
  /** Callback when nested model selection changes */
  onNestedModelChange?: (nestedSchema: NestedModelConfigSchema, provider: string, model: string) => void;
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
  nestedModelSchemas,
  onNestedModelChange,
}: ConfigPropertiesEditorProps) {
  // Categorize properties into primitive, object-with-editor, and unhandled
  const { primitiveProps, objectPropsWithEditor, unhandledComplexCount } = useMemo(() => {
    const required: ConfigProperty[] = [];
    const optional: ConfigProperty[] = [];
    const withEditor: Array<{
      property: ConfigProperty;
      Editor: ComponentType<ConfigEditorProps<unknown>>;
    }> = [];
    let unhandled = 0;

    for (const prop of properties) {
      if (isComplexProperty(prop)) {
        // Check if there's a registered editor for this property
        const Editor = getEditorComponent(prop.key);
        if (Editor) {
          withEditor.push({ property: prop, Editor });
        } else {
          unhandled++;
        }
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

    return {
      primitiveProps: [...required, ...optional],
      objectPropsWithEditor: withEditor,
      unhandledComplexCount: unhandled,
    };
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

  // Check if there's any displayable content
  const hasDisplayableContent =
    primitiveProps.length > 0 || objectPropsWithEditor.length > 0;

  // No properties and no model selection
  if (properties.length === 0 && !showModelSelection) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        No configurable properties available.
      </div>
    );
  }

  // Only unhandled complex properties, no model selection, no editors
  if (!hasDisplayableContent && unhandledComplexCount > 0 && !showModelSelection) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        {unhandledComplexCount} complex{" "}
        {unhandledComplexCount === 1 ? "property" : "properties"} not shown
        (requires specialized editor).
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

      {/* Nested model selectors (after main Model row) */}
      {nestedModelSchemas && nestedModelSchemas.length > 0 && onNestedModelChange && nestedModelSchemas.map((nestedSchema) => {
        const nestedSel = getNestedModelSelection(
          currentModelSelection,
          nestedSchema.declaration.configPath
        );
        return (
          <PropertyRow
            key={nestedSchema.declaration.name}
            name={nestedSchema.declaration.description ?? nestedSchema.declaration.name}
            type="select"
            required={nestedSchema.declaration.required}
          >
            <NestedModelSelector
              nestedSchema={nestedSchema}
              currentProvider={nestedSel?.provider}
              currentModel={nestedSel?.model}
              isEditable={isEditable}
              onChange={(provider, model) =>
                onNestedModelChange(nestedSchema, provider, model)
              }
            />
          </PropertyRow>
        );
      })}

      {/* Primitive properties in flat list */}
      {primitiveProps.map((prop) => (
        <ConfigPropertyRow
          key={prop.key}
          property={prop}
          value={values[prop.key]}
          isEditable={isEditable}
          onChange={(value) => onChange(prop.key, value)}
        />
      ))}

      {/* Object properties with registered editors */}
      {objectPropsWithEditor.length > 0 && (
        <MediaGrid className="grid-cols-1 mt-4">
          {objectPropsWithEditor.map(({ property, Editor }) => (
            <Editor
              key={property.key}
              value={values[property.key]}
              isEditable={isEditable}
              onChange={(value) => onChange(property.key, value)}
            />
          ))}
        </MediaGrid>
      )}

      {/* Hidden complex properties indicator */}
      {unhandledComplexCount > 0 && (
        <div className="text-xs text-muted-foreground italic">
          {unhandledComplexCount} complex{" "}
          {unhandledComplexCount === 1 ? "property" : "properties"} not shown.
        </div>
      )}
    </div>
  );
}
