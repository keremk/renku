import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2 } from "lucide-react";
import type { BlueprintInputDef } from "@/types/blueprint-graph";
import { CollapsibleSection, MediaGrid } from "./shared";
import { DefaultTextEditor } from "./inputs/default-text-editor";
import { MediaInputCard, AddMediaCard } from "./inputs/media-input-card";
import { TextInputCard } from "./inputs/text-input-card";
import { FileUploadDialog } from "./inputs/file-upload-dialog";
import type { InputEditorProps } from "./inputs/input-registry";
import { useAutoSave } from "@/hooks/use-auto-save";
import {
  categorizeInputs,
  getMediaTypeFromInput,
  type MediaType,
} from "@/lib/input-utils";
import { parseFileRef, type MediaInputType } from "@/data/blueprint-client";
import {
  uploadAndValidate,
  getInputNameFromNodeId,
  getSelectionStyles,
  getSectionHighlightStyles,
} from "@/lib/panel-utils";

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
  /** Blueprint folder path for file uploads */
  blueprintFolder?: string | null;
  /** Movie ID for the current build */
  movieId?: string | null;
}

export function InputsPanel({
  inputs,
  inputValues,
  selectedNodeId,
  isEditable = false,
  onSave,
  blueprintFolder = null,
  movieId = null,
}: InputsPanelProps) {
  // Create a map of input values by name
  const initialValueMap = useMemo(() => {
    const map: Record<string, unknown> = {};
    for (const iv of inputValues) {
      map[iv.name] = iv.value;
    }
    return map;
  }, [inputValues]);

  // Track all input values locally
  const [allValues, setAllValues] = useState<Record<string, unknown>>(initialValueMap);

  // Reset values when input values change (e.g., build selection change)
  useEffect(() => {
    setAllValues(initialValueMap);
  }, [initialValueMap]);

  // Handle save with auto-save
  const handleSave = useCallback(
    async (values: Record<string, unknown>) => {
      if (onSave) {
        await onSave(values);
      }
    },
    [onSave]
  );

  // Auto-save hook
  const { isSaving } = useAutoSave({
    data: allValues,
    onSave: handleSave,
    debounceMs: 1000,
    enabled: isEditable && !!onSave,
    initialData: initialValueMap,
  });

  // Get the current value for an input
  const getValue = useCallback(
    (name: string): unknown => {
      return allValues[name];
    },
    [allValues]
  );

  // Handle value change
  const handleValueChange = useCallback((name: string, value: unknown) => {
    setAllValues((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  // Categorize inputs
  const categorized = useMemo(() => categorizeInputs(inputs), [inputs]);

  // Determine which input is selected based on node ID
  const selectedInputName = getInputNameFromNodeId(selectedNodeId);

  if (inputs.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No inputs defined in this blueprint.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Saving indicator */}
      {isSaving && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          <span>Saving...</span>
        </div>
      )}

      {/* Media inputs - one section per input */}
      {categorized.media.length > 0 && (
        <div className="space-y-4">
          {categorized.media.map((input) => (
            <MediaInputSection
              key={input.name}
              input={input}
              value={getValue(input.name)}
              onChange={(value) => handleValueChange(input.name, value)}
              isEditable={isEditable}
              isSelected={selectedInputName === input.name}
              blueprintFolder={blueprintFolder}
              movieId={movieId}
            />
          ))}
        </div>
      )}

      {/* Text inputs - single section for all */}
      {categorized.text.length > 0 && (
        <CollapsibleSection
          title="Text Inputs"
          count={categorized.text.length}
          defaultOpen
        >
          <MediaGrid>
            {categorized.text.map((input) => (
              <TextInputCard
                key={input.name}
                input={input}
                value={getValue(input.name)}
                onChange={(value) => handleValueChange(input.name, value)}
                isEditable={isEditable}
              />
            ))}
          </MediaGrid>
        </CollapsibleSection>
      )}

      {/* Other inputs - single section for all */}
      {categorized.other.length > 0 && (
        <CollapsibleSection
          title="Other Inputs"
          count={categorized.other.length}
          defaultOpen
        >
          <div className="space-y-3">
            {categorized.other.map((input) => {
              const value = getValue(input.name);
              const isSelected = selectedInputName === input.name;

              return (
                <OtherInputCard
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
        </CollapsibleSection>
      )}
    </div>
  );
}

// ============================================================================
// Media Input Section
// ============================================================================

interface MediaInputSectionProps {
  input: BlueprintInputDef;
  value: unknown;
  onChange: (value: unknown) => void;
  isEditable: boolean;
  isSelected: boolean;
  blueprintFolder: string | null;
  movieId: string | null;
}

function MediaInputSection({
  input,
  value,
  onChange,
  isEditable,
  isSelected,
  blueprintFolder,
  movieId,
}: MediaInputSectionProps) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const isArray = input.type === "array";
  const mediaType = getMediaTypeFromInput(input.type, input.itemType) ?? "image";

  // Get array items or single item
  const items = useMemo(() => {
    if (isArray && Array.isArray(value)) {
      return value.filter((v) => parseFileRef(v) !== null);
    }
    if (!isArray && parseFileRef(value) !== null) {
      return [value];
    }
    return [];
  }, [value, isArray]);

  const itemCount = items.length;
  const canAddMore = isArray; // Can always add more to arrays
  const showAddButton = isEditable && canAddMore;

  // Handle adding new files to array
  const handleAddFiles = useCallback(
    async (files: File[]) => {
      const result = await uploadAndValidate(
        { blueprintFolder, movieId },
        files,
        mediaType as MediaInputType
      );

      const newRefs = result.files.map((f) => f.fileRef);
      const existingRefs = Array.isArray(value)
        ? value.filter((v) => typeof v === "string" && v.startsWith("file:"))
        : [];

      onChange([...existingRefs, ...newRefs]);
    },
    [blueprintFolder, movieId, mediaType, value, onChange]
  );

  // Handle removing item from array
  const handleRemoveArrayItem = useCallback(
    (index: number) => {
      if (Array.isArray(value)) {
        const newArray = [...value];
        newArray.splice(index, 1);
        onChange(newArray);
      }
    },
    [value, onChange]
  );

  return (
    <CollapsibleSection
      title={input.name}
      count={itemCount}
      description={input.description}
      defaultOpen
      className={getSectionHighlightStyles(isSelected, "blue")}
    >
      <MediaGrid>
        {/* Render existing items */}
        {isArray
          ? items.map((_, index) => (
              <MediaInputCard
                key={`${input.name}-${index}`}
                input={input}
                value={value}
                onChange={onChange}
                isEditable={isEditable}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
                arrayIndex={index}
                onRemoveArrayItem={handleRemoveArrayItem}
              />
            ))
          : items.length > 0 && (
              <MediaInputCard
                input={input}
                value={value}
                onChange={onChange}
                isEditable={isEditable}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
              />
            )}

        {/* Empty state for single items */}
        {!isArray && items.length === 0 && (
          <MediaInputCard
            input={input}
            value={value}
            onChange={onChange}
            isEditable={isEditable}
            blueprintFolder={blueprintFolder}
            movieId={movieId}
          />
        )}

        {/* Add button for arrays */}
        {showAddButton && (
          <AddMediaCard
            mediaType={mediaType as MediaType}
            onAdd={() => setAddDialogOpen(true)}
            disabled={!blueprintFolder || !movieId}
          />
        )}
      </MediaGrid>

      <FileUploadDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        mediaType={mediaType}
        multiple={true}
        onConfirm={handleAddFiles}
      />
    </CollapsibleSection>
  );
}

// ============================================================================
// Other Input Card (form-based)
// ============================================================================

interface OtherInputCardProps {
  input: BlueprintInputDef;
  value: unknown;
  isSelected: boolean;
  isEditable: boolean;
  onChange: (value: unknown) => void;
}

function OtherInputCard({
  input,
  value,
  isSelected,
  isEditable,
  onChange,
}: OtherInputCardProps) {
  const editorProps: InputEditorProps = {
    input,
    value,
    onChange,
    isEditable,
  };

  return (
    <div
      className={`p-3 rounded-lg border transition-all ${getSelectionStyles(isSelected, "blue")}`}
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
          <DefaultTextEditor {...editorProps} />
        </div>
      </div>
    </div>
  );
}
