/**
 * SubtitlesCard - Specialized editor for subtitle configuration.
 *
 * Displays subtitle settings in a card format with preview and edit dialog.
 * Uses @uiw/react-color Sketch picker for color selection.
 */

import { useState, useCallback, useMemo } from 'react';
import { Subtitles, Type, Palette, Layout, Sparkles } from 'lucide-react';
import { Sketch } from '@uiw/react-color';

import { MediaCard } from '../../shared/media-card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ConfigEditorProps } from './index';
import { resolveObjectDefaults } from './schema-defaults';

/**
 * Subtitle configuration structure (matches SubtitleConfig from providers).
 */
export interface SubtitleConfig {
  font?: string;
  fontSize?: number;
  fontBaseColor?: string;
  fontHighlightColor?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  position?: OverlayPosition;
  edgePaddingPercent?: number;
  maxWordsPerLine?: number;
  highlightEffect?: boolean;
}

type OverlayPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/**
 * Common fonts for subtitle display.
 */
const FONT_OPTIONS = [
  'Arial',
  'Helvetica',
  'Verdana',
  'Trebuchet MS',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Impact',
  'Comic Sans MS',
];

const POSITION_OPTIONS: Array<{ value: OverlayPosition; label: string }> = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-center', label: 'Top Center' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'middle-left', label: 'Middle Left' },
  { value: 'middle-center', label: 'Middle Center' },
  { value: 'middle-right', label: 'Middle Right' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-center', label: 'Bottom Center' },
  { value: 'bottom-right', label: 'Bottom Right' },
];

const FALLBACK_SUBTITLE_CONFIG: Required<SubtitleConfig> = {
  font: 'Arial',
  fontSize: 48,
  fontBaseColor: '#FFFFFF',
  fontHighlightColor: '#FFD700',
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  position: 'bottom-center',
  edgePaddingPercent: 8,
  maxWordsPerLine: 4,
  highlightEffect: true,
};

export type SubtitlesCardProps = ConfigEditorProps<SubtitleConfig>;

/**
 * Card component for editing subtitle configuration.
 */
export function SubtitlesCard({
  value,
  schema,
  isEditable = false,
  isSelected = false,
  onChange,
}: SubtitlesCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const defaultConfig = useMemo(
    () => resolveObjectDefaults<Required<SubtitleConfig>>(schema),
    [schema]
  );

  const config = useMemo(() => {
    return {
      ...FALLBACK_SUBTITLE_CONFIG,
      ...defaultConfig,
      ...value,
    };
  }, [defaultConfig, value]);

  const handleSave = useCallback(
    (newConfig: SubtitleConfig) => {
      onChange?.(newConfig);
      setDialogOpen(false);
    },
    [onChange]
  );

  return (
    <>
      <MediaCard
        isSelected={isSelected}
        onClick={() => setDialogOpen(true)}
        footer={
          <SubtitlesCardFooter
            onEdit={isEditable ? () => setDialogOpen(true) : undefined}
          />
        }
      >
        <SubtitlesPreview config={config} />
      </MediaCard>

      <SubtitlesEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        config={config}
        onSave={isEditable ? handleSave : undefined}
        readOnly={!isEditable}
      />
    </>
  );
}

// ============================================================================
// Preview Component
// ============================================================================

interface SubtitlesPreviewProps {
  config: Required<SubtitleConfig>;
}

function SubtitlesPreview({ config }: SubtitlesPreviewProps) {
  return (
    <div className='bg-muted/30 p-4 space-y-3 min-h-[200px]'>
      {/* Colors section */}
      <div className='space-y-2'>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Palette className='size-3' />
          <span>Colors</span>
        </div>
        <div className='flex gap-2 flex-wrap'>
          <ColorSwatch label='Text' color={config.fontBaseColor} />
          <ColorSwatch label='Highlight' color={config.fontHighlightColor} />
          <ColorSwatch
            label='Background'
            color={config.backgroundColor}
            opacity={config.backgroundOpacity}
          />
        </div>
      </div>

      {/* Font section */}
      <div className='space-y-1'>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Type className='size-3' />
          <span>Font</span>
        </div>
        <div className='text-xs text-foreground'>
          {config.font} &middot; {config.fontSize}px
        </div>
      </div>

      {/* Layout section */}
      <div className='space-y-1'>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Layout className='size-3' />
          <span>Layout</span>
        </div>
        <div className='text-xs text-foreground'>
          {formatPositionLabel(config.position)} &middot; Edge Padding{' '}
          {config.edgePaddingPercent}%
        </div>
      </div>

      {/* Effects section */}
      <div className='space-y-1'>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Sparkles className='size-3' />
          <span>Effects</span>
        </div>
        <div className='text-xs text-foreground'>
          Karaoke highlighting:{' '}
          <span
            className={
              config.highlightEffect
                ? 'text-green-500'
                : 'text-muted-foreground'
            }
          >
            {config.highlightEffect ? 'On' : 'Off'}
          </span>{' '}
          · Max {config.maxWordsPerLine} words/line
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Color Swatch Component
// ============================================================================

interface ColorSwatchProps {
  label: string;
  color?: string;
  opacity?: number;
}

function ColorSwatch({ label, color, opacity }: ColorSwatchProps) {
  const displayOpacity = opacity ?? 1;
  const swatchColor =
    typeof color === 'string' && color.length > 0 ? color : '#000000';
  const hexDisplay =
    typeof color === 'string' && color.length > 0 ? color.toUpperCase() : 'N/A';

  return (
    <div className='flex items-center gap-1.5 bg-muted/50 rounded px-2 py-1'>
      <div
        className='size-4 rounded border border-border/50'
        style={{
          backgroundColor: swatchColor,
          opacity: displayOpacity,
        }}
      />
      <div className='text-xs'>
        <span className='text-muted-foreground'>{label}: </span>
        <span className='text-foreground font-mono'>{hexDisplay}</span>
        {opacity !== undefined && opacity < 1 && (
          <span className='text-muted-foreground ml-1'>
            ({Math.round(opacity * 100)}%)
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Footer Component
// ============================================================================

interface SubtitlesCardFooterProps {
  onEdit?: () => void;
}

function SubtitlesCardFooter({ onEdit }: SubtitlesCardFooterProps) {
  return (
    <>
      <div className='flex items-center gap-2 flex-1 min-w-0'>
        <Subtitles className='size-4 text-muted-foreground' />
        <span className='text-xs text-foreground truncate'>Subtitles</span>
      </div>
      {onEdit && (
        <button
          type='button'
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className='text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted'
        >
          Edit
        </button>
      )}
    </>
  );
}

// ============================================================================
// Edit Dialog
// ============================================================================

interface SubtitlesEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: Required<SubtitleConfig>;
  onSave?: (config: SubtitleConfig) => void;
  readOnly?: boolean;
}

function SubtitlesEditDialog({
  open,
  onOpenChange,
  config,
  onSave,
  readOnly = false,
}: SubtitlesEditDialogProps) {
  // Local form state - initialized from config
  const [formState, setFormState] = useState<Required<SubtitleConfig>>(config);

  // Handle dialog open/close, reset form state when opening
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        // Reset form state to current config when dialog opens
        setFormState(config);
      }
      onOpenChange(isOpen);
    },
    [config, onOpenChange]
  );

  const handleSave = useCallback(() => {
    onSave?.(formState);
  }, [formState, onSave]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const updateField = useCallback(
    <K extends keyof SubtitleConfig>(key: K, value: SubtitleConfig[K]) => {
      setFormState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Subtitles className='size-5' />
            {readOnly ? 'Subtitle Settings' : 'Edit Subtitle Settings'}
          </DialogTitle>
          <DialogDescription className='sr-only'>
            {readOnly
              ? 'Review subtitle font, color, layout, and effect settings.'
              : 'Configure subtitle font, color, layout, and effect settings.'}
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-6 py-4'>
          {/* Font Section */}
          <FormSection icon={Type} label='Font'>
            <div className='grid grid-cols-2 gap-4'>
              <FormRow label='Family'>
                <Select
                  value={formState.font}
                  onValueChange={(v) => updateField('font', v)}
                  disabled={readOnly}
                >
                  <SelectTrigger className='h-8 text-xs'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FONT_OPTIONS.map((font) => (
                      <SelectItem key={font} value={font} className='text-xs'>
                        {font}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
              <FormRow label='Size (px)'>
                <Input
                  type='number'
                  value={formState.fontSize}
                  onChange={(e) =>
                    updateField(
                      'fontSize',
                      parseInt(e.target.value) || config.fontSize
                    )
                  }
                  disabled={readOnly}
                  className='h-8 text-xs'
                  min={12}
                  max={200}
                />
              </FormRow>
            </div>
          </FormSection>

          {/* Colors Section */}
          <FormSection icon={Palette} label='Colors'>
            <div className='grid grid-cols-2 gap-4'>
              <FormRow label='Text Color'>
                <ColorPickerRow
                  value={formState.fontBaseColor}
                  onChange={(v) => updateField('fontBaseColor', v)}
                  disabled={readOnly}
                />
              </FormRow>
              <FormRow label='Highlight Color'>
                <ColorPickerRow
                  value={formState.fontHighlightColor}
                  onChange={(v) => updateField('fontHighlightColor', v)}
                  disabled={readOnly}
                />
              </FormRow>
              <FormRow label='Background Color'>
                <ColorPickerRow
                  value={formState.backgroundColor}
                  onChange={(v) => updateField('backgroundColor', v)}
                  disabled={readOnly}
                />
              </FormRow>
              <FormRow label='Background Opacity'>
                <Input
                  type='number'
                  value={formState.backgroundOpacity}
                  onChange={(e) =>
                    updateField(
                      'backgroundOpacity',
                      Math.min(
                        1,
                        Math.max(
                          0,
                          parseFloat(e.target.value) || config.backgroundOpacity
                        )
                      )
                    )
                  }
                  disabled={readOnly}
                  className='h-8 text-xs'
                  min={0}
                  max={1}
                  step={0.1}
                />
              </FormRow>
            </div>
          </FormSection>

          {/* Layout Section */}
          <FormSection icon={Layout} label='Layout'>
            <div className='grid grid-cols-2 gap-4'>
              <FormRow label='Position'>
                <Select
                  value={formState.position}
                  onValueChange={(v) =>
                    updateField('position', v as OverlayPosition)
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className='h-8 text-xs'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {POSITION_OPTIONS.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        className='text-xs'
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
              <FormRow label='Edge Padding (%)'>
                <Input
                  type='number'
                  value={formState.edgePaddingPercent}
                  onChange={(e) =>
                    updateField(
                      'edgePaddingPercent',
                      parseInt(e.target.value) || config.edgePaddingPercent
                    )
                  }
                  disabled={readOnly}
                  className='h-8 text-xs'
                  min={0}
                  max={50}
                />
              </FormRow>
            </div>
          </FormSection>

          {/* Effects Section */}
          <FormSection icon={Sparkles} label='Effects'>
            <div className='grid grid-cols-2 gap-4'>
              <FormRow label='Max Words/Line'>
                <Input
                  type='number'
                  value={formState.maxWordsPerLine}
                  onChange={(e) =>
                    updateField(
                      'maxWordsPerLine',
                      parseInt(e.target.value) || config.maxWordsPerLine
                    )
                  }
                  disabled={readOnly}
                  className='h-8 text-xs'
                  min={1}
                  max={20}
                />
              </FormRow>
              <div className='space-y-1.5'>
                <label className='text-xs text-muted-foreground'>Karaoke</label>
                <div className='h-8 rounded-md border border-border/50 px-3 flex items-center justify-between'>
                  <span className='text-xs text-foreground'>Highlighting</span>
                  <Switch
                    checked={formState.highlightEffect}
                    onCheckedChange={(v) => updateField('highlightEffect', v)}
                    disabled={readOnly}
                    size='sm'
                  />
                </div>
              </div>
            </div>
          </FormSection>
        </div>

        <DialogFooter>
          {readOnly ? (
            <Button variant='outline' onClick={handleCancel}>
              Close
            </Button>
          ) : (
            <>
              <Button variant='outline' onClick={handleCancel}>
                Cancel
              </Button>
              <Button onClick={handleSave}>Save</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Form Helper Components
// ============================================================================

interface FormSectionProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}

function FormSection({ icon: Icon, label, children }: FormSectionProps) {
  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2 text-sm font-medium text-foreground'>
        <Icon className='size-4' />
        {label}
      </div>
      {children}
    </div>
  );
}

interface FormRowProps {
  label: string;
  children: React.ReactNode;
}

function FormRow({ label, children }: FormRowProps) {
  return (
    <div className='space-y-1.5'>
      <label className='text-xs text-muted-foreground'>{label}</label>
      {children}
    </div>
  );
}

// ============================================================================
// Color Picker Row
// ============================================================================

interface ColorPickerRowProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function ColorPickerRow({ value, onChange, disabled }: ColorPickerRowProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);

  return (
    <div className='flex items-center gap-2'>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type='button'
            disabled={disabled}
            className={cn(
              'size-8 rounded border border-input transition-all',
              disabled
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:ring-2 hover:ring-ring/50'
            )}
            style={{ backgroundColor: value }}
            aria-label='Pick color'
          />
        </PopoverTrigger>
        <PopoverContent className='w-auto p-0' align='start'>
          <Sketch color={value} onChange={(color) => onChange(color.hex)} />
        </PopoverContent>
      </Popover>
      <span className='text-xs font-mono text-muted-foreground'>
        {value.toUpperCase()}
      </span>
    </div>
  );
}

function formatPositionLabel(value: OverlayPosition | undefined): string {
  if (!value) {
    return 'Unspecified';
  }
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
