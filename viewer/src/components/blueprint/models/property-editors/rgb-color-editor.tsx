import { useState, type ReactNode } from 'react';
import { Sketch } from '@uiw/react-color';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { PropertyRow } from '../../shared';
import { getLeafKey } from './path-utils';
import { ResetOverrideButton } from './reset-override-button';

type RgbChannel = 'r' | 'g' | 'b';

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface RgbColorEditorProps {
  field: ConfigFieldDescriptor;
  rowName: ReactNode;
  description?: string;
  effectiveValue: unknown;
  isEditable: boolean;
  canResetMappedOverride: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
}

export function RgbColorEditor({
  field,
  rowName,
  description,
  effectiveValue,
  isEditable,
  canResetMappedOverride,
  onChange,
  onReset,
}: RgbColorEditorProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const rgbValue = resolveRgbValue(field, effectiveValue);
  const hexColor = rgbToHex(rgbValue);

  const applyHexColor = (hex: string) => {
    const parsed = hexToRgb(hex);
    if (!parsed) {
      return;
    }
    onChange(mergeRgbValue(effectiveValue, parsed));
  };

  return (
    <PropertyRow
      name={rowName}
      type={field.component}
      description={description}
      required={field.required}
    >
      <div className='flex flex-wrap items-center gap-2'>
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type='button'
              disabled={!isEditable}
              className={cn(
                'size-8 rounded border border-input transition-all',
                !isEditable
                  ? 'cursor-not-allowed opacity-50'
                  : 'hover:ring-2 hover:ring-ring/50'
              )}
              style={{ backgroundColor: hexColor }}
              aria-label={`Pick color for ${field.label}`}
            />
          </PopoverTrigger>

          <PopoverContent className='w-auto p-0' align='start'>
            <Sketch
              color={hexColor}
              onChange={(color) => applyHexColor(color.hex)}
            />
          </PopoverContent>
        </Popover>

        <span className='text-xs font-mono text-muted-foreground'>
          {hexColor}
        </span>

        {canResetMappedOverride && <ResetOverrideButton onReset={onReset} />}
      </div>
    </PropertyRow>
  );
}

function resolveRgbValue(
  field: ConfigFieldDescriptor,
  effectiveValue: unknown
): RgbColor {
  const channelFields = getRgbChannelFields(field);
  const source =
    effectiveValue &&
    typeof effectiveValue === 'object' &&
    !Array.isArray(effectiveValue)
      ? (effectiveValue as Record<string, unknown>)
      : undefined;

  return {
    r: resolveChannelValue('r', field.keyPath, channelFields.r, source),
    g: resolveChannelValue('g', field.keyPath, channelFields.g, source),
    b: resolveChannelValue('b', field.keyPath, channelFields.b, source),
  };
}

function getRgbChannelFields(field: ConfigFieldDescriptor): {
  r?: ConfigFieldDescriptor;
  g?: ConfigFieldDescriptor;
  b?: ConfigFieldDescriptor;
} {
  const result: {
    r?: ConfigFieldDescriptor;
    g?: ConfigFieldDescriptor;
    b?: ConfigFieldDescriptor;
  } = {};

  for (const childField of field.fields ?? []) {
    const leaf = getLeafKey(childField.keyPath).toLowerCase();
    if (leaf === 'r' || leaf === 'g' || leaf === 'b') {
      result[leaf] = childField;
    }
  }

  return result;
}

function resolveChannelValue(
  key: RgbChannel,
  objectKeyPath: string,
  channelField: ConfigFieldDescriptor | undefined,
  source: Record<string, unknown> | undefined
): number {
  const fromValue = source?.[key];
  if (typeof fromValue === 'number' && Number.isFinite(fromValue)) {
    return normalizeChannel(fromValue);
  }

  const schemaDefault = channelField?.schema?.default;
  if (typeof schemaDefault === 'number' && Number.isFinite(schemaDefault)) {
    return normalizeChannel(schemaDefault);
  }

  const minimum = channelField?.schema?.minimum;
  if (typeof minimum === 'number' && Number.isFinite(minimum)) {
    return normalizeChannel(minimum);
  }

  throw new Error(
    `RGB color field "${objectKeyPath}" is missing an initial value for channel "${key}". Provide explicit value or schema default/minimum.`
  );
}

function normalizeChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mergeRgbValue(
  effectiveValue: unknown,
  rgb: RgbColor
): Record<string, unknown> {
  const base =
    effectiveValue &&
    typeof effectiveValue === 'object' &&
    !Array.isArray(effectiveValue)
      ? { ...(effectiveValue as Record<string, unknown>) }
      : {};

  base.r = rgb.r;
  base.g = rgb.g;
  base.b = rgb.b;

  return base;
}

function rgbToHex(rgb: RgbColor): string {
  const r = rgb.r.toString(16).padStart(2, '0');
  const g = rgb.g.toString(16).padStart(2, '0');
  const b = rgb.b.toString(16).padStart(2, '0');
  return `#${r}${g}${b}`.toUpperCase();
}

function hexToRgb(hex: string): RgbColor | null {
  const normalized = normalizeHex(hex);
  if (!normalized) {
    return null;
  }

  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }

  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  return null;
}
