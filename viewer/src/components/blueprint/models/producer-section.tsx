import { useCallback, useMemo } from "react";
import { Pencil } from "lucide-react";
import { CollapsibleSection, MediaGrid, TextCard, PropertyRow } from "../shared";
import { ModelSelector } from "./model-selector";
import { ConfigPropertiesEditor } from "./config-properties-editor";
import { getSectionHighlightStyles } from "@/lib/panel-utils";
import type {
  AvailableModelOption,
  ModelSelectionValue,
  ProducerCategory,
  PromptData,
  ConfigProperty,
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

  // Build section title
  const sectionTitle = producerId;

  // Count items based on category
  const itemCount = useMemo(() => {
    if (category === "prompt" && promptData) {
      let count = 0;
      if (promptData.systemPrompt !== undefined) count++;
      if (promptData.userPrompt !== undefined) count++;
      return count;
    }
    if (category === "asset" && configProperties) {
      return configProperties.length;
    }
    return undefined;
  }, [category, promptData, configProperties]);

  // Actions to render in header (edited badge only)
  const headerActions = isEdited ? (
    <div className="flex items-center gap-2">
      <span className="flex items-center gap-0.5 text-xs text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
        <Pencil className="size-3" />
        Edited
      </span>
    </div>
  ) : null;

  // For composition producers, show a simpler non-collapsible section
  if (category === "composition") {
    return (
      <div className={`rounded-lg px-2 py-1.5 ${getSectionHighlightStyles(isSelected, "blue")}`}>
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
      className={getSectionHighlightStyles(isSelected, "blue")}
    >
      {/* Prompt producers: show model row then prompt cards */}
      {category === "prompt" && (
        promptData ? (
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
        ) : (
          <div className="text-xs text-muted-foreground italic py-2">
            Prompt data not loaded. This producer uses a TOML prompt file.
          </div>
        )
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
          <ConfigPropertiesEditor
            properties={configProperties}
            values={configValues}
            isEditable={isEditable}
            onChange={(key, value) => onConfigChange?.(key, value)}
            producerId={producerId}
            availableModels={availableModels}
            currentModelSelection={currentSelection}
            onModelChange={onModelChange}
          />
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
            <div className="text-xs text-muted-foreground italic">
              {configProperties ? "No additional configurable properties for this model." : "Config schema not loaded."}
            </div>
          </div>
        )
      )}
    </CollapsibleSection>
  );
}
