import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AvailableModelOption, ModelSelectionValue } from "@/types/blueprint-graph";

interface ModelSelectorProps {
  /** Producer ID for constructing the selection */
  producerId: string;
  /** Available models to choose from */
  availableModels: AvailableModelOption[];
  /** Current selection (if any) */
  currentSelection?: ModelSelectionValue;
  /** Whether the selector is editable */
  isEditable: boolean;
  /** Callback when selection changes */
  onChange: (selection: ModelSelectionValue) => void;
}

/**
 * Dropdown selector for choosing a model for a producer.
 * Extracted from ModelCard for reuse in ProducerSection.
 */
export function ModelSelector({
  producerId,
  availableModels,
  currentSelection,
  isEditable,
  onChange,
}: ModelSelectorProps) {
  // Format the current selection as "provider/model" for display
  const currentValue = currentSelection
    ? `${currentSelection.provider}/${currentSelection.model}`
    : undefined;

  // Handle model selection change
  const handleChange = (value: string) => {
    const [provider, ...modelParts] = value.split("/");
    const model = modelParts.join("/");
    onChange({
      producerId,
      provider,
      model,
      config: currentSelection?.config,
    });
  };

  if (!isEditable) {
    // Read-only display
    return (
      <div className="text-xs text-foreground bg-muted/50 px-2 py-1.5 rounded truncate">
        {currentValue ?? <span className="text-muted-foreground italic">Not selected</span>}
      </div>
    );
  }

  if (availableModels.length === 0) {
    return (
      <span className="text-xs text-muted-foreground italic">
        No models configured
      </span>
    );
  }

  return (
    <Select value={currentValue} onValueChange={handleChange}>
      <SelectTrigger className="h-8 text-xs">
        <SelectValue placeholder="Select model..." />
      </SelectTrigger>
      <SelectContent>
        {availableModels.map((option) => {
          const value = `${option.provider}/${option.model}`;
          return (
            <SelectItem key={value} value={value} className="text-xs">
              <span className="text-muted-foreground">{option.provider}/</span>
              {option.model}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
