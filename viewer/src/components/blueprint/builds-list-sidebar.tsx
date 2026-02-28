import { useState, useCallback } from "react";
import { Loader2, Plus, Pencil, Check, X, Trash2 } from "lucide-react";
import type { BuildInfo } from "@/types/builds";
import { updateBlueprintRoute } from "@/hooks/use-blueprint-route";
import { useExecution } from "@/contexts/execution-context";
import { createBuild, updateBuildMetadata, deleteBuild } from "@/data/blueprint-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

interface BuildsListSidebarProps {
  builds: BuildInfo[];
  selectedBuildId: string | null;
  isLoading: boolean;
  blueprintFolder: string | null;
  onRefresh?: () => Promise<void>;
}

export function BuildsListSidebar({
  builds,
  selectedBuildId,
  isLoading,
  blueprintFolder,
  onRefresh,
}: BuildsListSidebarProps) {
  const { state } = useExecution();
  const isExecuting = state.status === 'executing';
  const [isCreating, setIsCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newBuildName, setNewBuildName] = useState("");
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingBuild, setDeletingBuild] = useState<BuildInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleBuildSelect = (movieId: string) => {
    if (movieId === selectedBuildId) {
      // Deselect if clicking the same build
      updateBlueprintRoute(null);
    } else {
      updateBlueprintRoute(movieId);
    }
  };

  const handleCreateBuild = useCallback(async () => {
    if (!blueprintFolder) return;

    setIsCreating(true);
    try {
      const result = await createBuild(blueprintFolder, newBuildName || undefined);
      // Refresh the builds list
      await onRefresh?.();
      // Select the new build
      updateBlueprintRoute(result.movieId);
      // Close dialog
      setShowCreateDialog(false);
      setNewBuildName("");
    } catch (error) {
      console.error("Failed to create build:", error);
    } finally {
      setIsCreating(false);
    }
  }, [blueprintFolder, newBuildName, onRefresh]);

  const handleDisplayNameUpdate = useCallback(
    async (movieId: string, displayName: string) => {
      if (!blueprintFolder) return;

      try {
        await updateBuildMetadata(blueprintFolder, movieId, displayName);
        // Refresh the builds list to show the updated name
        await onRefresh?.();
      } catch (error) {
        console.error("Failed to update build name:", error);
      }
    },
    [blueprintFolder, onRefresh]
  );

  const handleRequestDelete = useCallback((build: BuildInfo) => {
    setDeletingBuild(build);
    setShowDeleteDialog(true);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!blueprintFolder || !deletingBuild) return;

    setIsDeleting(true);
    try {
      await deleteBuild(blueprintFolder, deletingBuild.movieId);
      await onRefresh?.();
      // Deselect if the deleted build was selected
      if (deletingBuild.movieId === selectedBuildId) {
        updateBlueprintRoute(null);
      }
      setShowDeleteDialog(false);
      setDeletingBuild(null);
    } catch (error) {
      console.error("Failed to delete build:", error);
    } finally {
      setIsDeleting(false);
    }
  }, [blueprintFolder, deletingBuild, selectedBuildId, onRefresh]);

  return (
    <div className="flex flex-col h-full bg-sidebar-bg rounded-[var(--radius-panel)] border border-sidebar-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[45px] border-b border-border/40 bg-sidebar-header-bg shrink-0">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Builds</h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full font-medium">
            {builds.length}
          </span>
          {blueprintFolder && (
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={() => setShowCreateDialog(true)}
              title="Create new build"
            >
              <Plus className="w-4 h-4" />
            </Button>
          )}
        </div>
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
              {blueprintFolder
                ? "Click + to create a build"
                : "Run a generation to create builds"}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {builds.map((build) => (
              <BuildCard
                key={build.movieId}
                build={build}
                isSelected={build.movieId === selectedBuildId}
                isExecuting={isExecuting && build.movieId === selectedBuildId}
                onSelect={() => handleBuildSelect(build.movieId)}
                onUpdateDisplayName={(name) =>
                  handleDisplayNameUpdate(build.movieId, name)
                }
                onDelete={() => handleRequestDelete(build)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Build Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[400px] p-0 gap-0 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Create New Build</DialogTitle>
          </DialogHeader>
          <div className="px-6 py-6">
            <label className="text-sm font-medium text-foreground">
              Display Name (optional)
            </label>
            <Input
              value={newBuildName}
              onChange={(e) => setNewBuildName(e.target.value)}
              placeholder="e.g., Test Run, Final Version"
              className="mt-2"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !isCreating) {
                  handleCreateBuild();
                }
              }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              A friendly name to identify this build. You can change it later.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateBuild} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Build"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Build Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={(open) => {
        if (!open) {
          setShowDeleteDialog(false);
          setDeletingBuild(null);
        }
      }}>
        <DialogContent className="sm:max-w-[400px] p-0 gap-0 overflow-hidden">
          <DialogHeader>
            <DialogTitle>Delete Build</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium">
                {deletingBuild?.displayName || deletingBuild?.movieId}
              </span>
              ? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setShowDeleteDialog(false);
                setDeletingBuild(null);
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface BuildCardProps {
  build: BuildInfo;
  isSelected: boolean;
  isExecuting: boolean;
  onSelect: () => void;
  onUpdateDisplayName: (name: string) => Promise<void>;
  onDelete: () => void;
}

function BuildCard({
  build,
  isSelected,
  isExecuting,
  onSelect,
  onUpdateDisplayName,
  onDelete,
}: BuildCardProps) {
  const relativeTime = getRelativeTime(build.updatedAt);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(build.displayName ?? "");
  const [isSaving, setIsSaving] = useState(false);

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(build.displayName ?? "");
    setIsEditing(true);
  };

  const handleSave = async (e: React.MouseEvent | React.FormEvent) => {
    e.stopPropagation();
    if (isSaving || !editName.trim()) return;

    setIsSaving(true);
    try {
      await onUpdateDisplayName(editName.trim());
      setIsEditing(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(false);
    setEditName(build.displayName ?? "");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave(e);
    } else if (e.key === "Escape") {
      setIsEditing(false);
      setEditName(build.displayName ?? "");
    }
  };

  return (
    <button
      type="button"
      onClick={isEditing ? undefined : onSelect}
      className={`
        group/card relative w-full text-left p-3 rounded-lg border transition-colors
        ${
          isSelected
            ? "bg-item-active-bg border-item-active-border"
            : "bg-transparent border-transparent hover:bg-item-hover-bg hover:border-border/50"
        }
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div
              className="flex items-center gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                className="h-6 text-sm px-2 py-0"
                autoFocus
                placeholder="Enter name..."
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving || !editName.trim()}
                className="p-1 hover:bg-muted rounded disabled:opacity-50"
              >
                <Check className="w-3 h-3 text-green-500" />
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="p-1 hover:bg-muted rounded"
              >
                <X className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 group">
              <p className="text-sm font-medium text-foreground truncate">
                {build.displayName || build.movieId}
              </p>
              <button
                type="button"
                onClick={handleEditClick}
                className="p-0.5 hover:bg-muted rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="Edit name"
              >
                <Pencil className="w-3 h-3 text-muted-foreground" />
              </button>
            </div>
          )}
          {/* Show movieId below if there's a display name */}
          {build.displayName && !isEditing && (
            <p className="text-xs text-muted-foreground/70 truncate">
              {build.movieId}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">{relativeTime}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {build.revision && (
            <span className="text-xs bg-muted/70 text-muted-foreground px-1.5 py-0.5 rounded">
              {build.revision}
            </span>
          )}
          <div className="flex items-center gap-1">
            {isExecuting ? (
              <span title="Executing">
                <Loader2 className="w-3 h-3 animate-spin text-blue-500" />
              </span>
            ) : build.hasManifest ? (
              <span
                className="w-2 h-2 rounded-full bg-green-500"
                title="Has manifest"
              />
            ) : null}
            {build.hasInputsFile && !build.hasManifest && (
              <span
                className="w-2 h-2 rounded-full bg-amber-500"
                title="Has inputs (not run yet)"
              />
            )}
          </div>
        </div>
      </div>
      {!isExecuting && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute bottom-2 right-2 p-0.5 hover:bg-muted rounded opacity-0 group-hover/card:opacity-100 transition-opacity"
          title="Delete build"
        >
          <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
        </button>
      )}
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
