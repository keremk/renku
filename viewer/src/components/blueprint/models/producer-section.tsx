import { useCallback, useMemo } from "react";
import { Pencil } from "lucide-react";
import { CollapsibleSection, MediaGrid } from "../shared";
import { TextInputCard } from "../inputs/text-input-card";
import { ModelSelector } from "./model-selector";
import { PromptEditDialog } from "./prompt-edit-dialog";
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
}

/**
 * Section for a producer showing model selection and expandable content.
 * Uses CollapsibleSection for consistent styling with InputsPanel.
 * - For prompt producers: shows prompt cards using TextInputCard (same as inputs)
 * - For asset producers: shows config properties editor
 * - For composition producers: just shows the header (no expandable content)
 */
export function ProducerSection({
  producerId,
  producerType,
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

  // Actions to render in header (model selector and badges)
  const headerActions = (
    <div className="flex items-center gap-2">
      {producerType && (
        <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          {producerType}
        </span>
      )}
      {isEdited && (
        <span className="flex items-center gap-0.5 text-xs text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded">
          <Pencil className="size-3" />
          Edited
        </span>
      )}
      <div className="w-48">
        {category === "composition" ? (
          <span className="text-xs text-muted-foreground italic bg-muted/50 px-2 py-1.5 rounded block text-center">
            No model required
          </span>
        ) : (
          <ModelSelector
            producerId={producerId}
            availableModels={availableModels}
            currentSelection={currentSelection}
            isEditable={isEditable}
            onChange={onModelChange}
          />
        )}
      </div>
    </div>
  );

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
      defaultOpen={false}
      actions={headerActions}
      className={getSectionHighlightStyles(isSelected, "blue")}
    >
      {/* Prompt producers: show prompt cards using TextInputCard */}
      {category === "prompt" && (
        promptData ? (
          <div className="space-y-4">
            <MediaGrid className="grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2">
              {promptData.systemPrompt !== undefined && (
                <TextInputCard
                  label="System Prompt"
                  value={promptData.systemPrompt}
                  onChange={handleSaveSystemPrompt}
                  isEditable={isEditable}
                  renderDialog={({ open, onOpenChange, value, onSave }) => (
                    <PromptEditDialog
                      open={open}
                      onOpenChange={onOpenChange}
                      title="Edit System Prompt"
                      content={value}
                      variables={promptData.variables}
                      onSave={onSave}
                    />
                  )}
                />
              )}
              {promptData.userPrompt !== undefined && (
                <TextInputCard
                  label="User Prompt"
                  value={promptData.userPrompt}
                  onChange={handleSaveUserPrompt}
                  isEditable={isEditable}
                  renderDialog={({ open, onOpenChange, value, onSave }) => (
                    <PromptEditDialog
                      open={open}
                      onOpenChange={onOpenChange}
                      title="Edit User Prompt"
                      content={value}
                      variables={promptData.variables}
                      onSave={onSave}
                    />
                  )}
                />
              )}
            </MediaGrid>

            {/* Variables list */}
            {promptData.variables && promptData.variables.length > 0 && (
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1.5">
                  Available Variables
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {promptData.variables.map((v) => (
                    <span
                      key={v}
                      className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded font-mono"
                    >
                      {`{{${v}}}`}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic py-2">
            Prompt data not loaded. This producer uses a TOML prompt file.
          </div>
        )
      )}

      {/* Asset producers: show config properties editor */}
      {category === "asset" && (
        configProperties && configProperties.length > 0 ? (
          <ConfigPropertiesEditor
            properties={configProperties}
            values={configValues}
            isEditable={isEditable}
            onChange={(key, value) => onConfigChange?.(key, value)}
          />
        ) : (
          <div className="text-xs text-muted-foreground italic py-2">
            {configProperties ? "No configurable properties for this model." : "Config schema not loaded."}
          </div>
        )
      )}
    </CollapsibleSection>
  );
}
