/**
 * Drag-and-drop file upload zone using react-dropzone.
 */

/* eslint-disable react-refresh/only-export-components */

import type React from "react";
import { useCallback } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { CloudUpload } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MediaInputType } from "@/data/blueprint-client";

/** Maximum file size in bytes (100MB) */
const MAX_FILE_SIZE = 100 * 1024 * 1024;

/** Accept types mapping for each media input type */
const ACCEPT_TYPES: Record<MediaInputType, Record<string, string[]>> = {
  image: {
    "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  },
  video: {
    "video/*": [".mp4", ".webm", ".mov"],
  },
  audio: {
    "audio/*": [".mp3", ".wav", ".ogg", ".m4a"],
  },
};

/** Human-readable descriptions for each media type */
const TYPE_DESCRIPTIONS: Record<MediaInputType, string> = {
  image: "PNG, JPG, WEBP, GIF up to 100MB",
  video: "MP4, WEBM, MOV up to 100MB",
  audio: "MP3, WAV, OGG, M4A up to 100MB",
};

interface DropzoneAreaProps {
  /** Media type to accept */
  mediaType: MediaInputType;
  /** Whether to allow multiple files */
  multiple: boolean;
  /** Callback when files are selected/dropped */
  onFilesSelected: (files: File[]) => void;
  /** Callback when files are rejected */
  onFilesRejected?: (rejections: FileRejection[]) => void;
  /** Optional class name */
  className?: string;
}

export function DropzoneArea({
  mediaType,
  multiple,
  onFilesSelected,
  onFilesRejected,
  className,
}: DropzoneAreaProps) {
  const onDrop = useCallback(
    (acceptedFiles: File[], fileRejections: FileRejection[]) => {
      if (acceptedFiles.length > 0) {
        onFilesSelected(acceptedFiles);
      }
      if (fileRejections.length > 0) {
        onFilesRejected?.(fileRejections);
      }
    },
    [onFilesSelected, onFilesRejected]
  );

  const { getRootProps, getInputProps, isDragActive, isDragReject } = useDropzone({
    onDrop,
    accept: ACCEPT_TYPES[mediaType],
    multiple,
    maxSize: MAX_FILE_SIZE,
  });

  const typeDescription = TYPE_DESCRIPTIONS[mediaType];
  const actionText = multiple
    ? `Drag and drop ${mediaType}s here, or click to browse`
    : `Drag and drop an ${mediaType} here, or click to browse`;

  // Cast to work around react-dropzone types incompatibility with React 19
  const rootProps = getRootProps() as React.HTMLAttributes<HTMLDivElement>;
  const inputProps = getInputProps() as React.InputHTMLAttributes<HTMLInputElement>;

  return (
    <div
      {...rootProps}
      className={cn(
        "border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer",
        "bg-muted/20 hover:bg-muted/30",
        isDragActive && !isDragReject && "border-primary bg-primary/5",
        isDragReject && "border-destructive bg-destructive/5",
        !isDragActive && !isDragReject && "border-border",
        className
      )}
    >
      <input {...inputProps} />

      <div className="flex flex-col items-center gap-3">
        <div
          className={cn(
            "w-12 h-12 rounded-full flex items-center justify-center transition-colors",
            isDragActive && !isDragReject && "bg-primary/10",
            isDragReject && "bg-destructive/10",
            !isDragActive && !isDragReject && "bg-muted"
          )}
        >
          <CloudUpload
            className={cn(
              "size-6",
              isDragActive && !isDragReject && "text-primary",
              isDragReject && "text-destructive",
              !isDragActive && !isDragReject && "text-muted-foreground"
            )}
          />
        </div>

        <div className="space-y-1">
          <p
            className={cn(
              "text-sm font-medium",
              isDragActive && !isDragReject && "text-primary",
              isDragReject && "text-destructive",
              !isDragActive && !isDragReject && "text-foreground"
            )}
          >
            {isDragReject ? "Invalid file type" : actionText}
          </p>
          <p className="text-xs text-muted-foreground">{typeDescription}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Formats file rejection errors into a human-readable message.
 */
export function formatRejectionErrors(rejections: FileRejection[]): string {
  const messages: string[] = [];

  for (const rejection of rejections) {
    for (const error of rejection.errors) {
      switch (error.code) {
        case "file-too-large":
          messages.push(`"${rejection.file.name}" exceeds 100MB limit`);
          break;
        case "file-invalid-type":
          messages.push(`"${rejection.file.name}" has invalid type`);
          break;
        default:
          messages.push(`"${rejection.file.name}": ${error.message}`);
      }
    }
  }

  return messages.join("; ");
}
