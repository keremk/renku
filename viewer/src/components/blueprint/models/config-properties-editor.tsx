/**
 * Editor for config properties with type-aware inputs.
 * Shows all unmapped properties from the model's JSON schema.
 */

import { useMemo } from "react";
import { ConfigPropertyRow } from "./config-property-row";
import type { ConfigProperty } from "@/types/blueprint-graph";

interface ConfigPropertiesEditorProps {
  /** List of config properties from the model schema */
  properties: ConfigProperty[];
  /** Current config values */
  values: Record<string, unknown>;
  /** Whether editing is enabled */
  isEditable: boolean;
  /** Callback when a config value changes */
  onChange: (key: string, value: unknown) => void;
}

/**
 * Renders a form for editing config properties.
 * Groups required properties first, then optional ones.
 */
export function ConfigPropertiesEditor({
  properties,
  values,
  isEditable,
  onChange,
}: ConfigPropertiesEditorProps) {
  // Separate required and optional properties
  const { requiredProps, optionalProps } = useMemo(() => {
    const required: ConfigProperty[] = [];
    const optional: ConfigProperty[] = [];

    for (const prop of properties) {
      if (prop.required) {
        required.push(prop);
      } else {
        optional.push(prop);
      }
    }

    // Sort alphabetically within each group
    required.sort((a, b) => a.key.localeCompare(b.key));
    optional.sort((a, b) => a.key.localeCompare(b.key));

    return { requiredProps: required, optionalProps: optional };
  }, [properties]);

  if (properties.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic py-2">
        No configurable properties available.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Required properties */}
      {requiredProps.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Required Properties ({requiredProps.length})
          </div>
          <div className="grid gap-2">
            {requiredProps.map((prop) => (
              <ConfigPropertyRow
                key={prop.key}
                property={prop}
                value={values[prop.key]}
                isEditable={isEditable}
                onChange={(value) => onChange(prop.key, value)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Optional properties */}
      {optionalProps.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Optional Properties ({optionalProps.length})
          </div>
          <div className="grid gap-2">
            {optionalProps.map((prop) => (
              <ConfigPropertyRow
                key={prop.key}
                property={prop}
                value={values[prop.key]}
                isEditable={isEditable}
                onChange={(value) => onChange(prop.key, value)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
