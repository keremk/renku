import { useState, useCallback, useMemo, useEffect } from 'react';
import { Type, Palette, Layout } from 'lucide-react';
import { Sketch } from '@uiw/react-color';

import { MediaCard } from '../../shared/media-card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { ConfigEditorProps } from './index';

export type OverlayPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'middle-center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface TextConfig {
  font?: string;
  fontSize?: number;
  fontBaseColor?: string;
  backgroundColor?: string;
  backgroundOpacity?: number;
  position?: OverlayPosition;
  edgePaddingPercent?: number;
}

const TEXT_DEFAULTS: Required<TextConfig> = {
  font: 'Arial',
  fontSize: 56,
  fontBaseColor: '#FFFFFF',
  backgroundColor: '#000000',
  backgroundOpacity: 0.35,
  position: 'middle-center',
  edgePaddingPercent: 8,
};

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

export type TextCardProps = ConfigEditorProps<TextConfig>;

export function TextCard({
  value,
  isEditable = false,
  isSelected = false,
  onChange,
}: TextCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const config = useMemo(() => {
    return { ...TEXT_DEFAULTS, ...value };
  }, [value]);

  useEffect(() => {
    if (value === undefined && isEditable && onChange) {
      onChange(TEXT_DEFAULTS);
    }
  }, [value, isEditable, onChange]);

  const handleSave = useCallback(
    (newConfig: TextConfig) => {
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
          <TextCardFooter
            onEdit={isEditable ? () => setDialogOpen(true) : undefined}
          />
        }
      >
        <TextPreview config={config} />
      </MediaCard>

      <TextEditDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        config={config}
        onSave={isEditable ? handleSave : undefined}
        readOnly={!isEditable}
      />
    </>
  );
}

interface TextPreviewProps {
  config: Required<TextConfig>;
}

function TextPreview({ config }: TextPreviewProps) {
  return (
    <div className='bg-muted/30 p-4 space-y-3 min-h-[200px]'>
      <div className='space-y-2'>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Palette className='size-3' />
          <span>Colors</span>
        </div>
        <div className='flex gap-2 flex-wrap'>
          <ColorSwatch label='Text' color={config.fontBaseColor} />
          <ColorSwatch
            label='Background'
            color={config.backgroundColor}
            opacity={config.backgroundOpacity}
          />
        </div>
      </div>

      <div className='space-y-1'>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Type className='size-3' />
          <span>Font</span>
        </div>
        <div className='text-xs text-foreground'>
          {config.font} &middot; {config.fontSize}px
        </div>
      </div>

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
    </div>
  );
}

interface ColorSwatchProps {
  label: string;
  color: string;
  opacity?: number;
}

function ColorSwatch({ label, color, opacity }: ColorSwatchProps) {
  const displayOpacity = opacity !== undefined ? opacity : 1;
  const hexDisplay = color.toUpperCase();

  return (
    <div className='flex items-center gap-1.5 bg-muted/50 rounded px-2 py-1'>
      <div
        className='size-4 rounded border border-border/50'
        style={{
          backgroundColor: color,
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

interface TextCardFooterProps {
  onEdit?: () => void;
}

function TextCardFooter({ onEdit }: TextCardFooterProps) {
  return (
    <>
      <div className='flex items-center gap-2 flex-1 min-w-0'>
        <Type className='size-4 text-muted-foreground' />
        <span className='text-xs text-foreground truncate'>Text Overlay</span>
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

interface TextEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: Required<TextConfig>;
  onSave?: (config: TextConfig) => void;
  readOnly?: boolean;
}

function TextEditDialog({
  open,
  onOpenChange,
  config,
  onSave,
  readOnly = false,
}: TextEditDialogProps) {
  const [formState, setFormState] = useState<Required<TextConfig>>(config);

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
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
    <K extends keyof TextConfig>(key: K, value: TextConfig[K]) => {
      setFormState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Type className='size-5' />
            {readOnly ? 'Text Overlay Settings' : 'Edit Text Overlay Settings'}
          </DialogTitle>
        </DialogHeader>

        <div className='space-y-6 py-4'>
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
                    updateField('fontSize', parseInt(e.target.value) || 56)
                  }
                  disabled={readOnly}
                  className='h-8 text-xs'
                  min={12}
                  max={200}
                />
              </FormRow>
            </div>
          </FormSection>

          <FormSection icon={Palette} label='Colors'>
            <div className='grid grid-cols-2 gap-4'>
              <FormRow label='Text Color'>
                <ColorPickerRow
                  value={formState.fontBaseColor}
                  onChange={(v) => updateField('fontBaseColor', v)}
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
                      Math.min(1, Math.max(0, parseFloat(e.target.value) || 0))
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
                      parseInt(e.target.value) || 8
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

function formatPositionLabel(value: OverlayPosition): string {
  return value
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
