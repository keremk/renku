/**
 * File preview components for displaying uploaded input files.
 */

/* eslint-disable react-refresh/only-export-components */

import { Music, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaInputType } from "@/data/blueprint-client";

interface FilePreviewThumbnailProps {
  /** URL to the file */
  url: string;
  /** Media type for appropriate rendering */
  mediaType: MediaInputType;
  /** Alt text / filename for accessibility */
  filename: string;
  /** Optional class name for the container */
  className?: string;
}

/**
 * Renders a thumbnail preview for a file based on its media type.
 */
export function FilePreviewThumbnail({
  url,
  mediaType,
  filename,
  className,
}: FilePreviewThumbnailProps) {
  if (mediaType === "image") {
    return (
      <img
        src={url}
        alt={filename}
        className={cn("w-full h-full object-cover", className)}
        loading="lazy"
      />
    );
  }

  if (mediaType === "video") {
    return (
      <video
        src={url}
        className={cn("w-full h-full object-cover", className)}
        preload="metadata"
      />
    );
  }

  // Audio - show icon
  return (
    <div
      className={cn(
        "w-full h-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center",
        className
      )}
    >
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
        <Music className="size-4 text-primary" />
      </div>
    </div>
  );
}

interface SingleFilePreviewProps {
  /** URL to the file */
  url: string;
  /** Filename to display */
  filename: string;
  /** Media type for appropriate rendering */
  mediaType: MediaInputType;
  /** Optional file info (e.g., "1920x1080 · 245 KB") */
  fileInfo?: string;
}

/**
 * Displays a single file preview with thumbnail and filename.
 */
export function SingleFilePreview({
  url,
  filename,
  mediaType,
  fileInfo,
}: SingleFilePreviewProps) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-20 h-14 rounded-md overflow-hidden bg-black/50 flex-shrink-0">
        <FilePreviewThumbnail
          url={url}
          mediaType={mediaType}
          filename={filename}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-foreground font-medium truncate">{filename}</p>
        {fileInfo && (
          <p className="text-[10px] text-muted-foreground">{fileInfo}</p>
        )}
      </div>
    </div>
  );
}

interface FilePreviewGridProps {
  /** Array of file objects to display */
  files: Array<{
    url: string;
    filename: string;
  }>;
  /** Media type for appropriate rendering */
  mediaType: MediaInputType;
  /** Maximum number of thumbnails to display before showing "+N more" */
  maxVisible?: number;
}

/**
 * Displays a horizontal scrolling grid of file thumbnails.
 * Shows "+N more" indicator when there are more files than maxVisible.
 */
export function FilePreviewGrid({
  files,
  mediaType,
  maxVisible = 4,
}: FilePreviewGridProps) {
  if (files.length === 0) {
    return null;
  }

  const showOverflow = files.length > maxVisible;
  const visibleCount = showOverflow ? maxVisible - 1 : files.length;
  const overflowCount = files.length - visibleCount;

  return (
    <div className="space-y-1">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {files.slice(0, visibleCount).map((file, index) => (
          <div
            key={`${file.filename}-${index}`}
            className="w-16 h-12 rounded-md overflow-hidden bg-black/50 flex-shrink-0"
          >
            <FilePreviewThumbnail
              url={file.url}
              mediaType={mediaType}
              filename={file.filename}
            />
          </div>
        ))}

        {showOverflow && (
          <div className="w-16 h-12 rounded-md overflow-hidden bg-black/50 flex-shrink-0 relative">
            {/* Show the next file as background */}
            {files[visibleCount] && (
              <FilePreviewThumbnail
                url={files[visibleCount].url}
                mediaType={mediaType}
                filename={files[visibleCount].filename}
              />
            )}
            {/* Overlay with count */}
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <span className="text-white text-xs font-medium">+{overflowCount}</span>
            </div>
          </div>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground">
        {files.length} {files.length === 1 ? "file" : "files"}
      </p>
    </div>
  );
}

interface SelectedFilePreviewProps {
  /** File object */
  file: File;
  /** Callback to remove this file */
  onRemove: () => void;
}

/**
 * Displays a preview of a selected file (before upload) with remove button.
 * Used in the upload dialog.
 */
export function SelectedFilePreview({ file, onRemove }: SelectedFilePreviewProps) {
  const objectUrl = URL.createObjectURL(file);
  const mediaType = getMediaTypeFromMime(file.type);

  return (
    <div className="relative group">
      <div className="aspect-square rounded-lg overflow-hidden bg-black/50">
        <FilePreviewThumbnail
          url={objectUrl}
          mediaType={mediaType}
          filename={file.name}
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          "absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full",
          "bg-destructive text-destructive-foreground",
          "flex items-center justify-center",
          "opacity-0 group-hover:opacity-100 transition-opacity",
          "hover:bg-destructive/90"
        )}
      >
        <X className="size-3" />
      </button>
      <p className="text-[10px] text-muted-foreground truncate mt-1 text-center">
        {file.name}
      </p>
    </div>
  );
}

/**
 * Gets the media type from a MIME type string.
 */
export function getMediaTypeFromMime(mimeType: string): MediaInputType {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "image"; // Default fallback
}

/**
 * Formats a file size in bytes to a human-readable string.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
