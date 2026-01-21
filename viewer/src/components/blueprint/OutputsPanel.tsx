import { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Download,
  ExternalLink,
  Copy,
  Video,
  Music,
  Image as ImageIcon,
  FileText,
  File,
  Maximize2,
  X,
} from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { BlueprintOutputDef } from "@/types/blueprint-graph";
import type { ArtifactInfo } from "@/types/builds";

interface OutputsPanelProps {
  outputs: BlueprintOutputDef[];
  selectedNodeId: string | null;
  movieId: string | null;
  blueprintFolder: string | null;
  artifacts: ArtifactInfo[];
}

export function OutputsPanel({
  outputs,
  selectedNodeId,
  movieId,
  blueprintFolder,
  artifacts,
}: OutputsPanelProps) {
  const selectedOutputName = selectedNodeId?.startsWith("Output:")
    ? selectedNodeId.replace("Output:", "").split(".").pop()
    : null;

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
        isSelected
          ? "border-purple-400 bg-purple-500/10 ring-1 ring-purple-400/30"
          : "border-border/40 bg-muted/30"
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
// Artifact Gallery
// ============================================================================

function ArtifactGallery({
  artifacts,
  blueprintFolder,
  movieId,
}: {
  artifacts: ArtifactInfo[];
  blueprintFolder: string;
  movieId: string;
}) {
  const videos = artifacts.filter((a) => a.mimeType.startsWith("video/"));
  const audio = artifacts.filter((a) => a.mimeType.startsWith("audio/"));
  const images = artifacts.filter((a) => a.mimeType.startsWith("image/"));
  const text = artifacts.filter(
    (a) => a.mimeType.startsWith("text/") || a.mimeType === "application/json"
  );
  const other = artifacts.filter(
    (a) =>
      !a.mimeType.startsWith("image/") &&
      !a.mimeType.startsWith("video/") &&
      !a.mimeType.startsWith("audio/") &&
      !a.mimeType.startsWith("text/") &&
      a.mimeType !== "application/json"
  );

  return (
    <div className="space-y-4">
      {videos.length > 0 && (
        <ArtifactSection
          title="Videos"
          count={videos.length}
          icon={<Video className="size-4" />}
          defaultOpen
        >
          <ArtifactGrid>
            {videos.map((artifact) => (
              <VideoCard
                key={artifact.id}
                artifact={artifact}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
              />
            ))}
          </ArtifactGrid>
        </ArtifactSection>
      )}

      {audio.length > 0 && (
        <ArtifactSection
          title="Audio"
          count={audio.length}
          icon={<Music className="size-4" />}
          defaultOpen
        >
          <ArtifactGrid>
            {audio.map((artifact) => (
              <AudioCard
                key={artifact.id}
                artifact={artifact}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
              />
            ))}
          </ArtifactGrid>
        </ArtifactSection>
      )}

      {images.length > 0 && (
        <ArtifactSection
          title="Images"
          count={images.length}
          icon={<ImageIcon className="size-4" />}
          defaultOpen
        >
          <ArtifactGrid>
            {images.map((artifact) => (
              <ImageCard
                key={artifact.id}
                artifact={artifact}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
              />
            ))}
          </ArtifactGrid>
        </ArtifactSection>
      )}

      {text.length > 0 && (
        <ArtifactSection
          title="Text & JSON"
          count={text.length}
          icon={<FileText className="size-4" />}
          defaultOpen
        >
          <ArtifactGrid>
            {text.map((artifact) => (
              <TextCard
                key={artifact.id}
                artifact={artifact}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
              />
            ))}
          </ArtifactGrid>
        </ArtifactSection>
      )}

      {other.length > 0 && (
        <ArtifactSection
          title="Other"
          count={other.length}
          icon={<File className="size-4" />}
          defaultOpen={false}
        >
          <ArtifactGrid>
            {other.map((artifact) => (
              <GenericCard key={artifact.id} artifact={artifact} />
            ))}
          </ArtifactGrid>
        </ArtifactSection>
      )}
    </div>
  );
}

// ============================================================================
// Collapsible Section
// ============================================================================

function ArtifactSection({
  title,
  count,
  icon,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center gap-2 w-full group hover:bg-muted/50 rounded-lg px-2 py-1.5 transition-colors">
        <span className="text-muted-foreground">
          {isOpen ? (
            <ChevronDown className="size-4" />
          ) : (
            <ChevronRight className="size-4" />
          )}
        </span>
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium text-foreground">{title}</span>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
          {count}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================================================
// Responsive Grid
// ============================================================================

function ArtifactGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {children}
    </div>
  );
}

// ============================================================================
// Card Components
// ============================================================================

function ArtifactCard({
  children,
  footer,
  className,
}: {
  children: React.ReactNode;
  footer: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-card overflow-hidden flex flex-col",
        className
      )}
    >
      <div className="flex-1 min-h-0">{children}</div>
      <div className="border-t border-border bg-muted/50 px-3 py-2 flex items-center justify-between gap-2">
        {footer}
      </div>
    </div>
  );
}

function CardFooter({
  name,
  url,
  onExpand,
}: {
  name: string;
  url: string;
  onExpand?: () => void;
}) {
  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  };

  const handleCopyUrl = async () => {
    await navigator.clipboard.writeText(window.location.origin + url);
  };

  const handleOpenInNewTab = () => {
    window.open(url, "_blank");
  };

  return (
    <>
      <span className="text-xs text-foreground truncate flex-1" title={name}>
        {name}
      </span>
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
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);

  return (
    <>
      <ArtifactCard
        footer={
          <CardFooter
            name={artifact.name}
            url={url}
            onExpand={() => setIsExpanded(true)}
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
      </ArtifactCard>

      <MediaDialog
        open={isExpanded}
        onOpenChange={setIsExpanded}
        title={artifact.name}
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
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
}) {
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);

  return (
    <ArtifactCard
      footer={<CardFooter name={artifact.name} url={url} />}
    >
      <div className="aspect-video bg-gradient-to-br from-muted to-muted/50 flex flex-col items-center justify-center gap-4 p-4">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
          <Music className="size-8 text-primary" />
        </div>
        <audio src={url} controls className="w-full" preload="metadata">
          Your browser does not support the audio element.
        </audio>
      </div>
    </ArtifactCard>
  );
}

// ============================================================================
// Image Card
// ============================================================================

function ImageCard({
  artifact,
  blueprintFolder,
  movieId,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);

  return (
    <>
      <ArtifactCard
        footer={
          <CardFooter
            name={artifact.name}
            url={url}
            onExpand={() => setIsExpanded(true)}
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
            alt={artifact.name}
            className="w-full h-full object-contain"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
            <Maximize2 className="size-8 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </button>
      </ArtifactCard>

      <MediaDialog
        open={isExpanded}
        onOpenChange={setIsExpanded}
        title={artifact.name}
      >
        <img
          src={url}
          alt={artifact.name}
          className="w-full max-h-[70vh] object-contain rounded-lg"
        />
      </MediaDialog>
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
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);

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
      } catch {
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

  const isJson = artifact.mimeType === "application/json";
  const displayContent = content
    ? isJson
      ? formatJson(content)
      : content.slice(0, 500) + (content.length > 500 ? "..." : "")
    : "";

  return (
    <>
      <ArtifactCard
        footer={
          <CardFooter
            name={artifact.name}
            url={url}
            onExpand={() => setIsExpanded(true)}
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
              <div className="absolute inset-0 bg-gradient-to-t from-muted/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <Maximize2 className="size-8 text-foreground" />
              </div>
            </>
          )}
        </button>
      </ArtifactCard>

      <Dialog open={isExpanded} onOpenChange={setIsExpanded}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="truncate pr-8">{artifact.name}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto bg-muted/30 rounded-lg p-4">
            <pre className="text-sm font-mono whitespace-pre-wrap text-foreground">
              {content ?? "Loading..."}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ============================================================================
// Generic Card
// ============================================================================

function GenericCard({ artifact }: { artifact: ArtifactInfo }) {
  return (
    <ArtifactCard
      footer={
        <>
          <span className="text-xs text-foreground truncate flex-1" title={artifact.name}>
            {artifact.name}
          </span>
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
    </ArtifactCard>
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
