import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AvailableModelOption, ModelSelectionValue, ProducerCategory } from "@/types/blueprint-graph";

interface ModelCardProps {
  producerId: string;
  producerType?: string;
  description?: string;
  category: ProducerCategory;
  availableModels: AvailableModelOption[];
  currentSelection?: ModelSelectionValue;
  isSelected: boolean;
  isEditable: boolean;
  onChange: (selection: ModelSelectionValue) => void;
}

/**
 * Card component for displaying and editing a producer's model selection.
 */
export function ModelCard({
  producerId,
  producerType,
  description,
  category,
  availableModels,
  currentSelection,
  isSelected,
  isEditable,
  onChange,
}: ModelCardProps) {
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

  return (
    <div
      className={`
        p-3 rounded-lg border transition-all
        ${
          isSelected
            ? "border-blue-400 bg-blue-500/10 ring-1 ring-blue-400/30"
            : "border-border/40 bg-muted/30"
        }
      `}
    >
      <div className="grid grid-cols-2 gap-4">
        {/* Left column: producer name, type badge, description */}
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm text-foreground">
              {producerId}
            </span>
            {producerType && (
              <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
                {producerType}
              </span>
            )}
          </div>
          {description && (
            <p className="text-xs text-muted-foreground">{description}</p>
          )}
        </div>

        {/* Right column: model selector or display */}
        <div className="min-w-0">
          {category === 'composition' ? (
            <span className="text-xs text-muted-foreground italic bg-muted/50 px-2 py-1.5 rounded">
              No model selection required
            </span>
          ) : isEditable && availableModels.length > 0 ? (
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
          ) : availableModels.length === 0 ? (
            <span className="text-xs text-muted-foreground italic">
              No models configured
            </span>
          ) : (
            <div className="text-xs text-foreground bg-muted/50 px-2 py-1.5 rounded truncate">
              {currentValue ?? <span className="text-muted-foreground italic">Not selected</span>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
