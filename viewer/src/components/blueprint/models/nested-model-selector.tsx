import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { NestedModelConfigSchema } from "@/types/blueprint-graph";

interface NestedModelSelectorProps {
  /** Nested model schema with declaration and available models */
  nestedSchema: NestedModelConfigSchema;
  /** Current nested provider selection */
  currentProvider?: string;
  /** Current nested model selection */
  currentModel?: string;
  /** Whether the selector is editable */
  isEditable: boolean;
  /** Callback when nested model selection changes */
  onChange: (provider: string, model: string) => void;
}

/**
 * Dropdown selector for choosing a nested model (e.g., STT backend for TranscriptionProducer).
 * Displays available models filtered by the nested model declaration constraints.
 */
export function NestedModelSelector({
  nestedSchema,
  currentProvider,
  currentModel,
  isEditable,
  onChange,
}: NestedModelSelectorProps) {
  const { availableModels } = nestedSchema;

  // Format the current selection as "provider/model" for display
  const currentValue =
    currentProvider && currentModel ? `${currentProvider}/${currentModel}` : undefined;

  // Handle model selection change
  const handleChange = (value: string) => {
    const [provider, ...modelParts] = value.split("/");
    const model = modelParts.join("/");
    onChange(provider, model);
  };

  if (!isEditable) {
    // Read-only display - styled consistently with ModelSelector
    return (
      <div className="text-xs text-foreground bg-muted/50 px-2 py-1.5 rounded truncate">
        {currentValue ? (
          <>
            <span className="text-muted-foreground">{currentProvider}/</span>
            {currentModel}
          </>
        ) : (
          <span className="text-muted-foreground italic">Not selected</span>
        )}
      </div>
    );
  }

  if (availableModels.length === 0) {
    return (
      <span className="text-xs text-muted-foreground italic">No models available</span>
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
