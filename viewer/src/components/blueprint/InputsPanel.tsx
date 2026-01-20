import type { BlueprintInputDef } from "@/types/blueprint-graph";

interface InputValue {
  name: string;
  value?: unknown;
}

interface InputsPanelProps {
  inputs: BlueprintInputDef[];
  inputValues: InputValue[];
  selectedNodeId: string | null;
}

export function InputsPanel({
  inputs,
  inputValues,
  selectedNodeId,
}: InputsPanelProps) {
  // Create a map of input values by name
  const valueMap = new Map<string, unknown>();
  for (const iv of inputValues) {
    valueMap.set(iv.name, iv.value);
  }

  // Determine which input is selected based on node ID
  const selectedInputName = selectedNodeId?.startsWith("Input:")
    ? selectedNodeId.replace("Input:", "").split(".").pop()
    : null;

  if (inputs.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No inputs defined in this blueprint.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {inputs.map((input) => {
        const value = valueMap.get(input.name);
        const isSelected = selectedInputName === input.name;

        return (
          <InputCard
            key={input.name}
            input={input}
            value={value}
            isSelected={isSelected}
          />
        );
      })}
    </div>
  );
}

function InputCard({
  input,
  value,
  isSelected,
}: {
  input: BlueprintInputDef;
  value: unknown;
  isSelected: boolean;
}) {
  const hasValue = value !== undefined && value !== null && value !== "";

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
      <div className="flex items-center gap-2 mb-1">
        <span className="font-medium text-sm text-foreground">{input.name}</span>
        <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          {input.type}
        </span>
        {input.required && (
          <span className="text-xs text-amber-400">required</span>
        )}
      </div>

      {input.description && (
        <p className="text-xs text-muted-foreground mb-2">{input.description}</p>
      )}

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Value:</span>
        {hasValue ? (
          <span className="text-xs text-green-400 font-mono bg-green-500/10 px-1.5 py-0.5 rounded">
            {formatValue(value)}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/60 italic">
            not provided
          </span>
        )}
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value.length > 50 ? `${value.slice(0, 50)}...` : value;
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.length} items]`;
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value).slice(0, 50) + "...";
  }
  return String(value);
}
