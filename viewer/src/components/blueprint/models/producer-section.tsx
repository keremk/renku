import { useCallback, useMemo } from "react";
import { Pencil } from "lucide-react";
import { CollapsibleSection, MediaGrid, TextCard, PropertyRow } from "../shared";
import { ModelSelector } from "./model-selector";
import { NestedModelSelector } from "./nested-model-selector";
import { ConfigPropertiesEditor } from "./config-properties-editor";
import { hasRegisteredEditor } from "./config-editors";
import { isComplexProperty } from "./config-utils";
import { getNestedModelSelection } from "./stt-helpers";
import { getSectionHighlightStyles } from "@/lib/panel-utils";
import type {
  AvailableModelOption,
  ModelSelectionValue,
  ProducerCategory,
  PromptData,
  ConfigProperty,
  NestedModelConfigSchema,
} from "@/types/blueprint-graph";

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
  /** Whether any content has been edited */
  isEdited?: boolean;
  /** Callback when model selection changes */
  onModelChange: (selection: ModelSelectionValue) => void;
  /** Prompt data for prompt producers */
  promptData?: PromptData;
  /** Callback when prompts change */
  onPromptChange?: (prompts: PromptData) => void;
  /** Config properties for asset producers */
  configProperties?: ConfigProperty[];
  /** Current config values */
  configValues?: Record<string, unknown>;
  /** Callback when config changes */
  onConfigChange?: (key: string, value: unknown) => void;
  /** Error message if config schema failed to load */
  schemaError?: string | null;
  /** Nested model schemas (if this producer has nested model declarations) */
  nestedModelSchemas?: NestedModelConfigSchema[];
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
  isEdited = false,
  onModelChange,
  promptData,
  onPromptChange,
  configProperties,
  configValues = {},
  onConfigChange,
  schemaError,
  nestedModelSchemas,
}: ProducerSectionProps) {
  // Handle saving system prompt
  const handleSaveSystemPrompt = useCallback(
    async (content: string) => {
      if (!promptData || !onPromptChange) return;
      const updatedPrompts: PromptData = {
        ...promptData,
        source: "build",
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
        source: "build",
        userPrompt: content,
      };
      await Promise.resolve(onPromptChange(updatedPrompts));
    },
    [promptData, onPromptChange]
  );

  // Handle nested model selection change
  const handleNestedModelChange = useCallback(
    (nestedSchema: NestedModelConfigSchema, provider: string, model: string) => {
      if (!currentSelection) return;

      const { configPath, providerField, modelField } = nestedSchema.declaration;

      // Update the nested model config while preserving other properties
      const existingNestedConfig = (currentSelection.config?.[configPath] ?? {}) as Record<string, unknown>;
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

  // For composition producers, filter to only show properties with registered editors
  // (e.g., subtitles) - don't show primitive config like width, height, fps, etc.
  const compositionConfigProperties = useMemo(() => {
    if (category !== "composition" || !configProperties) return [];
    return configProperties.filter(
      (prop) => isComplexProperty(prop) && hasRegisteredEditor(prop.key)
    );
  }, [category, configProperties]);

  // Count items based on category
  const itemCount = useMemo(() => {
    if (category === "prompt" && promptData) {
      let count = 0;
      if (promptData.systemPrompt !== undefined) count++;
      if (promptData.userPrompt !== undefined) count++;
      return count;
    }
    if (category === "composition") {
      return compositionConfigProperties.length || undefined;
    }
    if (category === "asset" && configProperties) {
      return configProperties.length;
    }
    return undefined;
  }, [category, promptData, configProperties, compositionConfigProperties]);

  // Actions to render in header (edited badge only)
  const headerActions = isEdited ? (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-0.5 text-xs text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
        <Pencil className="size-3" />
        Edited
      </span>
    </div>
  ) : null;

  // For composition producers with displayable config, show collapsible section
  // For composition producers without displayable config, show simple non-collapsible section
  if (category === "composition") {
    // If there are displayable config properties, render with ConfigPropertiesEditor
    if (compositionConfigProperties.length > 0) {
      return (
        <CollapsibleSection
          title={sectionTitle}
          count={compositionConfigProperties.length}
          description={description}
          defaultOpen={true}
          actions={headerActions}
          className={getSectionHighlightStyles(isSelected, "primary")}
        >
          <ConfigPropertiesEditor
            properties={compositionConfigProperties}
            values={configValues}
            isEditable={isEditable}
            onChange={(key, value) => onConfigChange?.(key, value)}
          />
        </CollapsibleSection>
      );
    }

    // No displayable config properties - render simple view
    return (
      <div className={`rounded-lg px-2 py-1.5 ${getSectionHighlightStyles(isSelected, "primary")}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground">{producerId}</span>
          </div>
          {headerActions}
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 ml-0">{description}</p>
        )}
      </div>
    );
  }

  return (
    <CollapsibleSection
      title={sectionTitle}
      count={itemCount}
      description={description}
      defaultOpen={true}
      actions={headerActions}
      className={getSectionHighlightStyles(isSelected, "primary")}
    >
      {/* Prompt producers: show model row then prompt cards */}
      {category === "prompt" && promptData && (
        <div className="space-y-4">
          {/* Model selection row */}
          <PropertyRow name="Model" type="select" required>
            <ModelSelector
              producerId={producerId}
              availableModels={availableModels}
              currentSelection={currentSelection}
              isEditable={isEditable}
              onChange={onModelChange}
            />
          </PropertyRow>

          {/* Prompt cards */}
          <MediaGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
            {promptData.systemPrompt !== undefined && (
              <TextCard
                label="System Prompt"
                value={promptData.systemPrompt}
                onChange={handleSaveSystemPrompt}
                isEditable={isEditable}
                language="markdown"
                variables={promptData.variables}
              />
            )}
            {promptData.userPrompt !== undefined && (
              <TextCard
                label="User Prompt"
                value={promptData.userPrompt}
                onChange={handleSaveUserPrompt}
                isEditable={isEditable}
                language="markdown"
                variables={promptData.variables}
              />
            )}
          </MediaGrid>
        </div>
      )}

      {/* Asset producers: show config properties editor with model selection */}
      {category === "asset" && (
        schemaError ? (
          <ConfigPropertiesEditor
            properties={[]}
            values={{}}
            isEditable={false}
            onChange={() => {}}
            schemaError={schemaError}
          />
        ) : configProperties && configProperties.length > 0 ? (
          <div className="space-y-4">
            <ConfigPropertiesEditor
              properties={configProperties}
              values={configValues}
              isEditable={isEditable}
              onChange={(key, value) => onConfigChange?.(key, value)}
              producerId={producerId}
              availableModels={availableModels}
              currentModelSelection={currentSelection}
              onModelChange={onModelChange}
              nestedModelSchemas={nestedModelSchemas}
              onNestedModelChange={handleNestedModelChange}
            />
          </div>
        ) : (
          <div className="space-y-3">
            {/* Model selection row for asset producers without config */}
            <PropertyRow name="Model" type="select" required>
              <ModelSelector
                producerId={producerId}
                availableModels={availableModels}
                currentSelection={currentSelection}
                isEditable={isEditable}
                onChange={onModelChange}
              />
            </PropertyRow>
            {/* Render nested model selectors if present (even without top-level config) */}
            {nestedModelSchemas && nestedModelSchemas.length > 0 && nestedModelSchemas.map((nestedSchema) => {
              const nestedSel = getNestedModelSelection(
                currentSelection,
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
                      handleNestedModelChange(nestedSchema, provider, model)
                    }
                  />
                </PropertyRow>
              );
            })}
          </div>
        )
      )}
    </CollapsibleSection>
  );
}
