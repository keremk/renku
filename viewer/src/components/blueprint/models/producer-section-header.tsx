import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { ModelSelector } from "./model-selector";
import type {
  AvailableModelOption,
  ModelSelectionValue,
  ProducerCategory,
} from "@/types/blueprint-graph";

interface ProducerSectionHeaderProps {
  /** Producer identifier */
  producerId: string;
  /** Producer type (e.g., "asset/text-to-image") */
  producerType?: string;
  /** Producer description */
  description?: string;
  /** Category determines how models are displayed */
  category: ProducerCategory;
  /** Available models for selection */
  availableModels: AvailableModelOption[];
  /** Current model selection */
  currentSelection?: ModelSelectionValue;
  /** Whether the section is expanded */
  isExpanded: boolean;
  /** Whether model selection is editable */
  isEditable: boolean;
  /** Whether the content has been edited */
  isEdited?: boolean;
  /** Callback when expand/collapse is toggled */
  onToggle: () => void;
  /** Callback when model selection changes */
  onModelChange: (selection: ModelSelectionValue) => void;
}

/**
 * Header for a producer section showing producer info, model selector, and expand toggle.
 */
export function ProducerSectionHeader({
  producerId,
  producerType,
  description,
  category,
  availableModels,
  currentSelection,
  isExpanded,
  isEditable,
  isEdited = false,
  onToggle,
  onModelChange,
}: ProducerSectionHeaderProps) {
  // Determine if this producer has expandable content
  // - prompt producers have prompts to edit
  // - asset producers may have config properties
  const hasExpandableContent = category === "prompt" || category === "asset";

  return (
    <div className="flex items-start gap-3 w-full">
      {/* Expand/collapse toggle */}
      {hasExpandableContent ? (
        <button
          type="button"
          onClick={onToggle}
          className="flex-shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </button>
      ) : (
        <div className="w-4 flex-shrink-0" />
      )}

      {/* Producer info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground">
            {producerId}
          </span>
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
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
            {description}
          </p>
        )}
      </div>

      {/* Model selector */}
      <div className="flex-shrink-0 w-48">
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
}
