/**
 * Individual config property row with type-aware input.
 * Supports string, number, boolean, and enum types.
 */

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ConfigProperty } from "@/types/blueprint-graph";

interface ConfigPropertyRowProps {
  /** The config property definition */
  property: ConfigProperty;
  /** Current value */
  value: unknown;
  /** Whether editing is enabled */
  isEditable: boolean;
  /** Callback when value changes */
  onChange: (value: unknown) => void;
}

/**
 * Renders a type-appropriate input for a config property.
 */
export function ConfigPropertyRow({
  property,
  value,
  isEditable,
  onChange,
}: ConfigPropertyRowProps) {
  const { key, schema, required } = property;
  const schemaType = schema.type;
  const hasEnum = schema.enum && schema.enum.length > 0;

  // Determine the display value
  const displayValue = value ?? schema.default;

  return (
    <div className="flex items-center justify-between gap-3 text-xs bg-background/50 p-2 rounded border border-border/30">
      {/* Property name and info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="font-medium text-foreground truncate">{key}</span>
          {required && <span className="text-amber-500">*</span>}
        </div>
        {schema.description && (
          <p className="text-muted-foreground truncate mt-0.5">
            {schema.description}
          </p>
        )}
      </div>

      {/* Input based on type */}
      <div className="flex-shrink-0 w-40">
        {hasEnum ? (
          <EnumInput
            options={schema.enum!}
            value={displayValue as string}
            isEditable={isEditable}
            onChange={onChange}
          />
        ) : schemaType === "boolean" ? (
          <BooleanInput
            value={displayValue as boolean}
            isEditable={isEditable}
            onChange={onChange}
          />
        ) : schemaType === "number" || schemaType === "integer" ? (
          <NumberInput
            value={displayValue as number}
            schema={schema}
            isEditable={isEditable}
            onChange={onChange}
          />
        ) : (
          <StringInput
            value={displayValue as string}
            isEditable={isEditable}
            onChange={onChange}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Type-specific input components
// ============================================================================

interface EnumInputProps {
  options: (string | number | boolean)[];
  value: string;
  isEditable: boolean;
  onChange: (value: unknown) => void;
}

function EnumInput({ options, value, isEditable, onChange }: EnumInputProps) {
  if (!isEditable) {
    return (
      <span className="text-muted-foreground text-right block">
        {value ?? "—"}
      </span>
    );
  }

  return (
    <Select
      value={value?.toString() ?? ""}
      onValueChange={(v) => onChange(v)}
    >
      <SelectTrigger className="h-7 text-xs">
        <SelectValue placeholder="Select..." />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={String(opt)} value={String(opt)} className="text-xs">
            {String(opt)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface BooleanInputProps {
  value: boolean;
  isEditable: boolean;
  onChange: (value: unknown) => void;
}

function BooleanInput({ value, isEditable, onChange }: BooleanInputProps) {
  return (
    <div className="flex justify-end">
      <input
        type="checkbox"
        checked={value ?? false}
        onChange={(e) => onChange(e.target.checked)}
        disabled={!isEditable}
        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
      />
    </div>
  );
}

interface NumberInputProps {
  value: number;
  schema: ConfigProperty["schema"];
  isEditable: boolean;
  onChange: (value: unknown) => void;
}

function NumberInput({
  value,
  schema,
  isEditable,
  onChange,
}: NumberInputProps) {
  if (!isEditable) {
    return (
      <span className="text-muted-foreground text-right block">
        {value ?? "—"}
      </span>
    );
  }

  return (
    <Input
      type="number"
      value={value ?? ""}
      min={schema.minimum}
      max={schema.maximum}
      step={schema.type === "integer" ? 1 : 0.1}
      onChange={(e) => {
        const numValue = e.target.value === "" ? undefined : Number(e.target.value);
        onChange(numValue);
      }}
      className="h-7 text-xs"
    />
  );
}

interface StringInputProps {
  value: string;
  isEditable: boolean;
  onChange: (value: unknown) => void;
}

function StringInput({ value, isEditable, onChange }: StringInputProps) {
  if (!isEditable) {
    return (
      <span className="text-muted-foreground text-right block truncate">
        {value ?? "—"}
      </span>
    );
  }

  return (
    <Input
      type="text"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
      className="h-7 text-xs"
    />
  );
}
