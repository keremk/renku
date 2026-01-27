import { useState, useEffect, useCallback, useMemo } from "react";
import type { BlueprintInputDef } from "@/types/blueprint-graph";
import { Button } from "@/components/ui/button";
import { formatValueAsString } from "./inputs/input-registry";
import { DefaultTextEditor } from "./inputs/default-text-editor";
import type { InputEditorProps } from "./inputs/input-registry";

interface InputValue {
  name: string;
  value?: unknown;
}

interface InputsPanelProps {
  inputs: BlueprintInputDef[];
  inputValues: InputValue[];
  selectedNodeId: string | null;
  /** Whether inputs are editable (requires buildId) */
  isEditable?: boolean;
  /** Callback when inputs are saved */
  onSave?: (values: Record<string, unknown>) => Promise<void>;
  /** Whether editing can be enabled for this build (build exists but no inputs.yaml) */
  canEnableEditing?: boolean;
  /** Callback to enable editing for this build */
  onEnableEditing?: () => Promise<void>;
}

export function InputsPanel({
  inputs,
  inputValues,
  selectedNodeId,
  isEditable = false,
  onSave,
  canEnableEditing = false,
  onEnableEditing,
}: InputsPanelProps) {
  const [isEnabling, setIsEnabling] = useState(false);

  // Handle enable editing
  const handleEnableEditing = useCallback(async () => {
    if (!onEnableEditing) return;
    setIsEnabling(true);
    try {
      await onEnableEditing();
    } finally {
      setIsEnabling(false);
    }
  }, [onEnableEditing]);
  // Create a map of input values by name
  const initialValueMap = useMemo(() => {
    const map = new Map<string, unknown>();
    for (const iv of inputValues) {
      map.set(iv.name, iv.value);
    }
    return map;
  }, [inputValues]);

  // Track edit values locally
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);

  // Reset edit values when input values change (e.g., build selection change)
  useEffect(() => {
    setEditValues({});
  }, [inputValues]);

  // Compute if there are unsaved changes
  const isDirty = useMemo(() => {
    for (const [name, value] of Object.entries(editValues)) {
      const originalValue = initialValueMap.get(name);
      if (formatValueAsString(value) !== formatValueAsString(originalValue)) {
        return true;
      }
    }
    return false;
  }, [editValues, initialValueMap]);

  // Get the current value for an input (edited or original)
  const getValue = useCallback(
    (name: string): unknown => {
      if (name in editValues) {
        return editValues[name];
      }
      return initialValueMap.get(name);
    },
    [editValues, initialValueMap]
  );

  // Handle value change
  const handleValueChange = useCallback((name: string, value: unknown) => {
    setEditValues((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!onSave || !isDirty) return;

    setIsSaving(true);
    try {
      // Merge original values with edited values
      const allValues: Record<string, unknown> = {};
      for (const [name, value] of initialValueMap) {
        allValues[name] = name in editValues ? editValues[name] : value;
      }
      // Also include any new values from edits that weren't in original
      for (const [name, value] of Object.entries(editValues)) {
        if (!(name in allValues)) {
          allValues[name] = value;
        }
      }
      await onSave(allValues);
      // Clear edit state after successful save
      setEditValues({});
    } finally {
      setIsSaving(false);
    }
  }, [onSave, isDirty, initialValueMap, editValues]);

  // Determine which input is selected based on node ID
  const selectedInputName = selectedNodeId?.startsWith("Input:")
    ? selectedNodeId.replace("Input:", "").split(".").pop()
    : null;

  if (inputs.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No inputs defined in this blueprint.
      </div>
    );
  }

  return (
    <div className="space-y-3 max-w-2xl mx-auto">
      {/* Enable Editing banner for read-only builds */}
      {canEnableEditing && !isEditable && (
        <div className="flex items-center justify-between p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 mb-4">
          <div>
            <p className="text-sm font-medium text-foreground">
              Read-only inputs
            </p>
            <p className="text-xs text-muted-foreground">
              This build was created via CLI. Enable editing to modify inputs.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={handleEnableEditing}
            disabled={isEnabling}
            className="h-8 px-3 text-xs border-amber-500/50 hover:bg-amber-500/20"
          >
            {isEnabling ? "Enabling..." : "Enable Editing"}
          </Button>
        </div>
      )}

      {/* Header with save button */}
      {isEditable && (
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">
            Edit Inputs
          </h3>
          {isDirty && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
              className="h-7 px-3 text-xs"
            >
              {isSaving ? "Saving..." : "Save Changes"}
            </Button>
          )}
        </div>
      )}

      {inputs.map((input) => {
        const value = getValue(input.name);
        const isSelected = selectedInputName === input.name;

        return (
          <InputCard
            key={input.name}
            input={input}
            value={value}
            isSelected={isSelected}
            isEditable={isEditable}
            onChange={(newValue) => handleValueChange(input.name, newValue)}
          />
        );
      })}
    </div>
  );
}

interface InputCardProps {
  input: BlueprintInputDef;
  value: unknown;
  isSelected: boolean;
  isEditable: boolean;
  onChange: (value: unknown) => void;
}

function InputCard({
  input,
  value,
  isSelected,
  isEditable,
  onChange,
}: InputCardProps) {
  const editorProps: InputEditorProps = {
    input,
    value,
    onChange,
    isEditable,
  };

  return (
    <div
      className={`
        p-3 rounded-lg border transition-all
        ${
          isSelected
            ? "border-blue-400 bg-blue-500/10 ring-1 ring-blue-400/30"
            : "border-border/40 bg-muted/30"
        }
      `}
    >
      <div className="grid grid-cols-2 gap-4">
        {/* Left column: name, type, required badge, description */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-foreground">
              {input.name}
            </span>
            <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
              {input.type}
            </span>
            {input.required && (
              <span className="text-xs text-amber-400">required</span>
            )}
          </div>
          {input.description && (
            <p className="text-xs text-muted-foreground">{input.description}</p>
          )}
        </div>

        {/* Right column: editor component */}
        <div className="min-w-0">
          <InputEditor inputName={input.name} editorProps={editorProps} />
        </div>
      </div>
    </div>
  );
}

/**
 * Wrapper component to render the appropriate input editor.
 * Currently uses DefaultTextEditor for all inputs.
 * Future: add custom editors via the input registry pattern.
 */
function InputEditor({
  editorProps,
}: {
  inputName: string;
  editorProps: InputEditorProps;
}) {
  // For now, use the default text editor for all inputs
  // Custom editors can be added via the registry pattern when needed
  return <DefaultTextEditor {...editorProps} />;
}
