import { useState, useEffect, useCallback, useMemo } from 'react';
import { FileText, Loader2, Maximize2, Plus, Trash2 } from 'lucide-react';
import type { BlueprintInputDef } from '@/types/blueprint-graph';
import {
  CollapsibleSection,
  MediaCard,
  MediaGrid,
  PropertyRow,
  TextCard,
  TextEditorDialog,
  VideoCard,
  AudioCard,
  ImageCard,
} from './shared';
import { DefaultTextEditor } from './inputs/default-text-editor';
import { InputCardFooter } from './inputs/input-card-footer';
import { EmptyMediaPlaceholder } from './inputs/empty-media-placeholder';
import { FileUploadDialog } from './inputs/file-upload-dialog';
import type { InputEditorProps } from './inputs/input-registry';
import { useAutoSave } from '@/hooks/use-auto-save';
import {
  categorizeInputs,
  filterPanelVisibleInputs,
  getMediaTypeFromInput,
  type MediaType,
} from '@/lib/input-utils';
import { buildInputFileUrl, parseFileRef } from '@/data/blueprint-client';
import {
  uploadAndValidate,
  getInputNameFromNodeId,
  getSectionHighlightStyles,
  toMediaInputType,
  isValidFileRef,
} from '@/lib/panel-utils';
import { Input } from '@/components/ui/input';

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
  /** Callback when inputs are saved (auto-save enabled when provided) */
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
  // Generate a stable key when the input values change to trigger state reset
  const initialValueKey = useMemo(
    () => JSON.stringify(initialValueMap),
    [initialValueMap]
  );
  const [internalValues, setInternalValues] =
    useState<Record<string, unknown>>(initialValueMap);

  // Reset internal state when initialValueMap changes
  // Using the serialized key as dependency ensures we only reset on actual data changes
  useEffect(() => {
    setInternalValues(initialValueMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValueKey]);

  // Handle save with auto-save
  const handleSave = useCallback(
    async (values: Record<string, unknown>) => {
      if (onSave) {
        await onSave(values);
      }
    },
    [onSave]
  );

  // Auto-save hook - enabled when editable and onSave is provided
  const { isSaving } = useAutoSave({
    data: internalValues,
    onSave: handleSave,
    debounceMs: 1000,
    enabled: isEditable && !!onSave,
    initialData: initialValueMap,
  });

  // Get the current value for an input
  const getValue = useCallback(
    (name: string): unknown => {
      return internalValues[name];
    },
    [internalValues]
  );

  // Handle value change
  const handleValueChange = useCallback((name: string, value: unknown) => {
    setInternalValues((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  const visibleInputs = useMemo(
    () => filterPanelVisibleInputs(inputs),
    [inputs]
  );

  // Categorize inputs
  const categorized = useMemo(
    () => categorizeInputs(visibleInputs),
    [visibleInputs]
  );

  // Determine which input is selected based on node ID
  const selectedInputName = getInputNameFromNodeId(selectedNodeId);

  if (visibleInputs.length === 0) {
    return (
      <div className='text-muted-foreground text-sm'>
        No editable inputs defined in this blueprint.
      </div>
    );
  }

  return (
    <div className='space-y-8'>
      {/* Saving indicator */}
      {isSaving && (
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Loader2 className='size-3 animate-spin' />
          <span>Saving...</span>
        </div>
      )}

      {/* Media inputs - one section per input */}
      {categorized.media.length > 0 && (
        <div className='space-y-6'>
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
          title='Text Inputs'
          count={categorized.text.length}
          defaultOpen
        >
          <MediaGrid>
            {categorized.text.map((input) => (
              <TextCard
                key={input.name}
                label={input.name}
                description={input.description}
                value={String(getValue(input.name) ?? '')}
                onChange={(value) => handleValueChange(input.name, value)}
                isEditable={isEditable}
                sizing='aspect'
              />
            ))}
          </MediaGrid>
        </CollapsibleSection>
      )}

      {/* Long-form text arrays (itemType=text) - one section per input */}
      {categorized.textArray.length > 0 && (
        <div className='space-y-6'>
          {categorized.textArray.map((input) => (
            <TextArrayInputSection
              key={input.name}
              input={input}
              value={getValue(input.name)}
              onChange={(value) => handleValueChange(input.name, value)}
              isEditable={isEditable}
              isSelected={selectedInputName === input.name}
            />
          ))}
        </div>
      )}

      {/* Short-form string arrays (itemType=string) - one section per input */}
      {categorized.stringArray.length > 0 && (
        <div className='space-y-6'>
          {categorized.stringArray.map((input) => (
            <StringArrayInputSection
              key={input.name}
              input={input}
              value={getValue(input.name)}
              onChange={(value) => handleValueChange(input.name, value)}
              isEditable={isEditable}
              isSelected={selectedInputName === input.name}
            />
          ))}
        </div>
      )}

      {/* Other inputs - single section for all */}
      {categorized.other.length > 0 && (
        <CollapsibleSection
          title='Other Inputs'
          count={categorized.other.length}
          defaultOpen
        >
          <div className='space-y-4'>
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
                  onChange={(newValue) =>
                    handleValueChange(input.name, newValue)
                  }
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

  const isArray = input.type === 'array';
  const mediaType = getMediaTypeFromInput(input.type, input.itemType);
  if (!mediaType) {
    throw new Error(
      `Expected media input type for "${input.name}" but received type="${input.type}" itemType="${input.itemType ?? 'undefined'}".`
    );
  }

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
  const isDisabled = !blueprintFolder || !movieId;

  // Handle adding new files to array
  const handleAddFiles = useCallback(
    async (files: File[]) => {
      const result = await uploadAndValidate(
        { blueprintFolder, movieId },
        files,
        toMediaInputType(mediaType)
      );

      const newRefs = result.files.map((f) => f.fileRef);
      const existingRefs = Array.isArray(value)
        ? value.filter((v) => isValidFileRef(v))
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
      className={getSectionHighlightStyles(isSelected, 'primary')}
    >
      <MediaGrid>
        {/* Render existing items */}
        {isArray
          ? items.map((_, index) => (
              <MediaInputItemCard
                key={`${input.name}-${index}`}
                input={input}
                value={value}
                onChange={onChange}
                isEditable={isEditable}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
                mediaType={mediaType}
                arrayIndex={index}
                onRemoveArrayItem={handleRemoveArrayItem}
              />
            ))
          : items.length > 0 && (
              <MediaInputItemCard
                input={input}
                value={value}
                onChange={onChange}
                isEditable={isEditable}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
                mediaType={mediaType}
              />
            )}

        {/* Empty state for single items */}
        {!isArray && items.length === 0 && (
          <MediaInputItemCard
            input={input}
            value={value}
            onChange={onChange}
            isEditable={isEditable}
            blueprintFolder={blueprintFolder}
            movieId={movieId}
            mediaType={mediaType}
          />
        )}

        {/* Add button for arrays */}
        {showAddButton && (
          <AddMediaPlaceholder
            mediaType={mediaType as MediaType}
            onAdd={() => setAddDialogOpen(true)}
            disabled={isDisabled}
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
// Media Input Item Card (uses shared VideoCard/AudioCard/ImageCard)
// ============================================================================

interface MediaInputItemCardProps {
  input: BlueprintInputDef;
  value: unknown;
  onChange: (value: unknown) => void;
  isEditable: boolean;
  blueprintFolder: string | null;
  movieId: string | null;
  mediaType: MediaType;
  arrayIndex?: number;
  onRemoveArrayItem?: (index: number) => void;
}

function MediaInputItemCard({
  input,
  value,
  onChange,
  isEditable,
  blueprintFolder,
  movieId,
  mediaType,
  arrayIndex,
  onRemoveArrayItem,
}: MediaInputItemCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Parse file reference from value
  const fileRef = useMemo(() => {
    if (arrayIndex !== undefined && Array.isArray(value)) {
      return parseFileRef(value[arrayIndex]);
    }
    return parseFileRef(value);
  }, [value, arrayIndex]);

  // Build URL for preview
  const fileUrl = useMemo(() => {
    if (!blueprintFolder || !movieId || !fileRef) return null;
    return buildInputFileUrl(blueprintFolder, movieId, fileRef);
  }, [blueprintFolder, movieId, fileRef]);

  // Handle file upload
  const handleUpload = useCallback(
    async (files: File[]) => {
      const result = await uploadAndValidate(
        { blueprintFolder, movieId },
        files,
        toMediaInputType(mediaType)
      );

      const newRef = result.files[0].fileRef;

      if (arrayIndex !== undefined && Array.isArray(value)) {
        // Replace item in array
        const newArray = [...value];
        newArray[arrayIndex] = newRef;
        onChange(newArray);
      } else {
        // Replace single value
        onChange(newRef);
      }
    },
    [blueprintFolder, movieId, mediaType, arrayIndex, value, onChange]
  );

  // Handle remove
  const handleRemove = useCallback(() => {
    if (arrayIndex !== undefined && onRemoveArrayItem) {
      onRemoveArrayItem(arrayIndex);
    } else {
      onChange(undefined);
    }
  }, [arrayIndex, onRemoveArrayItem, onChange]);

  const isArray = input.type === 'array';
  const canRemove = isArray && arrayIndex !== undefined;
  const isDisabled = !blueprintFolder || !movieId;
  const label =
    arrayIndex !== undefined ? `${input.name}[${arrayIndex}]` : input.name;

  // No file - show placeholder
  if (!fileUrl) {
    return (
      <>
        <EmptyMediaPlaceholder
          mediaType={mediaType}
          onClick={() => setDialogOpen(true)}
          disabled={!isEditable || isDisabled}
        />
        <FileUploadDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mediaType={mediaType}
          multiple={false}
          onConfirm={handleUpload}
        />
      </>
    );
  }

  // Build footer for the card
  const footer = (
    <InputCardFooter
      label={label}
      description={input.description}
      onEdit={isEditable ? () => setDialogOpen(true) : undefined}
      onRemove={isEditable ? handleRemove : undefined}
      canRemove={canRemove}
      disabled={!isEditable}
    />
  );

  // Render appropriate card based on media type
  return (
    <>
      {mediaType === 'video' && (
        <VideoCard url={fileUrl} title={label} footer={footer} />
      )}
      {mediaType === 'audio' && (
        <AudioCard url={fileUrl} title={label} footer={footer} />
      )}
      {mediaType === 'image' && (
        <ImageCard url={fileUrl} title={label} footer={footer} />
      )}

      <FileUploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mediaType={mediaType}
        multiple={false}
        onConfirm={handleUpload}
      />
    </>
  );
}

// ============================================================================
// Add Media Placeholder
// ============================================================================

interface AddMediaPlaceholderProps {
  mediaType: MediaType;
  onAdd: () => void;
  disabled?: boolean;
}

function AddMediaPlaceholder({
  mediaType,
  onAdd,
  disabled = false,
}: AddMediaPlaceholderProps) {
  return (
    <EmptyMediaPlaceholder
      mediaType={mediaType}
      onClick={onAdd}
      disabled={disabled}
    />
  );
}

// ============================================================================
// Text Array Input Section (itemType=text)
// ============================================================================

function toEditableStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) =>
    typeof item === 'string' ? item : String(item ?? '')
  );
}

interface TextArrayInputSectionProps {
  input: BlueprintInputDef;
  value: unknown;
  onChange: (value: unknown) => void;
  isEditable: boolean;
  isSelected: boolean;
}

function TextArrayInputSection({
  input,
  value,
  onChange,
  isEditable,
  isSelected,
}: TextArrayInputSectionProps) {
  const items = useMemo(() => toEditableStringArray(value), [value]);

  const handleItemChange = useCallback(
    (index: number, nextValue: string) => {
      const current = toEditableStringArray(value);
      current[index] = nextValue;
      onChange(current);
    },
    [value, onChange]
  );

  const handleRemoveItem = useCallback(
    (index: number) => {
      const current = toEditableStringArray(value);
      current.splice(index, 1);
      onChange(current);
    },
    [value, onChange]
  );

  const handleAddItem = useCallback(
    (nextValue: string) => {
      const current = toEditableStringArray(value);
      onChange([...current, nextValue]);
    },
    [value, onChange]
  );

  return (
    <CollapsibleSection
      title={input.name}
      count={items.length}
      description={input.description}
      defaultOpen
      className={getSectionHighlightStyles(isSelected, 'primary')}
    >
      <MediaGrid>
        {items.map((itemValue, index) => (
          <TextArrayItemCard
            key={`${input.name}-${index}`}
            label={`${input.name}[${index}]`}
            value={itemValue}
            description={input.description}
            isEditable={isEditable}
            onChange={(nextValue) => handleItemChange(index, nextValue)}
            onRemove={() => handleRemoveItem(index)}
          />
        ))}

        {isEditable && (
          <TextCard
            label='text'
            value=''
            onChange={handleAddItem}
            isEditable={true}
            sizing='aspect'
          />
        )}
      </MediaGrid>
    </CollapsibleSection>
  );
}

interface TextArrayItemCardProps {
  label: string;
  value: string;
  description?: string;
  isEditable: boolean;
  onChange: (value: string) => void;
  onRemove: () => void;
}

function TextArrayItemCard({
  label,
  value,
  description,
  isEditable,
  onChange,
  onRemove,
}: TextArrayItemCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const preview = useMemo(() => {
    const max = 5000;
    if (value.length <= max) {
      return value;
    }
    return `${value.slice(0, max)}...`;
  }, [value]);

  const handleSave = useCallback(
    (nextValue: string) => {
      onChange(nextValue);
      setDialogOpen(false);
    },
    [onChange]
  );

  const footer = (
    <InputCardFooter
      label={label}
      description={description}
      onEdit={isEditable ? () => setDialogOpen(true) : undefined}
      onRemove={isEditable ? onRemove : undefined}
      canRemove={true}
      disabled={!isEditable}
    />
  );

  return (
    <>
      <MediaCard footer={footer}>
        <button
          type='button'
          onClick={() => setDialogOpen(true)}
          className='w-full aspect-video bg-muted/30 p-4 text-left overflow-hidden group relative'
        >
          {value.length > 0 ? (
            <pre className='text-xs text-muted-foreground font-mono whitespace-pre-wrap overflow-hidden h-full max-h-full'>
              {preview}
            </pre>
          ) : (
            <div className='h-full flex flex-col items-center justify-center gap-2 text-muted-foreground'>
              <FileText className='size-6' />
              <span className='text-xs'>No content</span>
            </div>
          )}
          <div className='absolute inset-0 bg-linear-to-t from-card to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'>
            <Maximize2 className='size-8 text-foreground' />
          </div>
        </button>
      </MediaCard>

      <TextEditorDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={isEditable ? `Edit ${label}` : label}
        content={value}
        language='markdown'
        onSave={isEditable ? handleSave : undefined}
      />
    </>
  );
}

// ============================================================================
// String Array Input Section (itemType=string)
// ============================================================================

interface StringArrayInputSectionProps {
  input: BlueprintInputDef;
  value: unknown;
  onChange: (value: unknown) => void;
  isEditable: boolean;
  isSelected: boolean;
}

function StringArrayInputSection({
  input,
  value,
  onChange,
  isEditable,
  isSelected,
}: StringArrayInputSectionProps) {
  const items = useMemo(() => toEditableStringArray(value), [value]);

  const handleItemChange = useCallback(
    (index: number, nextValue: string) => {
      const current = toEditableStringArray(value);
      current[index] = nextValue;
      onChange(current);
    },
    [value, onChange]
  );

  const handleRemoveItem = useCallback(
    (index: number) => {
      const current = toEditableStringArray(value);
      current.splice(index, 1);
      onChange(current);
    },
    [value, onChange]
  );

  const handleAddItem = useCallback(() => {
    const current = toEditableStringArray(value);
    onChange([...current, '']);
  }, [value, onChange]);

  return (
    <CollapsibleSection
      title={input.name}
      count={items.length}
      description={input.description}
      defaultOpen
      className={getSectionHighlightStyles(isSelected, 'primary')}
    >
      <div className='space-y-2'>
        {!isEditable && items.length === 0 && (
          <div className='text-xs text-muted-foreground italic'>No values</div>
        )}

        {items.map((itemValue, index) => (
          <div
            key={`${input.name}-${index}`}
            className='flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 p-2'
          >
            <span className='text-[11px] font-mono text-muted-foreground min-w-[120px]'>
              {`${input.name}[${index}]`}
            </span>

            {isEditable ? (
              <Input
                value={itemValue}
                onChange={(event) =>
                  handleItemChange(index, event.target.value)
                }
                placeholder={`Enter ${input.name}[${index}]...`}
                className='h-8 text-xs font-mono bg-background border-border/50'
              />
            ) : (
              <div className='flex-1 text-xs font-mono text-foreground truncate'>
                {itemValue.length > 0 ? itemValue : 'not provided'}
              </div>
            )}

            {isEditable && (
              <button
                type='button'
                onClick={() => handleRemoveItem(index)}
                className='size-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors'
                aria-label={`Remove ${input.name}[${index}]`}
                title='Remove item'
              >
                <Trash2 className='size-4' />
              </button>
            )}
          </div>
        ))}

        {isEditable && (
          <button
            type='button'
            onClick={handleAddItem}
            className='w-full h-9 border border-dashed border-border rounded-md text-xs text-muted-foreground hover:text-foreground hover:border-primary hover:bg-primary/5 transition-colors inline-flex items-center justify-center gap-2'
          >
            <Plus className='size-4' />
            <span>Add item</span>
          </button>
        )}
      </div>
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
    <PropertyRow
      name={input.name}
      type={input.type}
      description={input.description}
      required={input.required}
      isSelected={isSelected}
    >
      <DefaultTextEditor {...editorProps} />
    </PropertyRow>
  );
}
