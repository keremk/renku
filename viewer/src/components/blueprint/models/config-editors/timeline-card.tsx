/**
 * TimelineCard - Specialized editor for timeline composition configuration.
 *
 * Displays timeline settings in a card format with preview and edit dialog.
 * Follows the same pattern as SubtitlesCard.
 */

import { useState, useCallback, useMemo } from 'react';
import { Film, Layers, Volume2, Crown } from 'lucide-react';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { ConfigEditorProps } from './index';
import { resolveObjectDefaults } from './schema-defaults';

// ============================================================================
// Types
// ============================================================================

type TrackKind =
  | 'Image'
  | 'Video'
  | 'Audio'
  | 'Music'
  | 'Transcription'
  | 'Text';

interface ClipConfig {
  artifact: string;
  volume?: number;
  effect?: string;
  playStrategy?: string;
}

export interface TimelineConfig {
  tracks?: TrackKind[];
  masterTracks?: TrackKind[];
  imageClip?: ClipConfig;
  videoClip?: ClipConfig;
  audioClip?: ClipConfig;
  musicClip?: ClipConfig;
  transcriptionClip?: ClipConfig;
  textClip?: ClipConfig;
}

// ============================================================================
// Constants
// ============================================================================

const ALL_TRACK_KINDS: TrackKind[] = [
  'Image',
  'Video',
  'Audio',
  'Music',
  'Transcription',
  'Text',
];

const TRACKS_WITH_NATIVE_DURATION: TrackKind[] = ['Video', 'Audio', 'Music'];

const TRACKS_WITH_VOLUME: TrackKind[] = ['Video', 'Audio', 'Music'];

const TRACKS_WITH_EFFECT: TrackKind[] = ['Image', 'Text'];

const TRACK_TO_ARTIFACT: Record<TrackKind, string> = {
  Image: 'ImageSegments',
  Video: 'VideoSegments',
  Audio: 'AudioSegments',
  Music: 'Music',
  Transcription: 'TranscriptionAudio',
  Text: 'TextSegments',
};

const TRACK_TO_CLIP_KEY: Record<TrackKind, keyof TimelineConfig> = {
  Image: 'imageClip',
  Video: 'videoClip',
  Audio: 'audioClip',
  Music: 'musicClip',
  Transcription: 'transcriptionClip',
  Text: 'textClip',
};

const TRACK_COLORS: Record<TrackKind, string> = {
  Image: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  Video: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  Audio: 'bg-green-500/20 text-green-300 border-green-500/30',
  Music: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  Transcription: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
  Text: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
};

const PLAY_STRATEGY_OPTIONS = [
  { value: 'loop', label: 'Loop' },
  { value: 'stopWhenFinished', label: 'Stop when finished' },
];

const IMAGE_EFFECT_OPTIONS = [{ value: 'KennBurns', label: 'Ken Burns' }];

const TEXT_EFFECT_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'fade-in-out', label: 'Fade In + Out' },
  { value: 'slide-in-out-left', label: 'Slide In + Out (Left)' },
  { value: 'slide-in-out-right', label: 'Slide In + Out (Right)' },
  { value: 'spring-in-out', label: 'Spring In + Out' },
];

type TimingRole = 'none' | 'primary' | 'fallback';

function getInitialSelectedTrack(config: TimelineConfig): TrackKind {
  const firstEnabledTrack = config.tracks?.[0];
  return firstEnabledTrack ?? ALL_TRACK_KINDS[0];
}

function getTimingRole(
  kind: TrackKind,
  masterTracks?: TrackKind[]
): TimingRole {
  if (masterTracks?.[0] === kind) return 'primary';
  if (masterTracks?.[1] === kind) return 'fallback';
  return 'none';
}

function createDefaultClip(kind: TrackKind): ClipConfig {
  const clip: ClipConfig = { artifact: TRACK_TO_ARTIFACT[kind] };

  if (kind === 'Video' || kind === 'Audio') {
    clip.volume = 1;
  }

  if (kind === 'Music') {
    clip.volume = 0.3;
    clip.playStrategy = 'loop';
  }

  if (kind === 'Image') {
    clip.effect = 'KennBurns';
  }

  if (kind === 'Text') {
    clip.effect = 'fade-in-out';
  }

  return clip;
}

// ============================================================================
// Main Component
// ============================================================================

export type TimelineCardProps = ConfigEditorProps<TimelineConfig>;

export function TimelineCard({
  value,
  schema,
  isEditable = false,
  isSelected = false,
  onChange,
}: TimelineCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const defaultConfig = useMemo(
    () => resolveObjectDefaults<TimelineConfig>(schema),
    [schema]
  );

  const config = useMemo(() => {
    return { ...defaultConfig, ...value };
  }, [defaultConfig, value]);

  const handleSave = useCallback(
    (newConfig: TimelineConfig) => {
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
          <TimelineCardFooter
            onEdit={isEditable ? () => setDialogOpen(true) : undefined}
          />
        }
      >
        <TimelinePreview config={config} />
      </MediaCard>

      <TimelineEditDialog
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

interface TimelinePreviewProps {
  config: TimelineConfig;
}

function TimelinePreview({ config }: TimelinePreviewProps) {
  const tracks = config.tracks ?? [];
  const masterTracks = config.masterTracks ?? [];

  // Collect volumes from clips that have them
  const volumes: { label: string; value: number }[] = [];
  for (const kind of tracks) {
    const clipKey = TRACK_TO_CLIP_KEY[kind];
    const clip = config[clipKey] as ClipConfig | undefined;
    if (clip?.volume !== undefined) {
      volumes.push({ label: kind, value: clip.volume });
    }
  }

  return (
    <div className='bg-muted/30 p-4 space-y-3 min-h-[200px]'>
      {/* Tracks row */}
      <div className='space-y-2'>
        <div className='flex items-center gap-2 text-xs text-muted-foreground'>
          <Layers className='size-3' />
          <span>Layers</span>
        </div>
        <div className='flex gap-1.5 flex-wrap'>
          {tracks.map((kind) => (
            <span
              key={kind}
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
                TRACK_COLORS[kind]
              )}
            >
              {kind}
              {masterTracks.includes(kind) && (
                <Crown className='size-2.5 opacity-70' />
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Volume row */}
      {volumes.length > 0 && (
        <div className='space-y-1'>
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            <Volume2 className='size-3' />
            <span>Volume</span>
          </div>
          <div className='text-xs text-foreground'>
            {volumes
              .map((v) => `${v.label}: ${Math.round(v.value * 100)}%`)
              .join(' / ')}
          </div>
        </div>
      )}

      {/* Master tracks info */}
      {masterTracks.length > 0 && (
        <div className='space-y-1'>
          <div className='flex items-center gap-2 text-xs text-muted-foreground'>
            <Crown className='size-3' />
            <span>Master</span>
          </div>
          <div className='text-xs text-foreground'>
            {masterTracks.join(' > ')}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Footer Component
// ============================================================================

interface TimelineCardFooterProps {
  onEdit?: () => void;
}

function TimelineCardFooter({ onEdit }: TimelineCardFooterProps) {
  return (
    <>
      <div className='flex items-center gap-2 flex-1 min-w-0'>
        <Film className='size-4 text-muted-foreground' />
        <span className='text-xs text-foreground truncate'>Timeline</span>
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

interface TimelineEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: TimelineConfig;
  onSave?: (config: TimelineConfig) => void;
  readOnly?: boolean;
}

function TimelineEditDialog({
  open,
  onOpenChange,
  config,
  onSave,
  readOnly = false,
}: TimelineEditDialogProps) {
  const [formState, setFormState] = useState<TimelineConfig>(config);
  const [selectedTrack, setSelectedTrack] = useState<TrackKind>(() =>
    getInitialSelectedTrack(config)
  );

  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen) {
        setFormState(config);
        setSelectedTrack(getInitialSelectedTrack(config));
      }
      onOpenChange(isOpen);
    },
    [config, onOpenChange]
  );

  const handleSave = useCallback(() => {
    // Auto-populate artifact names before saving
    const result = { ...formState };
    for (const kind of ALL_TRACK_KINDS) {
      const clipKey = TRACK_TO_CLIP_KEY[kind];
      const clip = result[clipKey] as ClipConfig | undefined;
      if (clip) {
        (result[clipKey] as ClipConfig) = {
          ...clip,
          artifact: clip.artifact || TRACK_TO_ARTIFACT[kind],
        };
      }
    }
    onSave?.(result);
  }, [formState, onSave]);

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const enabledTracks = useMemo(
    () => new Set(formState.tracks ?? []),
    [formState.tracks]
  );

  const toggleTrack = useCallback((kind: TrackKind, enabled: boolean) => {
    setFormState((prev) => {
      const currentTracks = new Set(prev.tracks ?? []);
      const newMasterTracks = [...(prev.masterTracks ?? [])];

      if (enabled) {
        currentTracks.add(kind);
        const clipKey = TRACK_TO_CLIP_KEY[kind];
        return {
          ...prev,
          tracks: ALL_TRACK_KINDS.filter((k) => currentTracks.has(k)),
          [clipKey]: createDefaultClip(kind),
        };
      } else {
        currentTracks.delete(kind);
        const clipKey = TRACK_TO_CLIP_KEY[kind];
        const filtered = newMasterTracks.filter((k) => k !== kind);
        const next: TimelineConfig = {
          ...prev,
          tracks: ALL_TRACK_KINDS.filter((k) => currentTracks.has(k)),
          masterTracks: filtered,
        };
        delete next[clipKey];
        return next;
      }
    });
  }, []);

  const updateTrackRole = useCallback((kind: TrackKind, role: TimingRole) => {
    setFormState((prev) => {
      const primary = prev.masterTracks?.[0];
      const fallback = prev.masterTracks?.[1];

      let nextPrimary = primary;
      let nextFallback = fallback;

      if (nextPrimary === kind) {
        nextPrimary = undefined;
      }

      if (nextFallback === kind) {
        nextFallback = undefined;
      }

      if (role === 'primary') {
        if (primary && primary !== kind) {
          nextFallback = primary;
        }
        nextPrimary = kind;
      }

      if (role === 'fallback') {
        if (!primary || primary === kind) {
          throw new Error(
            `Cannot assign ${kind} as fallback without a different primary track.`
          );
        }
        nextPrimary = primary;
        nextFallback = kind;
      }

      if (nextPrimary && nextFallback && nextPrimary === nextFallback) {
        nextFallback = undefined;
      }

      const masters: TrackKind[] = [];
      if (nextPrimary) {
        masters.push(nextPrimary);
      }
      if (nextFallback) {
        masters.push(nextFallback);
      }

      return {
        ...prev,
        masterTracks: masters,
      };
    });
  }, []);

  const updateClipField = useCallback(
    (kind: TrackKind, field: keyof ClipConfig, value: unknown) => {
      const clipKey = TRACK_TO_CLIP_KEY[kind];
      setFormState((prev) => {
        const clip =
          (prev[clipKey] as ClipConfig | undefined) ?? createDefaultClip(kind);
        return {
          ...prev,
          [clipKey]: { ...clip, [field]: value },
        };
      });
    },
    []
  );

  const primaryMaster = formState.masterTracks?.[0];
  const selectedTrackEnabled = enabledTracks.has(selectedTrack);
  const selectedTrackRole = getTimingRole(
    selectedTrack,
    formState.masterTracks
  );
  const selectedTrackClip = formState[TRACK_TO_CLIP_KEY[selectedTrack]] as
    | ClipConfig
    | undefined;
  const selectedTrackDefaults = createDefaultClip(selectedTrack);
  const selectedTrackSupportsTiming =
    TRACKS_WITH_NATIVE_DURATION.includes(selectedTrack);
  const selectedTrackSupportsVolume =
    TRACKS_WITH_VOLUME.includes(selectedTrack);
  const selectedTrackSupportsPlayStrategy = selectedTrack === 'Music';
  const selectedTrackSupportsEffect =
    TRACKS_WITH_EFFECT.includes(selectedTrack);

  const selectedVolume =
    selectedTrackClip?.volume ?? selectedTrackDefaults.volume ?? 1;

  const selectedPlayStrategy =
    selectedTrackClip?.playStrategy ?? selectedTrackDefaults.playStrategy;

  const selectedEffect =
    selectedTrackClip?.effect ?? selectedTrackDefaults.effect;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-[620px] p-0 gap-0 overflow-hidden'>
        <DialogHeader>
          <DialogTitle className='flex items-center gap-2'>
            <Film className='size-5' />
            {readOnly ? 'Timeline Settings' : 'Edit Timeline'}
          </DialogTitle>
          <p className='text-xs text-muted-foreground'>
            Select a track to edit its behavior without leaving this dialog.
          </p>
          <DialogDescription className='sr-only'>
            {readOnly
              ? 'Review timeline tracks, master tracks, and clip settings.'
              : 'Configure timeline tracks, master tracks, and clip settings.'}
          </DialogDescription>
        </DialogHeader>

        <div className='px-6 py-4'>
          <div className='grid h-[286px] grid-cols-[184px_minmax(0,1fr)] grid-rows-[40px_minmax(0,1fr)] overflow-hidden rounded-lg border border-border/70 bg-muted/10'>
            <div className='flex items-center border-r border-b border-border/60 px-3.5'>
              <p className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Tracks
              </p>
            </div>

            <div className='flex items-center justify-between gap-4 border-b border-border/60 px-4'>
              <p className='text-sm font-semibold text-foreground'>
                {selectedTrack}
              </p>

              <div className='flex items-center gap-2'>
                <span className='text-xs text-muted-foreground'>Enabled</span>
                <Switch
                  checked={selectedTrackEnabled}
                  onCheckedChange={(checked) =>
                    toggleTrack(selectedTrack, checked)
                  }
                  disabled={readOnly}
                  size='sm'
                />
              </div>
            </div>

            <aside className='min-h-0 overflow-y-auto border-r border-border/60 p-2'>
              <div className='space-y-1'>
                {ALL_TRACK_KINDS.map((kind) => {
                  const isSelected = selectedTrack === kind;
                  const isEnabled = enabledTracks.has(kind);

                  return (
                    <button
                      key={kind}
                      type='button'
                      onClick={() => setSelectedTrack(kind)}
                      className={cn(
                        'w-full rounded-md px-2.5 py-1.5 text-left text-sm font-medium transition-colors',
                        isSelected
                          ? 'bg-primary/85 text-primary-foreground'
                          : 'text-foreground hover:bg-accent/40',
                        !isEnabled && 'text-muted-foreground'
                      )}
                    >
                      {kind}
                    </button>
                  );
                })}
              </div>
            </aside>

            <section className='min-w-0 overflow-y-auto px-4 py-3'>
              <div className='w-[344px] max-w-full space-y-3'>
                {selectedTrackSupportsTiming && (
                  <div className='grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-4'>
                    <label className='text-xs text-muted-foreground'>
                      Timing role
                    </label>
                    <Select
                      value={selectedTrackRole}
                      onValueChange={(value) =>
                        updateTrackRole(selectedTrack, value as TimingRole)
                      }
                      disabled={readOnly || !selectedTrackEnabled}
                    >
                      <SelectTrigger className='h-8 w-full text-xs'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value='none' className='text-xs'>
                          None
                        </SelectItem>
                        <SelectItem value='primary' className='text-xs'>
                          Primary
                        </SelectItem>
                        <SelectItem
                          value='fallback'
                          className='text-xs'
                          disabled={
                            !primaryMaster || primaryMaster === selectedTrack
                          }
                        >
                          Fallback
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {selectedTrackEnabled && selectedTrackSupportsVolume && (
                  <div className='grid grid-cols-[104px_minmax(0,1fr)] gap-x-4 gap-y-1.5'>
                    <label className='self-end text-xs text-muted-foreground'>
                      Volume
                    </label>
                    <span className='w-full text-right font-mono text-xs text-muted-foreground'>
                      {selectedVolume.toFixed(2)}
                    </span>
                    <div className='col-start-2'>
                      <Slider
                        className='w-full'
                        value={[selectedVolume]}
                        onValueChange={([v]) =>
                          updateClipField(selectedTrack, 'volume', v)
                        }
                        min={0}
                        max={1}
                        step={0.05}
                        disabled={readOnly}
                      />
                    </div>
                  </div>
                )}

                {selectedTrackEnabled && selectedTrackSupportsPlayStrategy && (
                  <div className='grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-4'>
                    <label className='text-xs text-muted-foreground'>
                      Play strategy
                    </label>
                    <Select
                      value={selectedPlayStrategy}
                      onValueChange={(value) =>
                        updateClipField(selectedTrack, 'playStrategy', value)
                      }
                      disabled={readOnly}
                    >
                      <SelectTrigger className='h-8 w-full text-xs'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLAY_STRATEGY_OPTIONS.map((opt) => (
                          <SelectItem
                            key={opt.value}
                            value={opt.value}
                            className='text-xs'
                          >
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {selectedTrackEnabled && selectedTrackSupportsEffect && (
                  <div className='grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-4'>
                    <label className='text-xs text-muted-foreground'>
                      Effect
                    </label>
                    <Select
                      value={selectedEffect}
                      onValueChange={(value) =>
                        updateClipField(selectedTrack, 'effect', value)
                      }
                      disabled={readOnly}
                    >
                      <SelectTrigger className='h-8 w-full text-xs'>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(selectedTrack === 'Image'
                          ? IMAGE_EFFECT_OPTIONS
                          : TEXT_EFFECT_OPTIONS
                        ).map((opt) => (
                          <SelectItem
                            key={opt.value}
                            value={opt.value}
                            className='text-xs'
                          >
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </section>
          </div>
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
