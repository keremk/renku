/**
 * Individual config property row with type-aware input.
 * Supports string, number, boolean, and enum types.
 * Filters out complex types (object, array) that need specialized editors.
 */

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PropertyRow } from "../shared/property-row";
import { isComplexProperty } from "./config-utils";
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
 * Returns null for complex types (object, array) that need specialized editors.
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

  // Filter out complex types - they need specialized editors
  if (isComplexProperty(property)) {
    return null;
  }

  // Determine the display value
  const displayValue = value ?? schema.default;

  // Render the appropriate input based on type
  const renderInput = () => {
    if (hasEnum) {
      return (
        <EnumInput
          options={schema.enum as (string | number | boolean)[]}
          value={displayValue as string}
          isEditable={isEditable}
          onChange={onChange}
        />
      );
    }

    if (schemaType === "boolean") {
      return (
        <BooleanInput
          value={displayValue as boolean}
          isEditable={isEditable}
          onChange={onChange}
        />
      );
    }

    if (schemaType === "number" || schemaType === "integer") {
      return (
        <NumberInput
          value={displayValue as number}
          schema={schema}
          isEditable={isEditable}
          onChange={onChange}
        />
      );
    }

    return (
      <StringInput
        value={displayValue as string}
        isEditable={isEditable}
        onChange={onChange}
      />
    );
  };

  return (
    <PropertyRow
      name={key}
      type={schemaType}
      description={schema.description}
      required={required}
    >
      {renderInput()}
    </PropertyRow>
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
    <div className="flex justify-start">
      <Switch
        checked={value ?? false}
        onCheckedChange={(checked) => onChange(checked)}
        disabled={!isEditable}
        size="sm"
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
