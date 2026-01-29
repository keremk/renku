/**
 * Shared utilities for detail panel components.
 */

import {
  uploadInputFiles,
  type MediaInputType,
  type UploadFilesResponse,
} from "@/data/blueprint-client";

// ============================================================================
// Upload Utilities
// ============================================================================

export interface UploadContext {
  blueprintFolder: string | null;
  movieId: string | null;
}

/**
 * Error thrown when upload context is incomplete.
 */
export class UploadContextError extends Error {
  constructor(message: string = "Missing required context for upload") {
    super(message);
    this.name = "UploadContextError";
  }
}

/**
 * Error thrown when upload produces no files.
 */
export class UploadEmptyError extends Error {
  /** Original errors from the upload response, if any */
  readonly uploadErrors?: string[];

  constructor(response: UploadFilesResponse) {
    const message = response.errors?.length
      ? `Upload failed: ${response.errors.join("; ")}`
      : "No files were uploaded";
    super(message);
    this.name = "UploadEmptyError";
    this.uploadErrors = response.errors;
  }
}

/**
 * Validates upload context and throws if incomplete.
 */
export function validateUploadContext(
  context: UploadContext
): asserts context is { blueprintFolder: string; movieId: string } {
  if (!context.blueprintFolder || !context.movieId) {
    throw new UploadContextError();
  }
}

/**
 * Uploads files and validates the result.
 * Throws UploadContextError if context is incomplete.
 * Throws UploadEmptyError if no files were uploaded.
 */
export async function uploadAndValidate(
  context: UploadContext,
  files: File[],
  mediaType: MediaInputType
): Promise<UploadFilesResponse> {
  validateUploadContext(context);

  const result = await uploadInputFiles(
    context.blueprintFolder,
    context.movieId,
    files,
    mediaType
  );

  if (result.files.length === 0) {
    throw new UploadEmptyError(result);
  }

  return result;
}

// ============================================================================
// Node ID Parsing Utilities
// ============================================================================

export type NodeIdType = "Input" | "Output" | "Producer" | "Unknown";

export interface ParsedNodeId {
  /** The type of node (Input, Output, Producer, or Unknown) */
  type: NodeIdType;
  /** The full path (e.g., "Root.Child.name") */
  path: string;
  /** The final name component (last segment after '.') */
  name: string | null;
  /** The raw original node ID */
  raw: string;
}

/**
 * Parses a node ID into its components.
 * Node IDs have the format: "Type:Namespace.Path.Name"
 * e.g., "Input:Root.images" or "Output:Root.Child.video"
 */
export function parseNodeId(nodeId: string | null | undefined): ParsedNodeId | null {
  if (!nodeId) {
    return null;
  }

  // Match the pattern: Type:Path
  const colonIndex = nodeId.indexOf(":");
  if (colonIndex === -1) {
    return {
      type: "Unknown",
      path: nodeId,
      name: nodeId.split(".").pop() ?? null,
      raw: nodeId,
    };
  }

  const typeStr = nodeId.slice(0, colonIndex);
  const path = nodeId.slice(colonIndex + 1);

  let type: NodeIdType;
  switch (typeStr) {
    case "Input":
      type = "Input";
      break;
    case "Output":
      type = "Output";
      break;
    case "Producer":
      type = "Producer";
      break;
    default:
      type = "Unknown";
  }

  return {
    type,
    path,
    name: path.split(".").pop() ?? null,
    raw: nodeId,
  };
}

/**
 * Extracts the name from an input node ID, or null if not an input node.
 */
export function getInputNameFromNodeId(nodeId: string | null | undefined): string | null {
  const parsed = parseNodeId(nodeId);
  if (!parsed || parsed.type !== "Input") {
    return null;
  }
  return parsed.name;
}

/**
 * Extracts the name from an output node ID, or null if not an output node.
 */
export function getOutputNameFromNodeId(nodeId: string | null | undefined): string | null {
  const parsed = parseNodeId(nodeId);
  if (!parsed || parsed.type !== "Output") {
    return null;
  }
  return parsed.name;
}

// ============================================================================
// Selection Styling Utilities
// ============================================================================

export type SelectionColor = "purple" | "blue" | "green" | "amber";

const selectionStyleMap: Record<
  SelectionColor,
  { selected: string; default: string }
> = {
  purple: {
    selected: "border-purple-400 bg-purple-500/10 ring-1 ring-purple-400/30",
    default: "border-border/40 bg-muted/30",
  },
  blue: {
    selected: "border-blue-400 bg-blue-500/10 ring-1 ring-blue-400/30",
    default: "border-border/40 bg-muted/30",
  },
  green: {
    selected: "border-green-400 bg-green-500/10 ring-1 ring-green-400/30",
    default: "border-border/40 bg-muted/30",
  },
  amber: {
    selected: "border-amber-400 bg-amber-500/10 ring-1 ring-amber-400/30",
    default: "border-border/40 bg-muted/30",
  },
};

/**
 * Returns CSS classes for selection state.
 */
export function getSelectionStyles(
  isSelected: boolean,
  color: SelectionColor = "blue"
): string {
  const styles = selectionStyleMap[color];
  return isSelected ? styles.selected : styles.default;
}

/**
 * Returns just the ring class for section highlighting.
 */
export function getSectionHighlightStyles(
  isSelected: boolean,
  color: SelectionColor = "blue"
): string | undefined {
  if (!isSelected) {
    return undefined;
  }

  const colorMap: Record<SelectionColor, string> = {
    purple: "ring-1 ring-purple-400/30 bg-purple-500/5 rounded-lg",
    blue: "ring-1 ring-blue-400/30 bg-blue-500/5 rounded-lg",
    green: "ring-1 ring-green-400/30 bg-green-500/5 rounded-lg",
    amber: "ring-1 ring-amber-400/30 bg-amber-500/5 rounded-lg",
  };

  return colorMap[color];
}
