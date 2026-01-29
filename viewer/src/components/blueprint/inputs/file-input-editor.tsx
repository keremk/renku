/**
 * Editor for file input types (image, video, audio).
 * Supports both single files and arrays.
 */

/* eslint-disable react-refresh/only-export-components */

import { useState, useCallback, useMemo } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SingleFilePreview, FilePreviewGrid } from "./file-preview";
import { FileUploadDialog } from "./file-upload-dialog";
import type { InputEditorProps } from "./input-registry";
import {
  uploadInputFiles,
  buildInputFileUrl,
  parseFileRef,
  type MediaInputType,
} from "@/data/blueprint-client";

interface FileInputEditorProps extends InputEditorProps {
  /** Blueprint folder path for building file URLs */
  blueprintFolder: string | null;
  /** Movie ID for the current build */
  movieId: string | null;
}

/**
 * Determines the media type from an input type string.
 */
function getMediaType(inputType: string, itemType?: string): MediaInputType | null {
  const type = itemType ?? inputType;
  if (type === "image") return "image";
  if (type === "video") return "video";
  if (type === "audio") return "audio";
  return null;
}

/**
 * Checks if an input type is a file type.
 */
export function isFileInputType(inputType: string, itemType?: string): boolean {
  return getMediaType(inputType, itemType) !== null;
}

export function FileInputEditor({
  input,
  value,
  onChange,
  isEditable,
  blueprintFolder,
  movieId,
}: FileInputEditorProps) {
  const [dialogOpen, setDialogOpen] = useState(false);

  // Determine if this is an array type
  const isArray = input.type === "array";
  const mediaType = getMediaType(input.type, input.itemType);

  // Parse file references from current value
  const fileRefs = useMemo(() => {
    if (isArray && Array.isArray(value)) {
      return value
        .map((v) => parseFileRef(v))
        .filter((f): f is string => f !== null);
    }
    const singleRef = parseFileRef(value);
    return singleRef ? [singleRef] : [];
  }, [value, isArray]);

  // Build URLs for previews
  const filesWithUrls = useMemo(() => {
    if (!blueprintFolder || !movieId) return [];
    return fileRefs.map((filename) => ({
      filename,
      url: buildInputFileUrl(blueprintFolder, movieId, filename),
    }));
  }, [fileRefs, blueprintFolder, movieId]);

  // Handle file upload completion
  const handleUpload = useCallback(
    async (files: File[]) => {
      if (!blueprintFolder || !movieId || !mediaType) {
        throw new Error("Missing required context for upload");
      }

      const result = await uploadInputFiles(blueprintFolder, movieId, files, mediaType);

      if (result.files.length === 0) {
        throw new Error(result.errors?.join("; ") ?? "No files were uploaded");
      }

      // Update the input value with new file references
      const newRefs = result.files.map((f) => f.fileRef);

      if (isArray) {
        // Append to existing array
        const existingRefs = Array.isArray(value)
          ? value.filter((v) => typeof v === "string" && v.startsWith("file:"))
          : [];
        onChange([...existingRefs, ...newRefs]);
      } else {
        // Replace single value
        onChange(newRefs[0]);
      }
    },
    [blueprintFolder, movieId, mediaType, isArray, value, onChange]
  );

  // Early return for invalid media type
  if (!mediaType) {
    return (
      <span className="text-xs text-muted-foreground/60 italic">
        unsupported file type
      </span>
    );
  }

  // Disabled state when context is missing
  const isDisabled = !blueprintFolder || !movieId;

  return (
    <div className="space-y-2">
      {/* File preview display */}
      <div className="p-2 rounded-lg border border-border/50 bg-muted/30">
        {filesWithUrls.length === 0 ? (
          <span className="text-xs text-muted-foreground/60 italic">
            no files selected
          </span>
        ) : isArray ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <FilePreviewGrid
                files={filesWithUrls}
                mediaType={mediaType}
              />
            </div>
            {isEditable && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
                onClick={() => setDialogOpen(true)}
                disabled={isDisabled}
              >
                <Upload className="size-3.5" />
                Add Files
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <SingleFilePreview
                url={filesWithUrls[0].url}
                filename={filesWithUrls[0].filename}
                mediaType={mediaType}
              />
            </div>
            {isEditable && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs text-muted-foreground hover:text-foreground flex-shrink-0"
                onClick={() => setDialogOpen(true)}
                disabled={isDisabled}
              >
                <Upload className="size-3.5" />
                Upload
              </Button>
            )}
          </div>
        )}

        {/* Upload button when no files */}
        {filesWithUrls.length === 0 && isEditable && (
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setDialogOpen(true)}
              disabled={isDisabled}
              title={isDisabled ? "Select a build first" : undefined}
            >
              <Upload className="size-3.5" />
              {isArray ? "Add Files" : "Upload"}
            </Button>
          </div>
        )}
      </div>

      {/* Upload dialog */}
      <FileUploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mediaType={mediaType}
        multiple={isArray}
        onConfirm={handleUpload}
      />
    </div>
  );
}
