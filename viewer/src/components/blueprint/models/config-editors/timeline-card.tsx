/**
 * TimelineCard - Specialized editor for timeline composition configuration.
 *
 * Displays timeline settings in a card format with preview and edit dialog.
 * Follows the same pattern as SubtitlesCard.
 */

import { useState, useCallback, useMemo, useEffect } from "react";
import { Film, Layers, Volume2, Settings, Crown } from "lucide-react";

import { MediaCard } from "../../shared/media-card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { ConfigEditorProps } from "./index";

// ============================================================================
// Types
// ============================================================================

type TrackKind = "Image" | "Video" | "Audio" | "Music";

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
}

// ============================================================================
// Constants
// ============================================================================

const ALL_TRACK_KINDS: TrackKind[] = ["Image", "Video", "Audio", "Music"];

const TRACKS_WITH_NATIVE_DURATION: TrackKind[] = ["Video", "Audio", "Music"];

const TRACK_TO_ARTIFACT: Record<TrackKind, string> = {
  Image: "ImageSegments",
  Video: "VideoSegments",
  Audio: "AudioSegments",
  Music: "Music",
};

const TRACK_TO_CLIP_KEY: Record<TrackKind, keyof TimelineConfig> = {
  Image: "imageClip",
  Video: "videoClip",
  Audio: "audioClip",
  Music: "musicClip",
};

const TRACK_COLORS: Record<TrackKind, string> = {
  Image: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  Video: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Audio: "bg-green-500/20 text-green-300 border-green-500/30",
  Music: "bg-amber-500/20 text-amber-300 border-amber-500/30",
};

const PLAY_STRATEGY_OPTIONS = [
  { value: "loop", label: "Loop" },
  { value: "stopWhenFinished", label: "Stop when finished" },
];

const IMAGE_EFFECT_OPTIONS = [
  { value: "KennBurns", label: "Ken Burns" },
];

const TIMELINE_DEFAULTS: TimelineConfig = {
  tracks: ["Video", "Audio", "Music"],
  masterTracks: ["Audio"],
  audioClip: { artifact: "AudioSegments", volume: 1 },
  videoClip: { artifact: "VideoSegments" },
  musicClip: { artifact: "Music", volume: 0.3 },
};

// ============================================================================
// Main Component
// ============================================================================

export type TimelineCardProps = ConfigEditorProps<TimelineConfig>;

export function TimelineCard({
  value,
  isEditable = false,
  isSelected = false,
  onChange,
}: TimelineCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  const config = useMemo(() => {
    return { ...TIMELINE_DEFAULTS, ...value };
  }, [value]);

  // Auto-emit defaults when value is undefined and editable
  useEffect(() => {
    if (value === undefined && isEditable && onChange) {
      onChange(TIMELINE_DEFAULTS);
    }
  }, [value, isEditable, onChange]);

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
    <div className="bg-muted/30 p-4 space-y-3 min-h-[200px]">
      {/* Tracks row */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Layers className="size-3" />
          <span>Layers</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {tracks.map((kind) => (
            <span
              key={kind}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium",
                TRACK_COLORS[kind]
              )}
            >
              {kind}
              {masterTracks.includes(kind) && (
                <Crown className="size-2.5 opacity-70" />
              )}
            </span>
          ))}
        </div>
      </div>

      {/* Volume row */}
      {volumes.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Volume2 className="size-3" />
            <span>Volume</span>
          </div>
          <div className="text-xs text-foreground">
            {volumes
              .map((v) => `${v.label}: ${Math.round(v.value * 100)}%`)
              .join(" / ")}
          </div>
        </div>
      )}

      {/* Master tracks info */}
      {masterTracks.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Crown className="size-3" />
            <span>Master</span>
          </div>
          <div className="text-xs text-foreground">
            {masterTracks.join(" > ")}
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
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Film className="size-4 text-muted-foreground" />
        <span className="text-xs text-foreground truncate">Timeline</span>
      </div>
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
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

  const toggleTrack = useCallback(
    (kind: TrackKind, enabled: boolean) => {
      setFormState((prev) => {
        const currentTracks = new Set(prev.tracks ?? []);
        const newMasterTracks = [...(prev.masterTracks ?? [])];

        if (enabled) {
          currentTracks.add(kind);
          // Create default clip config
          const clipKey = TRACK_TO_CLIP_KEY[kind];
          const defaultClip: ClipConfig = {
            artifact: TRACK_TO_ARTIFACT[kind],
          };
          if (kind === "Audio") defaultClip.volume = 1;
          if (kind === "Music") {
            defaultClip.volume = 0.3;
            defaultClip.playStrategy = "loop";
          }
          if (kind === "Image") defaultClip.effect = "KennBurns";
          return {
            ...prev,
            tracks: ALL_TRACK_KINDS.filter((k) => currentTracks.has(k)),
            [clipKey]: defaultClip,
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
    },
    []
  );

  const updateMasterTrack = useCallback(
    (index: number, value: string) => {
      setFormState((prev) => {
        const masters = [...(prev.masterTracks ?? [])];
        if (value === "none") {
          masters.splice(index, 1);
        } else {
          masters[index] = value as TrackKind;
        }
        return { ...prev, masterTracks: masters };
      });
    },
    []
  );

  const updateClipField = useCallback(
    (kind: TrackKind, field: keyof ClipConfig, value: unknown) => {
      const clipKey = TRACK_TO_CLIP_KEY[kind];
      setFormState((prev) => {
        const clip = (prev[clipKey] as ClipConfig | undefined) ?? {
          artifact: TRACK_TO_ARTIFACT[kind],
        };
        return {
          ...prev,
          [clipKey]: { ...clip, [field]: value },
        };
      });
    },
    []
  );

  // Eligible master tracks: enabled tracks with native duration
  const eligibleMasters = useMemo(
    () =>
      TRACKS_WITH_NATIVE_DURATION.filter((k) => enabledTracks.has(k)),
    [enabledTracks]
  );

  const primaryMaster = formState.masterTracks?.[0];
  const fallbackMaster = formState.masterTracks?.[1];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Film className="size-5" />
            {readOnly ? "Timeline Settings" : "Edit Timeline"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Tracks Section */}
          <FormSection icon={Layers} label="Tracks">
            <div className="grid grid-cols-2 gap-3">
              {ALL_TRACK_KINDS.map((kind) => (
                <div
                  key={kind}
                  className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2"
                >
                  <span className="text-xs text-foreground">{kind}</span>
                  <Switch
                    checked={enabledTracks.has(kind)}
                    onCheckedChange={(checked) => toggleTrack(kind, checked)}
                    disabled={readOnly}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          </FormSection>

          {/* Master Tracks Section */}
          <FormSection icon={Crown} label="Master Tracks">
            <div className="space-y-3">
              <FormRow label="Primary">
                <Select
                  value={primaryMaster ?? ""}
                  onValueChange={(v) => updateMasterTrack(0, v)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleMasters.map((kind) => (
                      <SelectItem key={kind} value={kind} className="text-xs">
                        {kind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormRow>
              <FormRow label="Fallback">
                <Select
                  value={fallbackMaster ?? "none"}
                  onValueChange={(v) => updateMasterTrack(1, v)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">
                      None
                    </SelectItem>
                    {eligibleMasters
                      .filter((k) => k !== primaryMaster)
                      .map((kind) => (
                        <SelectItem
                          key={kind}
                          value={kind}
                          className="text-xs"
                        >
                          {kind}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </FormRow>
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Only tracks with native duration (Audio, Video, Music) can be
              masters.
            </p>
          </FormSection>

          {/* Clip Settings Section */}
          <FormSection icon={Settings} label="Clip Settings">
            <div className="space-y-4">
              {ALL_TRACK_KINDS.filter((kind) => enabledTracks.has(kind)).map(
                (kind) => {
                  const clipKey = TRACK_TO_CLIP_KEY[kind];
                  const clip = formState[clipKey] as ClipConfig | undefined;
                  const hasVolume = kind !== "Image";
                  const hasPlayStrategy = kind === "Music";
                  const hasEffect = kind === "Image";

                  return (
                    <div key={kind} className="space-y-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium",
                          TRACK_COLORS[kind]
                        )}
                      >
                        {kind}
                      </span>

                      {hasVolume && (
                        <FormRow label="Volume">
                          <div className="flex items-center gap-3">
                            <Slider
                              value={[clip?.volume ?? (kind === "Music" ? 0.3 : 1)]}
                              onValueChange={([v]) =>
                                updateClipField(kind, "volume", v)
                              }
                              min={0}
                              max={1}
                              step={0.05}
                              disabled={readOnly}
                              className="flex-1"
                            />
                            <span className="text-xs font-mono text-muted-foreground w-10 text-right">
                              {(
                                clip?.volume ?? (kind === "Music" ? 0.3 : 1)
                              ).toFixed(2)}
                            </span>
                          </div>
                        </FormRow>
                      )}

                      {hasPlayStrategy && (
                        <FormRow label="Play Strategy">
                          <Select
                            value={clip?.playStrategy ?? "loop"}
                            onValueChange={(v) =>
                              updateClipField(kind, "playStrategy", v)
                            }
                            disabled={readOnly}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PLAY_STRATEGY_OPTIONS.map((opt) => (
                                <SelectItem
                                  key={opt.value}
                                  value={opt.value}
                                  className="text-xs"
                                >
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormRow>
                      )}

                      {hasEffect && (
                        <FormRow label="Effect">
                          <Select
                            value={clip?.effect ?? "KennBurns"}
                            onValueChange={(v) =>
                              updateClipField(kind, "effect", v)
                            }
                            disabled={readOnly}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {IMAGE_EFFECT_OPTIONS.map((opt) => (
                                <SelectItem
                                  key={opt.value}
                                  value={opt.value}
                                  className="text-xs"
                                >
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormRow>
                      )}
                    </div>
                  );
                }
              )}
            </div>
          </FormSection>
        </div>

        <DialogFooter>
          {readOnly ? (
            <Button variant="outline" onClick={handleCancel}>
              Close
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleCancel}>
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
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Icon className="size-4" />
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
    <div className="space-y-1.5">
      <label className="text-xs text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
