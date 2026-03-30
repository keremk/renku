import { useState } from 'react';
import { Sketch } from '@uiw/react-color';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { PropertyRow } from '../../shared';
import { resolveObjectInitialValue } from './field-value-utils';
import { getLeafKey } from './path-utils';
import { ResetOverrideButton } from './reset-override-button';
import type { CustomFieldEditorProps } from './types';

type RgbChannel = 'r' | 'g' | 'b';

interface ChannelDescriptor {
  r: ConfigFieldDescriptor;
  g: ConfigFieldDescriptor;
  b: ConfigFieldDescriptor;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

interface ColorPickerControlProps {
  field: ConfigFieldDescriptor;
  value: unknown;
  isEditable: boolean;
  onChange: (value: unknown) => void;
  ariaLabel: string;
}

export function ColorPickerEditor({
  field,
  rowName,
  description,
  effectiveValue,
  isEditable,
  canResetMappedOverride,
  onChange,
  onReset,
}: CustomFieldEditorProps) {
  if (field.component !== 'object') {
    throw new Error(
      `Custom renderer "color-picker" requires object component for field "${field.keyPath}".`
    );
  }

  return (
    <PropertyRow
      name={rowName}
      type={field.component}
      description={description}
      required={field.required}
    >
      <div className='space-y-2'>
        <ColorPickerControl
          field={field}
          value={effectiveValue}
          isEditable={isEditable}
          onChange={onChange}
          ariaLabel={`Pick color for ${field.label}`}
        />
        {canResetMappedOverride && <ResetOverrideButton onReset={onReset} />}
      </div>
    </PropertyRow>
  );
}

export function ColorPickerControl({
  field,
  value,
  isEditable,
  onChange,
  ariaLabel,
}: ColorPickerControlProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  const channels = getChannelDescriptors(field);
  const rgbValue = resolveRgbValue(field, channels, value);
  const hexColor = rgbToHex(rgbValue);

  const applyHexColor = (hex: string) => {
    const parsed = hexToRgb(hex);
    if (!parsed) {
      return;
    }

    onChange(mergeRgbValue(value, channels, parsed));
  };

  return (
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
            aria-label={ariaLabel}
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
    </div>
  );
}

function getChannelDescriptors(
  field: ConfigFieldDescriptor
): ChannelDescriptor {
  if (!field.fields || field.fields.length === 0) {
    throw new Error(
      `Custom renderer "color-picker" for field "${field.keyPath}" requires object fields.`
    );
  }

  const byLeaf = new Map<string, ConfigFieldDescriptor>();
  for (const childField of field.fields) {
    byLeaf.set(getLeafKey(childField.keyPath).toLowerCase(), childField);
  }

  const r = byLeaf.get('r');
  const g = byLeaf.get('g');
  const b = byLeaf.get('b');

  if (!r || !g || !b) {
    throw new Error(
      `Custom renderer "color-picker" for field "${field.keyPath}" requires r/g/b fields.`
    );
  }

  validateNumericChannel(field.keyPath, r, 'r');
  validateNumericChannel(field.keyPath, g, 'g');
  validateNumericChannel(field.keyPath, b, 'b');

  return {
    r,
    g,
    b,
  };
}

function validateNumericChannel(
  objectKeyPath: string,
  field: ConfigFieldDescriptor,
  channel: RgbChannel
) {
  if (field.component !== 'integer' && field.component !== 'number') {
    throw new Error(
      `Custom renderer "color-picker" for field "${objectKeyPath}" requires numeric "${channel}" channel.`
    );
  }
}

function resolveRgbValue(
  field: ConfigFieldDescriptor,
  channels: ChannelDescriptor,
  value: unknown
): RgbColor {
  const defaults = resolveObjectInitialValue(field);
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? { ...defaults, ...(value as Record<string, unknown>) }
      : defaults;

  const rKey = getLeafKey(channels.r.keyPath);
  const gKey = getLeafKey(channels.g.keyPath);
  const bKey = getLeafKey(channels.b.keyPath);

  return {
    r: resolveChannelValue('r', field.keyPath, source[rKey]),
    g: resolveChannelValue('g', field.keyPath, source[gKey]),
    b: resolveChannelValue('b', field.keyPath, source[bKey]),
  };
}

function resolveChannelValue(
  channel: RgbChannel,
  objectKeyPath: string,
  sourceValue: unknown
): number {
  if (typeof sourceValue === 'number' && Number.isFinite(sourceValue)) {
    return normalizeChannel(sourceValue);
  }

  throw new Error(
    `Custom renderer "color-picker" for field "${objectKeyPath}" is missing initial value for channel "${channel}".`
  );
}

function normalizeChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function mergeRgbValue(
  value: unknown,
  channels: ChannelDescriptor,
  rgb: RgbColor
): Record<string, unknown> {
  const next =
    value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {};

  next[getLeafKey(channels.r.keyPath)] = rgb.r;
  next[getLeafKey(channels.g.keyPath)] = rgb.g;
  next[getLeafKey(channels.b.keyPath)] = rgb.b;

  return next;
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
