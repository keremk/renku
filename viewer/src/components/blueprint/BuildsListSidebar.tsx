import type { BuildInfo } from "@/types/builds";
import { updateBlueprintRoute } from "@/hooks/use-blueprint-route";

interface BuildsListSidebarProps {
  builds: BuildInfo[];
  selectedBuildId: string | null;
  isLoading: boolean;
}

export function BuildsListSidebar({
  builds,
  selectedBuildId,
  isLoading,
}: BuildsListSidebarProps) {
  const handleBuildSelect = (movieId: string) => {
    if (movieId === selectedBuildId) {
      // Deselect if clicking the same build
      updateBlueprintRoute(null);
    } else {
      updateBlueprintRoute(movieId);
    }
  };

  return (
    <div className="flex flex-col h-full bg-card/50 rounded-xl border border-border/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <h2 className="text-sm font-semibold text-foreground">Builds</h2>
        <span className="text-xs text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full">
          {builds.length}
        </span>
      </div>

      {/* Build list */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
            Loading...
          </div>
        ) : builds.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 text-center px-4">
            <p className="text-sm text-muted-foreground">No builds yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Run a generation to create builds
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {builds.map((build) => (
              <BuildCard
                key={build.movieId}
                build={build}
                isSelected={build.movieId === selectedBuildId}
                onSelect={() => handleBuildSelect(build.movieId)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface BuildCardProps {
  build: BuildInfo;
  isSelected: boolean;
  onSelect: () => void;
}

function BuildCard({ build, isSelected, onSelect }: BuildCardProps) {
  const relativeTime = getRelativeTime(build.updatedAt);

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`
        w-full text-left p-3 rounded-lg transition-colors
        ${
          isSelected
            ? "bg-primary/10 border border-primary/30"
            : "bg-background/50 border border-transparent hover:bg-muted/50 hover:border-border/50"
        }
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {build.movieId}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">{relativeTime}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {build.revision && (
            <span className="text-xs bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded">
              {build.revision}
            </span>
          )}
          {build.hasManifest && (
            <span className="w-2 h-2 rounded-full bg-green-500" title="Has manifest" />
          )}
        </div>
      </div>
    </button>
  );
}

/**
 * Converts an ISO date string to a relative time string (e.g., "2 hours ago").
 */
function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) {
    return "just now";
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;
  }

  const diffYears = Math.floor(diffMonths / 12);
  return `${diffYears} year${diffYears === 1 ? "" : "s"} ago`;
}
