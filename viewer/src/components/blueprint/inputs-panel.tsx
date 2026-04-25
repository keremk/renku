import { useState, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Maximize2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type {
  BlueprintInputDef,
  BlueprintLoopGroup,
} from '@/types/blueprint-graph';
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
import { ResolutionEditor } from './inputs/resolution-editor';
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
  loopGroups?: BlueprintLoopGroup[];
  managedCountInputs?: string[];
  inputValues?: InputValue[] | null;
  isInputValuesLoading?: boolean;
  selectedNodeId: string | null;
  /** Whether inputs are editable (requires buildId) */
  isEditable?: boolean;
  /** Callback when inputs are saved (auto-save enabled when provided) */
  onSave?: (values: Record<string, unknown>) => Promise<void>;
  /** Callback after auto-save succeeds. */
  onSaved?: () => void;
  /** Blueprint folder path for file uploads */
  blueprintFolder?: string | null;
  /** Movie ID for the current build */
  movieId?: string | null;
}

const EMPTY_LOOP_GROUPS: BlueprintLoopGroup[] = [];
const EMPTY_MANAGED_COUNT_INPUTS: string[] = [];

export function InputsPanel({
  inputs,
  loopGroups = EMPTY_LOOP_GROUPS,
  managedCountInputs = EMPTY_MANAGED_COUNT_INPUTS,
  inputValues = null,
  isInputValuesLoading = false,
  selectedNodeId,
  isEditable = false,
  onSave,
  onSaved,
  blueprintFolder = null,
  movieId = null,
}: InputsPanelProps) {
  // Create a map of input values by name
  const initialValueMap = useMemo(() => {
    const map: Record<string, unknown> = {};
    for (const iv of inputValues ?? []) {
      map[iv.name] = iv.value;
    }
    return map;
  }, [inputValues]);

  const initialValueKey = useMemo(
    () => JSON.stringify(initialValueMap),
    [initialValueMap]
  );
  const [internalValues, setInternalValues] =
    useState<Record<string, unknown>>(initialValueMap);
  const [hasUserChanges, setHasUserChanges] = useState(false);
  const internalValueKey = useMemo(
    () => JSON.stringify(internalValues),
    [internalValues]
  );
  const isInputsPanelLoading =
    isInputValuesLoading ||
    (!hasUserChanges && initialValueKey !== internalValueKey);

  const saveScopeKey = useMemo(() => {
    return `${blueprintFolder ?? 'no-folder'}:${movieId ?? 'no-movie'}`;
  }, [blueprintFolder, movieId]);

  // A build/movie switch is the only hard reset. Same-build save acknowledgements
  // should not rebuild editors while the user is still typing.
  useLayoutEffect(() => {
    setInternalValues(initialValueMap);
    setHasUserChanges(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveScopeKey]);

  useLayoutEffect(() => {
    if (!hasUserChanges) {
      setInternalValues(initialValueMap);
    }
  }, [hasUserChanges, initialValueMap]);

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
  useAutoSave({
    data: internalValues,
    onSave: handleSave,
    debounceMs: 1000,
    enabled: isEditable && !!onSave && hasUserChanges,
    initialData: initialValueMap,
    resetKey: saveScopeKey,
    saveOnUnmount: false,
    reportSavingState: false,
    onSaveSuccess: onSaved,
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
    setHasUserChanges(true);
    setInternalValues((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  const visibleInputs = useMemo(
    () => filterPanelVisibleInputs(inputs),
    [inputs]
  );

  const inputByName = useMemo(
    () => new Map(visibleInputs.map((input) => [input.name, input])),
    [visibleInputs]
  );

  const managedCountInputSet = useMemo(
    () => new Set(managedCountInputs),
    [managedCountInputs]
  );

  const renderableLoopGroups = useMemo(() => {
    if (isInputsPanelLoading) {
      return [];
    }

    return loopGroups
      .map((group) => {
        const members = group.members.map((member) => {
          const input = inputByName.get(member.inputName);
          if (!input) {
            throw new Error(
              `Loop group "${group.groupId}" references missing input "${member.inputName}".`
            );
          }
          return input;
        });

        return {
          group,
          members,
        };
      })
      .filter((entry) => entry.members.length > 0);
  }, [isInputsPanelLoading, loopGroups, inputByName]);

  const loopGroupModels = useMemo(
    () =>
      renderableLoopGroups.map((entry) =>
        buildLoopGroupRenderModel(entry.group, entry.members, internalValues)
      ),
    [renderableLoopGroups, internalValues]
  );

  const [groupWarnings, setGroupWarnings] = useState<
    Record<string, LoopGroupWarning>
  >({});
  const [dismissedWarnings, setDismissedWarnings] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    setGroupWarnings((previousWarnings) =>
      Object.keys(previousWarnings).length === 0 ? previousWarnings : {}
    );
    setDismissedWarnings((previousDismissed) =>
      Object.keys(previousDismissed).length === 0 ? previousDismissed : {}
    );
  }, [saveScopeKey, loopGroups, initialValueKey]);

  useEffect(() => {
    if (isInputsPanelLoading) {
      return;
    }

    const mismatchedGroups = loopGroupModels.filter(
      (model) => model.hasMismatch
    );

    if (mismatchedGroups.length > 0) {
      setGroupWarnings((previousWarnings): Record<string, LoopGroupWarning> => {
        const nextWarnings: Record<string, LoopGroupWarning> = {
          ...previousWarnings,
        };
        let hasChanges = false;

        for (const model of mismatchedGroups) {
          if (dismissedWarnings[model.group.groupId]) {
            continue;
          }
          const nextWarning = buildLoopGroupMismatchWarning(model);
          const previousWarning = previousWarnings[model.group.groupId];
          if (
            !previousWarning ||
            previousWarning.message !== nextWarning.message ||
            previousWarning.details !== nextWarning.details
          ) {
            nextWarnings[model.group.groupId] = nextWarning;
            hasChanges = true;
          }
        }

        return hasChanges ? nextWarnings : previousWarnings;
      });
    }

    if (mismatchedGroups.length === 0) {
      return;
    }

    setHasUserChanges(true);
    setInternalValues((previousValues) =>
      normalizeLoopGroupValues(previousValues, mismatchedGroups)
    );
  }, [isInputsPanelLoading, loopGroupModels, dismissedWarnings]);

  const [groupIndices, setGroupIndices] = useState<Record<string, number>>({});

  useEffect(() => {
    if (isInputsPanelLoading) {
      return;
    }
    setGroupIndices((previousIndices) => {
      const nextIndices: Record<string, number> = {};
      let hasChanges = false;
      for (const model of loopGroupModels) {
        const existing = previousIndices[model.group.groupId];
        if (existing === undefined) {
          const defaultIndex = Math.max(0, model.length - 1);
          nextIndices[model.group.groupId] = defaultIndex;
          hasChanges = true;
          continue;
        }
        const clamped = clamp(existing, 0, model.length - 1);
        nextIndices[model.group.groupId] = clamped;
        if (clamped !== existing) {
          hasChanges = true;
        }
      }

      const previousKeys = Object.keys(previousIndices);
      if (!hasChanges && previousKeys.length !== Object.keys(nextIndices).length) {
        hasChanges = true;
      }

      return hasChanges ? nextIndices : previousIndices;
    });
  }, [isInputsPanelLoading, loopGroupModels]);

  const groupedInputNames = useMemo(() => {
    const names = new Set<string>();
    for (const model of loopGroupModels) {
      for (const input of model.members) {
        names.add(input.name);
      }
    }
    return names;
  }, [loopGroupModels]);

  const ungroupedVisibleInputs = useMemo(
    () => visibleInputs.filter((input) => !groupedInputNames.has(input.name)),
    [visibleInputs, groupedInputNames]
  );

  // Categorize ungrouped inputs only; grouped members are rendered separately.
  const categorized = useMemo(
    () => categorizeInputs(ungroupedVisibleInputs),
    [ungroupedVisibleInputs]
  );

  // Determine which input is selected based on node ID
  const selectedInputName = getInputNameFromNodeId(selectedNodeId);

  const handleGroupedItemChange = useCallback(
    (inputName: string, index: number, value: unknown) => {
      setHasUserChanges(true);
      setInternalValues((previousValues) => {
        const current = getGroupedInputArray(previousValues[inputName], inputName);
        const next = [...current];
        while (next.length <= index) {
          next.push(undefined);
        }
        next[index] = value;
        return {
          ...previousValues,
          [inputName]: next,
        };
      });
    },
    []
  );

  const handleGroupAdd = useCallback(
    (model: LoopGroupRenderModel, currentIndex: number) => {
      if (!isEditable || currentIndex !== model.length - 1) {
        return;
      }

      const nextLength = model.length + 1;
      const nextCount = nextLength - model.group.countInputOffset;
      if (nextCount < 0) {
        throw new Error(
          `Loop group "${model.group.groupId}" produced an invalid next count ${nextCount}.`
        );
      }

      setHasUserChanges(true);
      setInternalValues((previousValues) => {
        const nextValues = { ...previousValues };
        for (const member of model.members) {
          const current = getGroupedInputArray(nextValues[member.name], member.name);
          nextValues[member.name] = [...current, undefined];
        }
        nextValues[model.group.countInput] = nextCount;
        return nextValues;
      });
      setGroupIndices((previousIndices) => ({
        ...previousIndices,
        [model.group.groupId]: nextLength - 1,
      }));
    },
    [isEditable]
  );

  const handleGroupRemove = useCallback(
    (model: LoopGroupRenderModel, currentIndex: number) => {
      if (
        !isEditable ||
        currentIndex !== model.length - 1 ||
        model.length <= 1
      ) {
        return;
      }

      const nextLength = model.length - 1;
      const nextCount = nextLength - model.group.countInputOffset;
      if (nextCount < 0) {
        throw new Error(
          `Loop group "${model.group.groupId}" produced an invalid next count ${nextCount}.`
        );
      }

      setHasUserChanges(true);
      setInternalValues((previousValues) => {
        const nextValues = { ...previousValues };
        for (const member of model.members) {
          const current = getGroupedInputArray(nextValues[member.name], member.name);
          nextValues[member.name] = current.slice(0, nextLength);
        }
        nextValues[model.group.countInput] = nextCount;
        return nextValues;
      });
      setGroupIndices((previousIndices) => ({
        ...previousIndices,
        [model.group.groupId]: nextLength - 1,
      }));
    },
    [isEditable]
  );

  const handleGroupWarningDismiss = useCallback((groupId: string) => {
    setDismissedWarnings((previous) => ({
      ...previous,
      [groupId]: true,
    }));
    setGroupWarnings((previous) => {
      const next = { ...previous };
      delete next[groupId];
      return next;
    });
  }, []);

  const visibleOtherInputs = useMemo(
    () =>
      categorized.other.filter((input) => !managedCountInputSet.has(input.name)),
    [categorized.other, managedCountInputSet]
  );

  if (isInputsPanelLoading) {
    return <InputsPanelLoadingState />;
  }

  if (visibleInputs.length === 0) {
    return (
      <div className='text-muted-foreground text-sm'>
        No editable inputs defined in this blueprint.
      </div>
    );
  }

  return (
    <div className='space-y-8'>
      {/* Loop-grouped indexed inputs */}
      {loopGroupModels.length > 0 && (
        <div className='space-y-6'>
          {loopGroupModels.map((model) => {
            const currentIndex = clamp(
              groupIndices[model.group.groupId] ?? model.length - 1,
              0,
              model.length - 1
            );
            const canMutateAtCurrentIndex =
              isEditable && currentIndex === model.length - 1;
            const isSelected = model.members.some(
              (input) => input.name === selectedInputName
            );

            return (
              <LoopGroupedInputSection
                key={model.group.groupId}
                model={model}
                currentIndex={currentIndex}
                isEditable={isEditable}
                canMutateAtCurrentIndex={canMutateAtCurrentIndex}
                warning={groupWarnings[model.group.groupId]}
                onDismissWarning={() =>
                  handleGroupWarningDismiss(model.group.groupId)
                }
                onNavigatePrevious={() =>
                  setGroupIndices((previousIndices) => ({
                    ...previousIndices,
                    [model.group.groupId]: clamp(
                      currentIndex - 1,
                      0,
                      model.length - 1
                    ),
                  }))
                }
                onNavigateNext={() =>
                  setGroupIndices((previousIndices) => ({
                    ...previousIndices,
                    [model.group.groupId]: clamp(
                      currentIndex + 1,
                      0,
                      model.length - 1
                    ),
                  }))
                }
                onAdd={() => handleGroupAdd(model, currentIndex)}
                onRemoveLast={() => handleGroupRemove(model, currentIndex)}
                onMemberValueChange={handleGroupedItemChange}
                isSelected={isSelected}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
                currentValues={internalValues}
              />
            );
          })}
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
                dialogPreset='input-edit'
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
      {visibleOtherInputs.length > 0 && (
        <CollapsibleSection
          title='Other Inputs'
          count={visibleOtherInputs.length}
          defaultOpen
        >
          <div className='space-y-4'>
            {visibleOtherInputs.map((input) => {
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

interface LoopGroupRenderModel {
  group: BlueprintLoopGroup;
  members: BlueprintInputDef[];
  memberLengths: Record<string, number>;
  length: number;
  currentCount: number;
  expectedCount: number;
  hasMismatch: boolean;
}

interface LoopGroupWarning {
  message: string;
  details: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getGroupedInputArray(value: unknown, inputName: string): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  throw new Error(
    `Loop-grouped input "${inputName}" must be an array value. Received ${typeof value}.`
  );
}

function buildLoopGroupRenderModel(
  group: BlueprintLoopGroup,
  members: BlueprintInputDef[],
  values: Record<string, unknown>
): LoopGroupRenderModel {
  const memberLengths: Record<string, number> = {};
  let maxMemberLength = 0;

  for (const member of members) {
    const memberLength = getGroupedInputArray(values[member.name], member.name)
      .length;
    memberLengths[member.name] = memberLength;
    if (memberLength > maxMemberLength) {
      maxMemberLength = memberLength;
    }
  }

  const currentCountValue = values[group.countInput];
  if (typeof currentCountValue !== 'number' && currentCountValue !== undefined) {
    throw new Error(
      `Managed loop counter "${group.countInput}" must be a number.`
    );
  }
  const currentCount =
    typeof currentCountValue === 'number' ? currentCountValue : 0;
  const countDrivenLength = currentCount + group.countInputOffset;

  const length = Math.max(1, maxMemberLength, countDrivenLength);
  const expectedCount = length - group.countInputOffset;
  if (expectedCount < 0) {
    throw new Error(
      `Managed loop counter "${group.countInput}" resolved to negative count ${expectedCount}.`
    );
  }

  const hasLengthMismatch = members.some(
    (member) => memberLengths[member.name] !== length
  );
  const hasCountMismatch = currentCount !== expectedCount;

  return {
    group,
    members,
    memberLengths,
    length,
    currentCount,
    expectedCount,
    hasMismatch: hasLengthMismatch || hasCountMismatch,
  };
}

function normalizeLoopGroupValues(
  values: Record<string, unknown>,
  models: LoopGroupRenderModel[]
): Record<string, unknown> {
  let hasChanges = false;
  const nextValues: Record<string, unknown> = { ...values };

  for (const model of models) {
    for (const member of model.members) {
      const current = getGroupedInputArray(nextValues[member.name], member.name);
      if (current.length === model.length) {
        continue;
      }
      hasChanges = true;
      if (current.length > model.length) {
        nextValues[member.name] = current.slice(0, model.length);
        continue;
      }
      nextValues[member.name] = [
        ...current,
        ...Array(model.length - current.length).fill(undefined),
      ];
    }

    if (nextValues[model.group.countInput] !== model.expectedCount) {
      hasChanges = true;
      nextValues[model.group.countInput] = model.expectedCount;
    }
  }

  return hasChanges ? nextValues : values;
}

function buildLoopGroupMismatchWarning(model: LoopGroupRenderModel): LoopGroupWarning {
  const lengthsSummary = model.members
    .map((member) => `${member.name}: ${model.memberLengths[member.name] ?? 0}`)
    .join(', ');

  const itemLabel = model.length === 1 ? 'item' : 'items';
  const countChangeText =
    model.currentCount === model.expectedCount
      ? `${model.group.countInput} stayed at ${model.expectedCount}`
      : `${model.group.countInput} changed from ${model.currentCount} to ${model.expectedCount}`;

  return {
    message: `We synchronized grouped inputs to ${model.length} ${itemLabel} so each index lines up across this section (${countChangeText}).`,
    details: `Group ${model.group.groupId}: normalized to length ${model.length}; member lengths { ${lengthsSummary} }; ${model.group.countInput}: ${model.currentCount} -> ${model.expectedCount}.`,
  };
}

function InputsPanelLoadingState() {
  return (
    <div className='space-y-4'>
      <div className='text-muted-foreground text-sm'>Loading inputs...</div>
      <div className='rounded-xl border border-border bg-card px-4 py-3 animate-pulse'>
        <div className='h-4 w-2/3 rounded bg-muted/50' />
      </div>
      <div className='rounded-xl border border-border bg-card px-4 py-3 animate-pulse'>
        <div className='h-4 w-1/2 rounded bg-muted/50' />
      </div>
    </div>
  );
}

function getLoopGroupTitle(members: BlueprintInputDef[]): string {
  const hasMedia = members.some(
    (input) => getMediaTypeFromInput(input.type, input.itemType) !== null
  );
  const hasTextArray = members.some(
    (input) => input.type === 'array' && input.itemType === 'text'
  );

  if (hasTextArray && !hasMedia) {
    return 'Text Inputs';
  }
  if (hasMedia && !hasTextArray) {
    return 'Media Inputs';
  }
  if (hasMedia && hasTextArray) {
    return 'Text & Media Inputs';
  }
  return 'Loop Inputs';
}

interface LoopGroupedInputSectionProps {
  model: LoopGroupRenderModel;
  currentIndex: number;
  isEditable: boolean;
  canMutateAtCurrentIndex: boolean;
  warning?: LoopGroupWarning;
  onDismissWarning: () => void;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
  onAdd: () => void;
  onRemoveLast: () => void;
  onMemberValueChange: (inputName: string, index: number, value: unknown) => void;
  isSelected: boolean;
  blueprintFolder: string | null;
  movieId: string | null;
  currentValues: Record<string, unknown>;
}

function LoopGroupedInputSection({
  model,
  currentIndex,
  isEditable,
  canMutateAtCurrentIndex,
  warning,
  onDismissWarning,
  onNavigatePrevious,
  onNavigateNext,
  onAdd,
  onRemoveLast,
  onMemberValueChange,
  isSelected,
  blueprintFolder,
  movieId,
  currentValues,
}: LoopGroupedInputSectionProps) {
  const title = getLoopGroupTitle(model.members);
  const canNavigatePrevious = currentIndex > 0;
  const canNavigateNext = currentIndex < model.length - 1;

  return (
    <CollapsibleSection
      title={title}
      count={model.members.length}
      defaultOpen
      className={getSectionHighlightStyles(isSelected, 'primary')}
      actions={
        <span className='text-2xl font-semibold tracking-tight text-muted-foreground'>
          {currentIndex + 1}
        </span>
      }
    >
      <div className='space-y-4'>
        {warning && (
          <div className='flex items-start gap-2 rounded-md border border-amber-500/45 bg-amber-500/14 px-3 py-2 text-xs text-amber-700 dark:text-amber-300'>
            <AlertTriangle className='mt-0.5 size-4 shrink-0' />
            <div className='flex-1 leading-relaxed'>
              <p>{warning.message}</p>
              <details className='mt-1 text-[11px]'>
                <summary className='cursor-pointer text-amber-700/90 hover:text-amber-800 dark:text-amber-300/90 dark:hover:text-amber-200'>
                  Details
                </summary>
                <p className='mt-1 wrap-break-word font-mono text-amber-700/90 dark:text-amber-300/90'>
                  {warning.details}
                </p>
              </details>
            </div>
            <button
              type='button'
              onClick={onDismissWarning}
              className='inline-flex size-5 items-center justify-center rounded text-amber-700/80 transition-colors hover:bg-amber-500/20 hover:text-amber-800 dark:text-amber-300/80 dark:hover:text-amber-200'
              aria-label='Dismiss loop normalization warning'
            >
              <X className='size-3.5' />
            </button>
          </div>
        )}

        <MediaGrid>
          {model.members.map((input) => {
            const mediaType = getMediaTypeFromInput(input.type, input.itemType);
            const memberArray = getGroupedInputArray(
              currentValues[input.name],
              input.name
            );
            const indexedValue = memberArray[currentIndex];

            if (mediaType) {
              return (
                <MediaInputItemCard
                  key={`${model.group.groupId}-${input.name}`}
                  input={input}
                  value={memberArray}
                  onChange={(nextValue) => {
                    if (!Array.isArray(nextValue)) {
                      throw new Error(
                        `Grouped media input "${input.name}" must resolve to an array value.`
                      );
                    }
                    onMemberValueChange(
                      input.name,
                      currentIndex,
                      nextValue[currentIndex]
                    );
                  }}
                  isEditable={isEditable}
                  blueprintFolder={blueprintFolder}
                  movieId={movieId}
                  mediaType={mediaType}
                  arrayIndex={currentIndex}
                  allowRemove={false}
                  showArrayIndexInLabel={false}
                />
              );
            }

            if (input.type === 'array' && input.itemType === 'text') {
              return (
                <TextCard
                  key={`${model.group.groupId}-${input.name}`}
                  label={input.name}
                  description={input.description}
                  value={String(indexedValue ?? '')}
                  onChange={(nextValue) =>
                    onMemberValueChange(input.name, currentIndex, nextValue)
                  }
                  isEditable={isEditable}
                  sizing='aspect'
                  dialogPreset='input-edit'
                />
              );
            }

            const scalarInput: BlueprintInputDef = {
              ...input,
              type: input.itemType ?? 'string',
              itemType: undefined,
            };

            return (
              <GroupedIndexedOtherInputCard
                key={`${model.group.groupId}-${input.name}`}
                input={scalarInput}
                value={indexedValue}
                isEditable={isEditable}
                onChange={(nextValue) =>
                  onMemberValueChange(input.name, currentIndex, nextValue)
                }
              />
            );
          })}
        </MediaGrid>

        <div className='flex items-center justify-end gap-2'>
          <button
            type='button'
            onClick={onRemoveLast}
            disabled={!canMutateAtCurrentIndex || model.length <= 1}
            className='size-8 inline-flex items-center justify-center rounded-md border border-border/50 bg-background/70 text-muted-foreground shadow-sm transition-colors hover:bg-item-hover-bg hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40'
            aria-label='Remove last loop index'
            title='Remove last index'
          >
            <Trash2 className='size-4' />
          </button>

          <button
            type='button'
            onClick={onNavigatePrevious}
            disabled={!canNavigatePrevious}
            className='size-8 inline-flex items-center justify-center rounded-md border border-border/50 bg-background/70 text-muted-foreground shadow-sm transition-colors hover:bg-item-hover-bg hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
            aria-label='Previous loop index'
            title='Previous index'
          >
            <ChevronLeft className='size-4' />
          </button>

          <button
            type='button'
            onClick={onNavigateNext}
            disabled={!canNavigateNext}
            className='size-8 inline-flex items-center justify-center rounded-md border border-border/50 bg-background/70 text-muted-foreground shadow-sm transition-colors hover:bg-item-hover-bg hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40'
            aria-label='Next loop index'
            title='Next index'
          >
            <ChevronRight className='size-4' />
          </button>

          <button
            type='button'
            onClick={onAdd}
            disabled={!canMutateAtCurrentIndex}
            className='size-8 inline-flex items-center justify-center rounded-md border border-border/50 bg-background/70 text-muted-foreground shadow-sm transition-colors hover:bg-item-hover-bg hover:text-primary disabled:cursor-not-allowed disabled:opacity-40'
            aria-label='Add loop index'
            title='Add index'
          >
            <Plus className='size-4' />
          </button>
        </div>
      </div>
    </CollapsibleSection>
  );
}

interface GroupedIndexedOtherInputCardProps {
  input: BlueprintInputDef;
  value: unknown;
  isEditable: boolean;
  onChange: (value: unknown) => void;
}

function GroupedIndexedOtherInputCard({
  input,
  value,
  isEditable,
  onChange,
}: GroupedIndexedOtherInputCardProps) {
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
      isSelected={false}
    >
      {input.type === 'resolution' ? (
        <ResolutionEditor {...editorProps} />
      ) : (
        <DefaultTextEditor {...editorProps} />
      )}
    </PropertyRow>
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
  allowRemove?: boolean;
  showArrayIndexInLabel?: boolean;
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
  allowRemove = true,
  showArrayIndexInLabel = true,
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
  const canRemove = isArray && arrayIndex !== undefined && allowRemove;
  const isDisabled = !blueprintFolder || !movieId;
  const label =
    arrayIndex !== undefined && showArrayIndexInLabel
      ? `${input.name}[${arrayIndex}]`
      : input.name;

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
            dialogPreset='input-edit'
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
        preset='input-edit'
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
      {input.type === 'resolution' ? (
        <ResolutionEditor {...editorProps} />
      ) : (
        <DefaultTextEditor {...editorProps} />
      )}
    </PropertyRow>
  );
}
