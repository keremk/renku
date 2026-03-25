import { useState } from 'react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { InputEditorProps } from './input-registry';
import {
  ASPECT_CUSTOM_KEY,
  buildDimensionOptions,
  getAspectMode,
  getPresetByKey,
  inferPresetKey,
  parsePositiveInteger,
  resolutionFromHeightSelection,
  resolutionFromPreset,
  resolutionFromWidthSelection,
  sanitizeNumericInput,
  type RatioPreset,
  type ResolutionValue,
} from './resolution-editor-utils';

const DEFAULT_RESOLUTION: ResolutionValue = {
  width: 1280,
  height: 720,
};

const COMMON_WIDTH_OPTIONS = [
  480, 640, 720, 768, 960, 1080, 1280, 1440, 1920, 2560, 3840,
];

const COMMON_HEIGHT_OPTIONS = [
  480, 640, 720, 768, 960, 1080, 1280, 1440, 1920, 2560, 3840,
];

const ASPECT_RATIO_SELECT_WIDTH_CLASS = 'w-[140px]';
const DIMENSION_CONTROL_WIDTH_CLASS = 'w-[72px] min-w-[72px] max-w-[72px]';

const RATIO_PRESETS: RatioPreset[] = [
  {
    key: 'landscape-16-9',
    label: 'Landscape 16:9',
    width: 16,
    height: 9,
    defaultWidth: 1280,
    defaultHeight: 720,
  },
  {
    key: 'landscape-4-3',
    label: 'Landscape 4:3',
    width: 4,
    height: 3,
    defaultWidth: 1440,
    defaultHeight: 1080,
  },
  {
    key: 'square-1-1',
    label: 'Square 1:1',
    width: 1,
    height: 1,
    defaultWidth: 1080,
    defaultHeight: 1080,
  },
  {
    key: 'portrait-3-4',
    label: 'Portrait 3:4',
    width: 3,
    height: 4,
    defaultWidth: 1080,
    defaultHeight: 1440,
  },
  {
    key: 'portrait-9-16',
    label: 'Portrait 9:16',
    width: 9,
    height: 16,
    defaultWidth: 1080,
    defaultHeight: 1920,
  },
  {
    key: 'landscape-21-9',
    label: 'Landscape 21:9',
    width: 21,
    height: 9,
    defaultWidth: 1680,
    defaultHeight: 720,
  },
];

function isResolutionValue(value: unknown): value is ResolutionValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.width === 'number' &&
    Number.isInteger(record.width) &&
    record.width > 0 &&
    typeof record.height === 'number' &&
    Number.isInteger(record.height) &&
    record.height > 0
  );
}

export function ResolutionEditor({
  value,
  onChange,
  isEditable,
}: InputEditorProps) {
  const resolution = isResolutionValue(value) ? value : undefined;
  const currentResolution = resolution ?? DEFAULT_RESOLUTION;
  const [selectedPresetKey, setSelectedPresetKey] = useState(() =>
    inferPresetKey(
      currentResolution.width,
      currentResolution.height,
      RATIO_PRESETS
    )
  );

  const selectedPreset = getPresetByKey(selectedPresetKey, RATIO_PRESETS);
  const aspectMode = getAspectMode(selectedPresetKey, RATIO_PRESETS);

  const widthOptions = buildDimensionOptions(
    COMMON_WIDTH_OPTIONS,
    currentResolution.width
  );
  const heightOptions = buildDimensionOptions(
    COMMON_HEIGHT_OPTIONS,
    currentResolution.height
  );

  if (!isEditable) {
    if (!resolution) {
      return (
        <span className='text-xs text-muted-foreground/60 italic'>
          not provided
        </span>
      );
    }

    return (
      <div className='text-xs text-foreground font-mono bg-muted/70 px-2 py-1 rounded border border-border/50'>
        {`${resolution.width} x ${resolution.height}`}
      </div>
    );
  }

  const handlePresetChange = (nextKey: string) => {
    setSelectedPresetKey(nextKey);
    if (nextKey === ASPECT_CUSTOM_KEY) {
      return;
    }

    const nextResolution = resolutionFromPreset(
      nextKey,
      currentResolution,
      RATIO_PRESETS
    );
    onChange(nextResolution);
  };

  const handleWidthSelect = (rawWidth: string) => {
    const nextWidth = parsePositiveInteger(rawWidth);
    if (
      !nextWidth ||
      !selectedPreset ||
      aspectMode === 'portrait' ||
      aspectMode === 'custom'
    ) {
      return;
    }

    const nextResolution = resolutionFromWidthSelection(
      selectedPreset,
      aspectMode,
      nextWidth
    );
    onChange(nextResolution);
  };

  const handleHeightSelect = (rawHeight: string) => {
    const nextHeight = parsePositiveInteger(rawHeight);
    if (
      !nextHeight ||
      !selectedPreset ||
      aspectMode === 'landscape' ||
      aspectMode === 'custom'
    ) {
      return;
    }

    const nextResolution = resolutionFromHeightSelection(
      selectedPreset,
      aspectMode,
      nextHeight
    );
    onChange(nextResolution);
  };

  const commitCustomWidth = (rawWidth: string): boolean => {
    const nextWidth = parsePositiveInteger(rawWidth.trim());
    if (!nextWidth) {
      return false;
    }

    onChange({
      width: nextWidth,
      height: currentResolution.height,
    });
    return true;
  };

  const commitCustomHeight = (rawHeight: string): boolean => {
    const nextHeight = parsePositiveInteger(rawHeight.trim());
    if (!nextHeight) {
      return false;
    }

    onChange({
      width: currentResolution.width,
      height: nextHeight,
    });
    return true;
  };

  return (
    <div className='space-y-2 min-w-0'>
      <div className='flex items-center gap-1.5 min-w-0'>
        <Select value={selectedPresetKey} onValueChange={handlePresetChange}>
          <SelectTrigger
            aria-label='Aspect ratio'
            className={`h-9 ${ASPECT_RATIO_SELECT_WIDTH_CLASS} text-xs bg-background/90`}
          >
            <SelectValue placeholder='Aspect ratio' />
          </SelectTrigger>
          <SelectContent>
            {RATIO_PRESETS.map((preset) => (
              <SelectItem
                key={preset.key}
                value={preset.key}
                className='text-xs'
              >
                {preset.label}
              </SelectItem>
            ))}
            <SelectItem value={ASPECT_CUSTOM_KEY} className='text-xs'>
              Custom
            </SelectItem>
          </SelectContent>
        </Select>

        {aspectMode === 'custom' ? (
          <DimensionInput
            key={`resolution-width-${currentResolution.width}`}
            ariaLabel='Resolution width'
            defaultValue={String(currentResolution.width)}
            onCommit={commitCustomWidth}
          />
        ) : aspectMode === 'portrait' ? (
          <DimensionValue
            ariaLabel='Resolution width value'
            value={currentResolution.width}
            testId='resolution-width-value'
          />
        ) : (
          <DimensionSelect
            ariaLabel='Resolution width'
            value={currentResolution.width}
            options={widthOptions}
            onValueSelect={handleWidthSelect}
          />
        )}

        <span className='w-2 text-center text-xs font-mono text-muted-foreground select-none'>
          x
        </span>

        {aspectMode === 'custom' ? (
          <DimensionInput
            key={`resolution-height-${currentResolution.height}`}
            ariaLabel='Resolution height'
            defaultValue={String(currentResolution.height)}
            onCommit={commitCustomHeight}
          />
        ) : aspectMode === 'landscape' ? (
          <DimensionValue
            ariaLabel='Resolution height value'
            value={currentResolution.height}
            testId='resolution-height-value'
          />
        ) : (
          <DimensionSelect
            ariaLabel='Resolution height'
            value={currentResolution.height}
            options={heightOptions}
            onValueSelect={handleHeightSelect}
          />
        )}
      </div>
    </div>
  );
}

interface DimensionInputProps {
  ariaLabel: string;
  defaultValue: string;
  onCommit: (value: string) => boolean;
}

function DimensionInput({
  ariaLabel,
  defaultValue,
  onCommit,
}: DimensionInputProps) {
  const [draftValue, setDraftValue] = useState(defaultValue);

  return (
    <Input
      type='text'
      inputMode='numeric'
      pattern='[0-9]*'
      value={draftValue}
      onChange={(event) =>
        setDraftValue(sanitizeNumericInput(event.target.value))
      }
      onBlur={() => {
        const ok = onCommit(draftValue);
        if (!ok) {
          setDraftValue(defaultValue);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.currentTarget.blur();
        }
      }}
      className={`h-9 ${DIMENSION_CONTROL_WIDTH_CLASS} px-2 text-xs font-mono bg-background/90`}
      aria-label={ariaLabel}
    />
  );
}

interface DimensionSelectProps {
  ariaLabel: string;
  value: number;
  options: number[];
  onValueSelect: (value: string) => void;
}

function DimensionSelect({
  ariaLabel,
  value,
  options,
  onValueSelect,
}: DimensionSelectProps) {
  return (
    <Select value={String(value)} onValueChange={onValueSelect}>
      <SelectTrigger
        aria-label={ariaLabel}
        className={`h-9 ${DIMENSION_CONTROL_WIDTH_CLASS} px-2 text-xs font-mono bg-background/90`}
      >
        <SelectValue placeholder='Select size' />
      </SelectTrigger>
      <SelectContent align='end'>
        {options.map((option) => (
          <SelectItem
            key={option}
            value={String(option)}
            className='text-xs font-mono'
          >
            {option}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DimensionValue({
  ariaLabel,
  value,
  testId,
}: {
  ariaLabel: string;
  value: number;
  testId: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      data-testid={testId}
      className={`h-9 ${DIMENSION_CONTROL_WIDTH_CLASS} px-2 text-xs font-mono bg-background/60 border border-border/60 rounded-md flex items-center justify-center text-muted-foreground`}
    >
      {value}
    </div>
  );
}
