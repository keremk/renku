import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import { Check, Pause, Play, Search } from 'lucide-react';
import { PropertyRow } from '../../shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ResetOverrideButton } from './reset-override-button';
import type { CustomFieldEditorProps } from './types';
import type { VoiceOption } from '@/types/blueprint-graph';
import { parseVoiceIdCustomConfig } from './voice-id-config';

export function VoiceIdEditor({
  field,
  rowName,
  description,
  effectiveValue,
  isEditable,
  canResetMappedOverride,
  onChange,
  onReset,
}: CustomFieldEditorProps) {
  if (field.component !== 'string' && field.component !== 'string-enum') {
    throw new Error(
      `Custom renderer "voice-id-selector" requires string component for field "${field.keyPath}".`
    );
  }

  const config = useMemo(() => parseVoiceIdCustomConfig(field), [field]);
  const valueText = typeof effectiveValue === 'string' ? effectiveValue : '';

  const showRichPicker = Boolean(config.optionsFile);
  const showSimplePicker = !showRichPicker && config.options.length > 0;

  return (
    <PropertyRow
      name={rowName}
      type={field.component}
      description={description}
      required={field.required}
    >
      <div className='space-y-2'>
        <div className='flex min-w-0 items-center gap-2'>
          {showRichPicker && (
            <RichVoicePickerButton
              options={config.optionsRich}
              value={valueText}
              isEditable={isEditable}
              onSelect={onChange}
            />
          )}

          {showSimplePicker && (
            <SimpleVoicePicker
              options={config.options}
              value={valueText}
              isEditable={isEditable}
              onSelect={onChange}
            />
          )}

          <Input
            type='text'
            value={valueText}
            disabled={!isEditable}
            onChange={(event) => onChange(event.target.value || undefined)}
            className='h-7 min-w-0 flex-1 text-xs font-mono'
            aria-label={`${field.keyPath} voice id`}
          />
        </div>

        {canResetMappedOverride && <ResetOverrideButton onReset={onReset} />}
      </div>
    </PropertyRow>
  );
}

function SimpleVoicePicker(args: {
  options: VoiceOption[];
  value: string;
  isEditable: boolean;
  onSelect: (value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedValue = args.options.some(
    (option) => option.value === args.value
  )
    ? args.value
    : '';

  return (
    <Select
      open={open}
      value={selectedValue}
      disabled={!args.isEditable}
      onOpenChange={setOpen}
      onValueChange={(value) => {
        args.onSelect(value);
        setOpen(false);
      }}
    >
      <SelectTrigger
        className='h-7 min-w-40 max-w-52 text-xs'
        onClick={() => setOpen(true)}
      >
        <SelectValue placeholder='Pick voice' />
      </SelectTrigger>
      <SelectContent>
        {args.options.map((option) => (
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
  );
}

function RichVoicePickerButton(args: {
  options: VoiceOption[];
  value: string;
  isEditable: boolean;
  onSelect: (value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const selectedOption = useMemo(
    () => args.options.find((option) => option.value === args.value),
    [args.options, args.value]
  );

  const filteredOptions = useMemo(() => {
    const queryTokens = tokenizeSearchText(query);
    if (queryTokens.length === 0) {
      return args.options;
    }

    return args.options.filter((option) =>
      matchesVoiceOptionQuery(option, queryTokens)
    );
  }, [args.options, query]);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setPlayingId(null);
  }, []);

  useEffect(() => {
    return () => {
      stopPreview();
    };
  }, [stopPreview]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      stopPreview();
      setQuery('');
    }
  }, [stopPreview]);

  const chooseVoice = (option: VoiceOption) => {
    args.onSelect(option.value);
    handleOpenChange(false);
    stopPreview();
  };

  const togglePreview = async (
    option: VoiceOption,
    event: MouseEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();

    if (!option.preview_url) {
      return;
    }

    if (playingId === option.value) {
      stopPreview();
      return;
    }

    stopPreview();
    const audio = new Audio(option.preview_url);
    audioRef.current = audio;
    audio.addEventListener(
      'ended',
      () => {
        if (audioRef.current === audio) {
          audioRef.current = null;
          setPlayingId((current) =>
            current === option.value ? null : current
          );
        }
      },
      { once: true }
    );

    try {
      await audio.play();
      setPlayingId(option.value);
    } catch {
      stopPreview();
    }
  };

  return (
    <>
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={!args.isEditable}
        className='h-7 shrink-0 px-2 text-xs'
        onClick={() => setOpen(true)}
        aria-label='Pick voice'
      >
        {selectedOption ? 'Change Voice' : 'Pick Voice'}
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className='sm:max-w-[760px] p-0 gap-0 overflow-hidden'>
          <DialogHeader className='px-5 py-4'>
            <DialogTitle className='text-sm normal-case tracking-normal'>
              Pick Voice
            </DialogTitle>
            <DialogDescription>
              Search by tone, tagline, or description and preview samples before
              selecting a voice.
            </DialogDescription>
          </DialogHeader>

          <div className='border-b border-border/50 px-5 py-3'>
            <div className='relative'>
              <Search className='pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
              <Input
                type='text'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className='h-9 pl-8 text-sm'
                placeholder='Search voices (e.g. woman, energetic, storyteller)'
                aria-label='Search voices'
              />
            </div>
          </div>

          <div className='max-h-112 overflow-y-auto px-3 py-3'>
            {filteredOptions.length === 0 ? (
              <p className='px-2 py-6 text-center text-sm text-muted-foreground'>
                No voices match that search.
              </p>
            ) : (
              <div className='space-y-1.5'>
                {filteredOptions.map((option) => {
                  const isSelected = args.value === option.value;
                  const isPlaying = playingId === option.value;
                  const subtitle = option.tagline
                    ? `${option.label} - ${option.tagline}`
                    : option.label;

                  return (
                    <div
                      key={option.value}
                      className={cn(
                        'group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                        isSelected
                          ? 'border-primary/70 bg-primary/10'
                          : 'border-border/50 hover:border-border hover:bg-muted/40'
                      )}
                    >
                      <button
                        type='button'
                        className='min-w-0 flex-1 text-left'
                        onClick={() => chooseVoice(option)}
                      >
                        <p className='truncate text-sm font-medium text-foreground'>
                          {subtitle}
                        </p>
                        {option.description && (
                          <p className='mt-0.5 line-clamp-2 text-xs text-muted-foreground'>
                            {option.description}
                          </p>
                        )}
                        <p className='mt-1 truncate font-mono text-[10px] text-muted-foreground'>
                          {option.value}
                        </p>
                      </button>

                      <div className='flex shrink-0 items-center gap-1'>
                        {option.preview_url && (
                          <button
                            type='button'
                            className='inline-flex h-7 w-7 items-center justify-center rounded-md border border-border/60 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                            onClick={(event) => {
                              void togglePreview(option, event);
                            }}
                            aria-label={`${isPlaying ? 'Pause' : 'Play'} preview for ${option.label}`}
                          >
                            {isPlaying ? (
                              <Pause className='size-3.5' />
                            ) : (
                              <Play className='size-3.5' />
                            )}
                          </button>
                        )}
                        {isSelected && (
                          <span className='inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary/15 text-primary'>
                            <Check className='size-3.5' />
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function tokenizeSearchText(value: string): string[] {
  return value
    .toLowerCase()
    .trim()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 0);
}

function matchesVoiceOptionQuery(
  option: VoiceOption,
  queryTokens: string[]
): boolean {
  const searchableTokens = tokenizeSearchText(
    `${option.label} ${option.value} ${option.tagline ?? ''} ${option.description ?? ''}`
  );

  return queryTokens.every((queryToken) =>
    searchableTokens.some((searchToken) => searchToken.startsWith(queryToken))
  );
}
