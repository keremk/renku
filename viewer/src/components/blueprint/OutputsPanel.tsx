import { useState, useRef } from "react";
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
  // Determine which output is selected based on node ID
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

  // If we have artifacts, show them grouped by type
  if (artifacts.length > 0 && blueprintFolder && movieId) {
    return <ArtifactGallery artifacts={artifacts} blueprintFolder={blueprintFolder} movieId={movieId} />;
  }

  // Fallback: show output definitions without preview
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
          <OutputCard
            key={output.name}
            output={output}
            isSelected={isSelected}
          />
        );
      })}
    </div>
  );
}

function OutputCard({
  output,
  isSelected,
}: {
  output: BlueprintOutputDef;
  isSelected: boolean;
}) {
  return (
    <div
      className={`
        p-3 rounded-lg border transition-all
        ${
          isSelected
            ? "border-purple-400 bg-purple-500/10 ring-1 ring-purple-400/30"
            : "border-border/40 bg-muted/30"
        }
      `}
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

function ArtifactGallery({
  artifacts,
  blueprintFolder,
  movieId,
}: {
  artifacts: ArtifactInfo[];
  blueprintFolder: string;
  movieId: string;
}) {
  // Group artifacts by media type
  const images = artifacts.filter((a) => a.mimeType.startsWith("image/"));
  const videos = artifacts.filter((a) => a.mimeType.startsWith("video/"));
  const audio = artifacts.filter((a) => a.mimeType.startsWith("audio/"));
  const text = artifacts.filter((a) => a.mimeType.startsWith("text/") || a.mimeType === "application/json");
  const other = artifacts.filter(
    (a) =>
      !a.mimeType.startsWith("image/") &&
      !a.mimeType.startsWith("video/") &&
      !a.mimeType.startsWith("audio/") &&
      !a.mimeType.startsWith("text/") &&
      a.mimeType !== "application/json"
  );

  return (
    <div className="space-y-6">
      {videos.length > 0 && (
        <ArtifactSection title="Videos" count={videos.length}>
          <div className="grid grid-cols-1 gap-3">
            {videos.map((artifact) => (
              <VideoPreview
                key={artifact.id}
                artifact={artifact}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
              />
            ))}
          </div>
        </ArtifactSection>
      )}

      {audio.length > 0 && (
        <ArtifactSection title="Audio" count={audio.length}>
          <div className="space-y-2">
            {audio.map((artifact) => (
              <AudioPreview
                key={artifact.id}
                artifact={artifact}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
              />
            ))}
          </div>
        </ArtifactSection>
      )}

      {images.length > 0 && (
        <ArtifactSection title="Images" count={images.length}>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {images.map((artifact) => (
              <ImagePreview
                key={artifact.id}
                artifact={artifact}
                blueprintFolder={blueprintFolder}
                movieId={movieId}
              />
            ))}
          </div>
        </ArtifactSection>
      )}

      {text.length > 0 && (
        <ArtifactSection title="Text/JSON" count={text.length}>
          <div className="space-y-2">
            {text.map((artifact) => (
              <TextPreview
                key={artifact.id}
                artifact={artifact}
              />
            ))}
          </div>
        </ArtifactSection>
      )}

      {other.length > 0 && (
        <ArtifactSection title="Other" count={other.length}>
          <div className="space-y-2">
            {other.map((artifact) => (
              <GenericPreview key={artifact.id} artifact={artifact} />
            ))}
          </div>
        </ArtifactSection>
      )}
    </div>
  );
}

function ArtifactSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <span className="text-xs text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function getBlobUrl(blueprintFolder: string, movieId: string, hash: string): string {
  const params = new URLSearchParams({
    folder: blueprintFolder,
    movieId,
    hash,
  });
  return `/viewer-api/blueprints/blob?${params.toString()}`;
}

function ImagePreview({
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
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className="relative aspect-square rounded-lg overflow-hidden border border-border/40 bg-black/20 hover:border-primary/50 transition-colors group"
      >
        <img
          src={url}
          alt={artifact.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end">
          <div className="w-full p-1 bg-black/60 text-[10px] text-white truncate opacity-0 group-hover:opacity-100 transition-opacity">
            {artifact.name}
          </div>
        </div>
      </button>

      {isExpanded && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-8"
          onClick={() => setIsExpanded(false)}
        >
          <img
            src={url}
            alt={artifact.name}
            className="max-w-full max-h-full object-contain rounded-lg"
          />
        </div>
      )}
    </>
  );
}

function VideoPreview({
  artifact,
  blueprintFolder,
  movieId,
}: {
  artifact: ArtifactInfo;
  blueprintFolder: string;
  movieId: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const url = getBlobUrl(blueprintFolder, movieId, artifact.hash);

  return (
    <div className="rounded-lg overflow-hidden border border-border/40 bg-black">
      <video
        ref={videoRef}
        src={url}
        controls
        className="w-full max-h-64"
        preload="metadata"
      >
        Your browser does not support the video tag.
      </video>
      <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground truncate">
        {artifact.name}
      </div>
    </div>
  );
}

function AudioPreview({
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
    <div className="rounded-lg border border-border/40 bg-muted/30 p-3">
      <div className="text-xs text-foreground mb-2 truncate">{artifact.name}</div>
      <audio src={url} controls className="w-full h-8" preload="metadata">
        Your browser does not support the audio element.
      </audio>
    </div>
  );
}

function TextPreview({ artifact }: { artifact: ArtifactInfo }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-foreground truncate flex-1">{artifact.name}</span>
        <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          {artifact.mimeType}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        {formatFileSize(artifact.size)}
      </div>
    </div>
  );
}

function GenericPreview({ artifact }: { artifact: ArtifactInfo }) {
  return (
    <div className="rounded-lg border border-border/40 bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <span className="text-xs text-foreground truncate flex-1">{artifact.name}</span>
        <span className="text-[10px] text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
          {artifact.mimeType}
        </span>
      </div>
      <div className="text-[10px] text-muted-foreground mt-1">
        {formatFileSize(artifact.size)}
      </div>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
