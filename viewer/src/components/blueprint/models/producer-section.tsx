import { useCallback, useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  CollapsibleSection,
  MediaGrid,
  TextCard,
  PropertyRow,
} from '../shared';
import { ModelSelector } from './model-selector';
import { ConfigPropertiesEditor } from './config-properties-editor';
import { getSectionHighlightStyles } from '@/lib/panel-utils';
import type {
  AvailableModelOption,
  ModelSelectionValue,
  ProducerCategory,
  PromptData,
  ConfigFieldDescriptor,
  NestedModelConfigSchema,
  ProducerContractError,
  ProducerFieldPreviewField,
} from '@/types/blueprint-graph';

interface ProducerSectionProps {
  /** Producer identifier */
  producerId: string;
  /** Producer type (e.g., "asset/text-to-image") */
  producerType?: string;
  /** Producer description */
  description?: string;
  /** Category determines display mode */
  category: ProducerCategory;
  /** Available models for selection */
  availableModels: AvailableModelOption[];
  /** Current model selection */
  currentSelection?: ModelSelectionValue;
  /** Whether the section is selected/highlighted */
  isSelected: boolean;
  /** Whether editing is enabled */
  isEditable: boolean;
  /** Callback when model selection changes */
  onModelChange: (selection: ModelSelectionValue) => void;
  /** Prompt data for prompt producers */
  promptData?: PromptData;
  /** Callback when prompts change */
  onPromptChange?: (prompts: PromptData) => void;
  /** Config field descriptors for asset producers */
  configFields?: ConfigFieldDescriptor[];
  /** Current config values */
  configValues?: Record<string, unknown>;
  /** Callback when config changes */
  onConfigChange?: (key: string, value: unknown) => void;
  /** Error message if config schema failed to load */
  schemaError?: string | null;
  /** Producer-level contract/runtime error */
  producerError?: ProducerContractError | null;
  /** Nested model schemas (if this producer has nested model declarations) */
  nestedModelSchemas?: NestedModelConfigSchema[];
  /** Producer field preview rows for mapped resolution/aspect/size fields */
  fieldPreview?: ProducerFieldPreviewField[];
  /** Whether section starts open */
  defaultOpen?: boolean;
  /** Render content without collapsible wrapper */
  hideSectionContainer?: boolean;
  /** Blueprint folder for file uploads */
  blueprintFolder?: string | null;
  /** Build movie ID for file uploads */
  movieId?: string | null;
}

/**
 * Section for a producer showing model selection and expandable content.
 * Uses CollapsibleSection for consistent styling with InputsPanel.
 * - For prompt producers: shows model row then prompt cards using TextCard with hover overlay
 * - For asset producers: shows model row then config properties editor
 * - For composition producers: just shows the header (no expandable content)
 */
export function ProducerSection({
  producerId,
  producerType: _producerType,
  description,
  category,
  availableModels,
  currentSelection,
  isSelected,
  isEditable,
  onModelChange,
  promptData,
  onPromptChange,
  configFields,
  configValues = {},
  onConfigChange,
  schemaError,
  producerError,
  nestedModelSchemas,
  fieldPreview,
  defaultOpen = false,
  hideSectionContainer = false,
  blueprintFolder = null,
  movieId = null,
}: ProducerSectionProps) {
  // Handle saving system prompt
  const handleSaveSystemPrompt = useCallback(
    async (content: string) => {
      if (!promptData || !onPromptChange) return;
      const updatedPrompts: PromptData = {
        ...promptData,
        source: 'build',
        systemPrompt: content,
      };
      await Promise.resolve(onPromptChange(updatedPrompts));
    },
    [promptData, onPromptChange]
  );

  // Handle saving user prompt
  const handleSaveUserPrompt = useCallback(
    async (content: string) => {
      if (!promptData || !onPromptChange) return;
      const updatedPrompts: PromptData = {
        ...promptData,
        source: 'build',
        userPrompt: content,
      };
      await Promise.resolve(onPromptChange(updatedPrompts));
    },
    [promptData, onPromptChange]
  );

  // Handle nested model selection change
  const handleNestedModelChange = useCallback(
    (
      nestedSchema: NestedModelConfigSchema,
      provider: string,
      model: string
    ) => {
      if (!currentSelection) return;

      const { configPath, providerField, modelField } =
        nestedSchema.declaration;

      // Update the nested model config while preserving other properties
      const existingNestedConfig = (currentSelection.config?.[configPath] ??
        {}) as Record<string, unknown>;
      const updatedConfig = {
        ...currentSelection.config,
        [configPath]: {
          ...existingNestedConfig,
          [providerField]: provider,
          [modelField]: model,
        },
      };

      onModelChange({
        ...currentSelection,
        config: updatedConfig,
      });
    },
    [currentSelection, onModelChange]
  );

  // Build section title
  const sectionTitle = producerId;

  const compositionConfigFields = useMemo(() => {
    if (category !== 'composition' || !configFields) {
      return [];
    }
    return configFields;
  }, [category, configFields]);

  // Count items based on category
  const itemCount = useMemo(() => {
    if (category === 'prompt' && promptData) {
      let count = 0;
      if (promptData.systemPrompt !== undefined) count++;
      if (promptData.userPrompt !== undefined) count++;
      return count;
    }
    if (category === 'composition') {
      return compositionConfigFields.length || undefined;
    }
    if (category === 'asset' && configFields) {
      return configFields.length;
    }
    return undefined;
  }, [category, promptData, configFields, compositionConfigFields]);

  // For composition producers with displayable config, show collapsible section
  // For composition producers without displayable config, show simple non-collapsible section
  if (category === 'composition') {
    // If there are displayable config properties, render with ConfigPropertiesEditor
    if (compositionConfigFields.length > 0) {
      const compositionContent = (
        <ConfigPropertiesEditor
          fields={compositionConfigFields}
          values={configValues}
          isEditable={isEditable}
          onChange={(key, value) => onConfigChange?.(key, value)}
          blueprintFolder={blueprintFolder}
          movieId={movieId}
        />
      );

      if (hideSectionContainer) {
        return compositionContent;
      }

      return (
        <CollapsibleSection
          title={sectionTitle}
          count={compositionConfigFields.length}
          description={description}
          defaultOpen={defaultOpen}
          className={getSectionHighlightStyles(isSelected, 'primary')}
        >
          {compositionContent}
        </CollapsibleSection>
      );
    }

    // No displayable config properties - render simple view
    if (hideSectionContainer) {
      if (description) {
        return <p className='text-xs text-muted-foreground'>{description}</p>;
      }
      return (
        <p className='text-xs text-muted-foreground'>
          No configurable properties for this producer.
        </p>
      );
    }

    return (
      <div
        className={`rounded-lg px-2 py-1.5 ${getSectionHighlightStyles(isSelected, 'primary')}`}
      >
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium text-foreground'>
            {producerId}
          </span>
        </div>
        {description && (
          <p className='text-xs text-muted-foreground mt-0.5 ml-0'>
            {description}
          </p>
        )}
      </div>
    );
  }

  const sectionContent = (
    <>
      {/* Prompt producers: show model row then prompt cards */}
      {category === 'prompt' && promptData && (
        <div className='space-y-5'>
          {/* Model selection row */}
          <PropertyRow name='Model' type='select' required>
            <ModelSelector
              producerId={producerId}
              availableModels={availableModels}
              currentSelection={currentSelection}
              isEditable={isEditable}
              onChange={onModelChange}
            />
          </PropertyRow>

          {/* Prompt cards */}
          <MediaGrid className='grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2'>
            {promptData.systemPrompt !== undefined && (
              <TextCard
                label='System Prompt'
                value={promptData.systemPrompt}
                onChange={handleSaveSystemPrompt}
                isEditable={isEditable}
                language='markdown'
                variables={promptData.variables}
                dialogPreset='prompt-authoring'
              />
            )}
            {promptData.userPrompt !== undefined && (
              <TextCard
                label='User Prompt'
                value={promptData.userPrompt}
                onChange={handleSaveUserPrompt}
                isEditable={isEditable}
                language='markdown'
                variables={promptData.variables}
                dialogPreset='prompt-authoring'
              />
            )}
          </MediaGrid>
        </div>
      )}

      {/* Asset producers: show config properties editor with model selection */}
      {category === 'asset' &&
        (producerError ? (
          <div className='space-y-4'>
            <PropertyRow name='Model' type='select' required>
              <ModelSelector
                producerId={producerId}
                availableModels={availableModels}
                currentSelection={currentSelection}
                isEditable={isEditable}
                onChange={onModelChange}
              />
            </PropertyRow>
            <div
              role='alert'
              className='flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive'
            >
              <AlertCircle className='size-4 shrink-0 mt-0.5' />
              <div>
                <p className='font-medium'>Model configuration unavailable</p>
                <p className='mt-1 text-xs text-destructive/90'>
                  [{producerError.code}] {producerError.error}
                </p>
              </div>
            </div>
          </div>
        ) : schemaError ? (
          <ConfigPropertiesEditor
            fields={[]}
            values={{}}
            isEditable={false}
            onChange={() => {}}
            schemaError={schemaError}
            producerId={producerId}
            availableModels={availableModels}
            currentModelSelection={currentSelection}
            onModelChange={onModelChange}
            blueprintFolder={blueprintFolder}
            movieId={movieId}
          />
        ) : (
          <div className='space-y-4'>
            <ConfigPropertiesEditor
              fields={configFields ?? []}
              values={configValues}
              isEditable={isEditable}
              onChange={(key, value) => onConfigChange?.(key, value)}
              producerId={producerId}
              availableModels={availableModels}
              currentModelSelection={currentSelection}
              onModelChange={onModelChange}
              nestedModelSchemas={nestedModelSchemas}
              onNestedModelChange={handleNestedModelChange}
              fieldPreview={fieldPreview}
              blueprintFolder={blueprintFolder}
              movieId={movieId}
            />
          </div>
        ))}
    </>
  );

  if (hideSectionContainer) {
    return sectionContent;
  }

  return (
    <CollapsibleSection
      title={sectionTitle}
      count={itemCount}
      description={description}
      defaultOpen={defaultOpen}
      className={getSectionHighlightStyles(isSelected, 'primary')}
    >
      {sectionContent}
    </CollapsibleSection>
  );
}
