import { useState, useMemo, useCallback } from "react";
import { X, Maximize2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { MediaCard } from "../shared/media-card";
import { InputCardFooter } from "./input-card-footer";
import { EmptyMediaPlaceholder } from "./empty-media-placeholder";
import { FilePreviewThumbnail } from "./file-preview";
import { FileUploadDialog } from "./file-upload-dialog";
import type { BlueprintInputDef } from "@/types/blueprint-graph";
import type { MediaType } from "@/lib/input-utils";
import {
  buildInputFileUrl,
  parseFileRef,
  type MediaInputType,
} from "@/data/blueprint-client";
import { uploadAndValidate } from "@/lib/panel-utils";

interface MediaInputCardProps {
  /** Input definition */
  input: BlueprintInputDef;
  /** Current value (file ref string or array of file ref strings) */
  value: unknown;
  /** Callback when value changes */
  onChange: (value: unknown) => void;
  /** Whether the input is editable */
  isEditable: boolean;
  /** Blueprint folder path for building file URLs */
  blueprintFolder: string | null;
  /** Movie ID for the current build */
  movieId: string | null;
  /** Index in array (for array items), undefined for single items */
  arrayIndex?: number;
  /** Callback to remove item from array */
  onRemoveArrayItem?: (index: number) => void;
}

/**
 * Card component for media inputs (image, video, audio).
 * Displays a thumbnail preview with edit/remove actions.
 */
export function MediaInputCard({
  input,
  value,
  onChange,
  isEditable,
  blueprintFolder,
  movieId,
  arrayIndex,
  onRemoveArrayItem,
}: MediaInputCardProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [expandedOpen, setExpandedOpen] = useState(false);

  // Determine media type
  const mediaType: MediaType = useMemo(() => {
    const type = input.itemType ?? input.type;
    if (type === "video") return "video";
    if (type === "audio") return "audio";
    return "image";
  }, [input.type, input.itemType]);

  // Parse file reference from value
  const fileRef = useMemo(() => {
    if (arrayIndex !== undefined && Array.isArray(value)) {
      return parseFileRef(value[arrayIndex]);
    }
    return parseFileRef(value);
  }, [value, arrayIndex]);

  // Build URL for preview
  const fileUrl = useMemo(() => {
    if (!blueprintFolder || !movieId || !fileRef) return null;
    return buildInputFileUrl(blueprintFolder, movieId, fileRef);
  }, [blueprintFolder, movieId, fileRef]);

  // Handle file upload
  const handleUpload = useCallback(
    async (files: File[]) => {
      const result = await uploadAndValidate(
        { blueprintFolder, movieId },
        files,
        mediaType as MediaInputType
      );

      const newRef = result.files[0].fileRef;

      if (arrayIndex !== undefined && Array.isArray(value)) {
        // Replace item in array
        const newArray = [...value];
        newArray[arrayIndex] = newRef;
        onChange(newArray);
      } else {
        // Replace single value
        onChange(newRef);
      }
    },
    [blueprintFolder, movieId, mediaType, arrayIndex, value, onChange]
  );

  // Handle remove
  const handleRemove = useCallback(() => {
    if (arrayIndex !== undefined && onRemoveArrayItem) {
      onRemoveArrayItem(arrayIndex);
    } else {
      onChange(undefined);
    }
  }, [arrayIndex, onRemoveArrayItem, onChange]);

  const isArray = input.type === "array";
  const canRemove = isArray && arrayIndex !== undefined;
  const isDisabled = !blueprintFolder || !movieId;
  const label = arrayIndex !== undefined ? `${input.name}[${arrayIndex}]` : input.name;

  // Only show expand for image and video (not audio)
  const canExpand = fileUrl && (mediaType === "image" || mediaType === "video");

  // No file - show placeholder
  if (!fileUrl) {
    return (
      <>
        <EmptyMediaPlaceholder
          mediaType={mediaType}
          onClick={() => setDialogOpen(true)}
          disabled={!isEditable || isDisabled}
        />
        <FileUploadDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          mediaType={mediaType}
          multiple={false}
          onConfirm={handleUpload}
        />
      </>
    );
  }

  return (
    <>
      <MediaCard
        footer={
          <InputCardFooter
            label={label}
            description={input.description}
            onExpand={canExpand ? () => setExpandedOpen(true) : undefined}
            onEdit={isEditable ? () => setDialogOpen(true) : undefined}
            onRemove={isEditable ? handleRemove : undefined}
            canRemove={canRemove}
            disabled={!isEditable && !canExpand}
          />
        }
      >
        <button
          type="button"
          onClick={canExpand ? () => setExpandedOpen(true) : undefined}
          className="aspect-video w-full bg-black/50 flex items-center justify-center overflow-hidden group relative"
        >
          <FilePreviewThumbnail
            url={fileUrl}
            mediaType={mediaType}
            filename={fileRef ?? ""}
            className="w-full h-full object-contain"
          />
          {canExpand && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
              <Maximize2 className="size-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}
        </button>
      </MediaCard>

      <FileUploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mediaType={mediaType}
        multiple={false}
        onConfirm={handleUpload}
      />

      {/* Expanded view dialog */}
      {canExpand && (
        <MediaExpandDialog
          open={expandedOpen}
          onOpenChange={setExpandedOpen}
          title={label}
          url={fileUrl}
          mediaType={mediaType}
        />
      )}
    </>
  );
}

interface AddMediaCardProps {
  /** Media type for the placeholder */
  mediaType: MediaType;
  /** Callback when add is clicked */
  onAdd: () => void;
  /** Whether the action is disabled */
  disabled?: boolean;
}

/**
 * Card component for adding a new media item to an array.
 */
export function AddMediaCard({ mediaType, onAdd, disabled = false }: AddMediaCardProps) {
  return (
    <EmptyMediaPlaceholder
      mediaType={mediaType}
      onClick={onAdd}
      disabled={disabled}
    />
  );
}

// ============================================================================
// Media Expand Dialog
// ============================================================================

interface MediaExpandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  url: string;
  mediaType: "image" | "video";
}

function MediaExpandDialog({
  open,
  onOpenChange,
  title,
  url,
  mediaType,
}: MediaExpandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 overflow-hidden">
        <div className="relative">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/50 hover:bg-black/70 text-white transition-colors"
          >
            <X className="size-5" />
          </button>
          <div className="p-4">
            {mediaType === "image" ? (
              <img
                src={url}
                alt={title}
                className="w-full max-h-[70vh] object-contain rounded-lg"
              />
            ) : (
              <video
                src={url}
                controls
                autoPlay
                className="w-full max-h-[70vh] object-contain rounded-lg"
              >
                Your browser does not support the video tag.
              </video>
            )}
          </div>
          <div className="px-4 pb-4">
            <p className="text-sm text-muted-foreground truncate">{title}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
