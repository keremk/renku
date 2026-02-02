import { useState, useEffect, useMemo } from "react";
import {
  MoreHorizontal,
  Download,
  ExternalLink,
  Copy,
  Music,
  File,
  Maximize2,
  X,
  RefreshCw,
  Square,
  CheckSquare,
  Check,
  Pencil,
  RotateCcw,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  shortenArtifactDisplayName,
  groupArtifactsByProducer,
  sortProducersByTopology,
} from "@/lib/artifact-utils";
import {
  getOutputNameFromNodeId,
  getSelectionStyles,
} from "@/lib/panel-utils";
import { useExecution } from "@/contexts/execution-context";
import { MediaCard, MediaGrid, CollapsibleSection } from "./shared";
import { EditedBadge } from "./outputs/edited-badge";
import { ArtifactTextEditDialog } from "./outputs/artifact-text-edit-dialog";
import { FileUploadDialog } from "./inputs/file-upload-dialog";
import {
  editArtifactFile,
  editArtifactText,
  restoreArtifact,
} from "@/data/blueprint-client";
import type { BlueprintOutputDef, BlueprintGraphData } from "@/types/blueprint-graph";
import type { ArtifactInfo } from "@/types/builds";

interface OutputsPanelProps {
  outputs: BlueprintOutputDef[];
  selectedNodeId: string | null;
  movieId: string | null;
  blueprintFolder: string | null;
  artifacts: ArtifactInfo[];
  graphData?: BlueprintGraphData;
  /** Callback when an artifact is edited or restored */
  onArtifactUpdated?: () => void;
}

export function OutputsPanel({
  outputs,
  selectedNodeId,
  movieId,
  blueprintFolder,
  artifacts,
  graphData,
  onArtifactUpdated,
}: OutputsPanelProps) {
  const selectedOutputName = getOutputNameFromNodeId(selectedNodeId);

  if (outputs.length === 0 && artifacts.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No outputs defined in this blueprint.
      </div>
    );
  }

  if (artifacts.length > 0 && blueprintFolder && movieId) {
    return (
      <ArtifactGallery
        artifacts={artifacts}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        graphData={graphData}
        onArtifactUpdated={onArtifactUpdated}
      />
    );
  }

  return (
    <div className="space-y-3">
      {!movieId && (
        <div className="text-muted-foreground text-xs bg-muted/30 p-2 rounded mb-4">
          Select a build to view generated artifacts.
        </div>
      )}

      {outputs.map((output) => {
        const isSelected = selectedOutputName === output.name;

        return (
          <OutputDefinitionCard
            key={output.name}
            output={output}
            isSelected={isSelected}
          />
        );
      })}
    </div>
  );
}

function OutputDefinitionCard({
  output,
  isSelected,
}: {
  output: BlueprintOutputDef;
  isSelected: boolean;
}) {
  return (
    <div
      className={cn(
        "p-3 rounded-lg border transition-all",
        getSelectionStyles(isSelected, "primary")
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="font-medium text-sm text-foreground">{output.name}</span>
        <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          {output.type}
        </span>
        {output.itemType && (
          <span className="text-xs text-muted-foreground">
            ({output.itemType}[])
          </span>
        )}
      </div>

      {output.description && (
        <p className="text-xs text-muted-foreground">{output.description}</p>
      )}
    </div>
  );
}

// ============================================================================
// Artifact Gallery (Producer-based grouping)
// ============================================================================

function ArtifactGallery({
  artifacts,
  blueprintFolder,
  movieId,
  graphData,
  onArtifactUpdated,
}: {
  artifacts: ArtifactInfo[];
  blueprintFolder: string;
  movieId: string;
  graphData?: BlueprintGraphData;
  onArtifactUpdated?: () => void;
}) {
  const { isArtifactSelected, selectProducerArtifacts, deselectProducerArtifacts } = useExecution();

  // Group artifacts by producer and sort by topological order
  const { groupedByProducer, orderedProducers } = useMemo(() => {
    const grouped = groupArtifactsByProducer(artifacts);
    const ordered = sortProducersByTopology(Array.from(grouped.keys()), graphData);
    return { groupedByProducer: grouped, orderedProducers: ordered };
  }, [artifacts, graphData]);

  return (
    <div className="space-y-4">
      {orderedProducers.map((producerName) => {
        const producerArtifacts = groupedByProducer.get(producerName) ?? [];
        const artifactIds = producerArtifacts.map((a) => a.id);
        const selectedCount = artifactIds.filter((id) => isArtifactSelected(id)).length;
        const allSelected = selectedCount === artifactIds.length && artifactIds.length > 0;
        const someSelected = selectedCount > 0 && selectedCount < artifactIds.length;

        const handleSelectAll = () => {
          if (allSelected) {
            deselectProducerArtifacts(artifactIds);
          } else {
            selectProducerArtifacts(artifactIds);
          }
        };

        return (
          <ProducerArtifactSection
            key={producerName}
            producerName={producerName}
            count={producerArtifacts.length}
            allSelected={allSelected}
            someSelected={someSelected}
            onSelectAll={handleSelectAll}
            defaultOpen
          >
            <MediaGrid>
              {producerArtifacts.map((artifact) => {
                const isSelected = isArtifactSelected(artifact.id);
                return (
                  <ArtifactCardRenderer
                    key={artifact.id}
                    artifact={artifact}
                    blueprintFolder={blueprintFolder}
                    movieId={movieId}
                    isSelected={isSelected}
                    onArtifactUpdated={onArtifactUpdated}
                  />
                );
              })}
            </MediaGrid>
          </ProducerArtifactSection>
        );
      })}
    </div>
  );
}

// ============================================================================
// Artifact Card Renderer (dispatches to correct card type)
// ============================================================================

function ArtifactCardRenderer({
  artifact,
  blueprintFolder,
  movieId,
  isSelected,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  onArtifactUpdated?: () => void;
}) {
  if (artifact.mimeType.startsWith("video/")) {
    return (
      <VideoCard
        artifact={artifact}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        onArtifactUpdated={onArtifactUpdated}
      />
    );
  }
  if (artifact.mimeType.startsWith("audio/")) {
    return (
      <AudioCard
        artifact={artifact}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        onArtifactUpdated={onArtifactUpdated}
      />
    );
  }
  if (artifact.mimeType.startsWith("image/")) {
    return (
      <ImageCard
        artifact={artifact}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        onArtifactUpdated={onArtifactUpdated}
      />
    );
  }
  if (artifact.mimeType.startsWith("text/") || artifact.mimeType === "application/json") {
    return (
      <TextCard
        artifact={artifact}
        blueprintFolder={blueprintFolder}
        movieId={movieId}
        isSelected={isSelected}
        onArtifactUpdated={onArtifactUpdated}
      />
    );
  }
  return <GenericCard artifact={artifact} isSelected={isSelected} />;
}

// ============================================================================
// Producer Artifact Section (with selection support)
// ============================================================================

function ProducerArtifactSection({
  producerName,
  count,
  allSelected,
  someSelected,
  onSelectAll,
  defaultOpen = true,
  children,
}: {
  producerName: string;
  count: number;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: () => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelectAll();
  };

  const regenerateAction = (
    <button
      type="button"
      onClick={handleCheckboxClick}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded hover:bg-muted transition-colors text-xs",
        allSelected || someSelected ? "text-primary" : "text-muted-foreground"
      )}
      title={allSelected ? "Deselect all" : "Select all for regeneration"}
    >
      <span>Generate Again</span>
      {allSelected ? (
        <CheckSquare className="size-4" />
      ) : someSelected ? (
        <Square className="size-4 fill-primary/30" />
      ) : (
        <Square className="size-4" />
      )}
    </button>
  );

  return (
    <CollapsibleSection
      title={producerName}
      count={count}
      defaultOpen={defaultOpen}
      actions={regenerateAction}
    >
      {children}
    </CollapsibleSection>
  );
}

// ============================================================================
// Card Footer (for artifacts)
// ============================================================================

function CardFooter({
  artifactId,
  displayName,
  downloadName,
  url,
  isEdited,
  onExpand,
  onEdit,
  onRestore,
}: {
  artifactId: string;
  displayName: string;
  downloadName: string;
  url: string;
  isEdited?: boolean;
  onExpand?: () => void;
  onEdit?: () => void;
  onRestore?: () => void;
}) {
  const { isArtifactSelected, toggleArtifactSelection } = useExecution();
  const isSelected = isArtifactSelected(artifactId);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = downloadName;
    a.click();
  };

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(window.location.origin + url);
  };

  const handleOpenInNewTab = () => {
    window.open(url, "_blank");
  };

  const handleToggleRegeneration = () => {
    toggleArtifactSelection(artifactId);
  };

  return (
    <>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className="text-xs text-foreground truncate" title={displayName}>
          {displayName}
        </span>
        {isEdited && <EditedBadge />}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="p-1 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {onEdit && (
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="size-4" />
              <span>Edit</span>
            </DropdownMenuItem>
          )}
          {isEdited && onRestore && (
            <DropdownMenuItem onClick={onRestore}>
              <RotateCcw className="size-4" />
              <span>Restore Original</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleToggleRegeneration}>
            <RefreshCw className="size-4" />
            <span className="flex-1">Generate Again</span>
            <Check className={`size-4 ${isSelected ? "text-primary" : "invisible"}`} />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {onExpand && (
            <DropdownMenuItem onClick={onExpand}>
              <Maximize2 className="size-4" />
              <span>Expand</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleDownload}>
            <Download className="size-4" />
            <span>Download</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleOpenInNewTab}>
            <ExternalLink className="size-4" />
            <span>Open in new tab</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleCopyUrl}>
            <Copy className="size-4" />
            <span>Copy URL</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

// ============================================================================
// Video Card
// ============================================================================

function VideoCard({
  artifact,
  blueprintFolder,
  movieId,
  isSelected,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  onArtifactUpdated?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const displayName = shortenArtifactDisplayName(artifact.id);
  const isEdited = artifact.editedBy === "user";

  const handleEdit = () => setIsEditDialogOpen(true);

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    await editArtifactFile(blueprintFolder, movieId, artifact.id, files[0]);
    onArtifactUpdated?.();
  };

  const handleRestore = async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, artifact.id);
      onArtifactUpdated?.();
    } catch (error) {
      console.error("[VideoCard] Restore failed:", error);
    }
  };

  return (
    <>
      <MediaCard
        isSelected={isSelected}
        footer={
          <CardFooter
            artifactId={artifact.id}
            displayName={displayName}
            downloadName={artifact.name}
            url={url}
            isEdited={isEdited}
            onExpand={() => setIsExpanded(true)}
            onEdit={handleEdit}
            onRestore={isEdited ? handleRestore : undefined}
          />
        }
      >
        <div className="aspect-video bg-black flex items-center justify-center">
          <video
            src={url}
            controls
            className="w-full h-full object-contain"
            preload="metadata"
          >
            Your browser does not support the video tag.
          </video>
        </div>
      </MediaCard>

      <MediaDialog
        open={isExpanded}
        onOpenChange={setIsExpanded}
        title={displayName}
      >
        <video
          src={url}
          controls
          autoPlay
          className="w-full max-h-[70vh] object-contain rounded-lg"
        >
          Your browser does not support the video tag.
        </video>
      </MediaDialog>

      <FileUploadDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        mediaType="video"
        multiple={false}
        onConfirm={handleFileUpload}
      />
    </>
  );
}

// ============================================================================
// Audio Card
// ============================================================================

function AudioCard({
  artifact,
  blueprintFolder,
  movieId,
  isSelected,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  onArtifactUpdated?: () => void;
}) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const displayName = shortenArtifactDisplayName(artifact.id);
  const isEdited = artifact.editedBy === "user";

  const handleEdit = () => setIsEditDialogOpen(true);

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    await editArtifactFile(blueprintFolder, movieId, artifact.id, files[0]);
    onArtifactUpdated?.();
  };

  const handleRestore = async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, artifact.id);
      onArtifactUpdated?.();
    } catch (error) {
      console.error("[AudioCard] Restore failed:", error);
    }
  };

  return (
    <>
      <MediaCard
        isSelected={isSelected}
        footer={
          <CardFooter
            artifactId={artifact.id}
            displayName={displayName}
            downloadName={artifact.name}
            url={url}
            isEdited={isEdited}
            onEdit={handleEdit}
            onRestore={isEdited ? handleRestore : undefined}
          />
        }
      >
        <div className="aspect-video bg-linear-to-br from-muted to-muted/50 flex flex-col items-center justify-center gap-4 p-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Music className="size-8 text-primary" />
          </div>
          <audio src={url} controls className="w-full" preload="metadata">
            Your browser does not support the audio element.
          </audio>
        </div>
      </MediaCard>

      <FileUploadDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        mediaType="audio"
        multiple={false}
        onConfirm={handleFileUpload}
      />
    </>
  );
}

// ============================================================================
// Image Card
// ============================================================================

function ImageCard({
  artifact,
  blueprintFolder,
  movieId,
  isSelected,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  onArtifactUpdated?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const displayName = shortenArtifactDisplayName(artifact.id);
  const isEdited = artifact.editedBy === "user";

  const handleEdit = () => setIsEditDialogOpen(true);

  const handleFileUpload = async (files: File[]) => {
    if (files.length === 0) return;
    await editArtifactFile(blueprintFolder, movieId, artifact.id, files[0]);
    onArtifactUpdated?.();
  };

  const handleRestore = async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, artifact.id);
      onArtifactUpdated?.();
    } catch (error) {
      console.error("[ImageCard] Restore failed:", error);
    }
  };

  return (
    <>
      <MediaCard
        isSelected={isSelected}
        footer={
          <CardFooter
            artifactId={artifact.id}
            displayName={displayName}
            downloadName={artifact.name}
            url={url}
            isEdited={isEdited}
            onExpand={() => setIsExpanded(true)}
            onEdit={handleEdit}
            onRestore={isEdited ? handleRestore : undefined}
          />
        }
      >
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="aspect-video w-full bg-black/50 flex items-center justify-center group relative overflow-hidden"
        >
          <img
            src={url}
            alt={displayName}
            className="w-full h-full object-contain"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <Maximize2 className="size-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </button>
      </MediaCard>

      <MediaDialog
        open={isExpanded}
        onOpenChange={setIsExpanded}
        title={displayName}
      >
        <img
          src={url}
          alt={displayName}
          className="w-full max-h-[70vh] object-contain rounded-lg"
        />
      </MediaDialog>

      <FileUploadDialog
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        mediaType="image"
        multiple={false}
        onConfirm={handleFileUpload}
      />
    </>
  );
}

// ============================================================================
// Text Card
// ============================================================================

function TextCard({
  artifact,
  blueprintFolder,
  movieId,
  isSelected,
  onArtifactUpdated,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
  isSelected: boolean;
  onArtifactUpdated?: () => void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);
  const displayName = shortenArtifactDisplayName(artifact.id);
  const isEdited = artifact.editedBy === "user";

  useEffect(() => {
    let cancelled = false;
    const loadContent = async () => {
      setIsLoading(true);
      try {
        const res = await fetch(url);
        const text = await res.text();
        if (!cancelled) {
          setContent(text);
        }
      } catch (error) {
        console.error("[TextCard] Failed to load content:", error);
        if (!cancelled) {
          setContent("Failed to load content");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    loadContent();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const handleEdit = () => setIsEditDialogOpen(true);

  const handleSaveEdit = async (newContent: string) => {
    setIsSaving(true);
    try {
      await editArtifactText(
        blueprintFolder,
        movieId,
        artifact.id,
        newContent,
        artifact.mimeType
      );
      setIsEditDialogOpen(false);
      onArtifactUpdated?.();
    } catch (error) {
      console.error("[TextCard] Edit failed:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleRestore = async () => {
    try {
      await restoreArtifact(blueprintFolder, movieId, artifact.id);
      onArtifactUpdated?.();
    } catch (error) {
      console.error("[TextCard] Restore failed:", error);
    }
  };

  const isJson = artifact.mimeType === "application/json";
  const displayContent = content
    ? isJson
      ? formatJson(content)
      : content.slice(0, 500) + (content.length > 500 ? "..." : "")
    : "";

  return (
    <>
      <MediaCard
        isSelected={isSelected}
        footer={
          <CardFooter
            artifactId={artifact.id}
            displayName={displayName}
            downloadName={artifact.name}
            url={url}
            isEdited={isEdited}
            onExpand={() => setIsExpanded(true)}
            onEdit={handleEdit}
            onRestore={isEdited ? handleRestore : undefined}
          />
        }
      >
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="aspect-video w-full bg-muted/30 p-3 text-left overflow-hidden group relative"
        >
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-muted-foreground text-sm">Loading...</span>
            </div>
          ) : (
            <>
              <pre className="text-xs text-muted-foreground font-mono whitespace-pre-wrap overflow-hidden h-full">
                {displayContent}
              </pre>
              <div className="absolute inset-0 bg-linear-to-t from-muted/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Maximize2 className="size-8 text-foreground" />
              </div>
            </>
          )}
        </button>
      </MediaCard>

      <ArtifactTextEditDialog
        key={isExpanded ? `view-${artifact.hash}` : "closed-view"}
        open={isExpanded}
        onOpenChange={setIsExpanded}
        title={displayName}
        content={content ?? ""}
        mimeType={artifact.mimeType}
        readOnly
      />

      <ArtifactTextEditDialog
        key={isEditDialogOpen ? `edit-${artifact.hash}` : "closed"}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
        title={displayName}
        content={content ?? ""}
        mimeType={artifact.mimeType}
        onSave={handleSaveEdit}
        isSaving={isSaving}
      />
    </>
  );
}

// ============================================================================
// Generic Card
// ============================================================================

function GenericCard({
  artifact,
  isSelected,
}: {
  artifact: ArtifactInfo;
  isSelected: boolean;
}) {
  const { isArtifactSelected, toggleArtifactSelection } = useExecution();
  const displayName = shortenArtifactDisplayName(artifact.id);
  const selected = isArtifactSelected(artifact.id);

  return (
    <MediaCard
      isSelected={isSelected}
      footer={
        <>
          <span className="text-xs text-foreground truncate flex-1" title={displayName}>
            {displayName}
          </span>
          <button
            type="button"
            onClick={() => toggleArtifactSelection(artifact.id)}
            className={cn(
              "p-1 rounded hover:bg-muted transition-colors",
              selected ? "text-primary" : "text-muted-foreground"
            )}
            title={selected ? "Deselect" : "Select for regeneration"}
          >
            <RefreshCw className="size-3" />
          </button>
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {artifact.mimeType}
          </span>
        </>
      }
    >
      <div className="aspect-video bg-muted/30 flex flex-col items-center justify-center gap-2">
        <File className="size-12 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {formatFileSize(artifact.size)}
        </span>
      </div>
    </MediaCard>
  );
}

// ============================================================================
// Media Dialog (for expanded view)
// ============================================================================

function MediaDialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
}) {
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
            {children}
          </div>
          <div className="px-4 pb-4">
            <p className="text-sm text-muted-foreground truncate">{title}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Utilities
// ============================================================================

function getBlobUrl(blueprintFolder: string, movieId: string, hash: string): string {
  if (!blueprintFolder || !movieId || !hash) {
    console.warn("[getBlobUrl] Missing required parameters:", {
      blueprintFolder: !!blueprintFolder,
      movieId: !!movieId,
      hash: !!hash,
    });
  }
  const params = new URLSearchParams({
    folder: blueprintFolder,
    movieId,
    hash,
  });
  return `/viewer-api/blueprints/blob?${params.toString()}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatJson(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}
