/**
 * Dialog for switching between blueprints in the storage folder.
 */

import { useState, useCallback } from "react";
import { FolderOpen, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  fetchBlueprintsList,
  type BlueprintListItem,
} from "@/data/blueprint-client";
import { switchBlueprint } from "@/hooks/use-blueprint-route";

/**
 * Converts a kebab-case folder name to title case.
 * e.g., "my-first-blueprint" -> "My First Blueprint"
 */
function prettifyBlueprintName(name: string): string {
  return name
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

interface SwitchBlueprintDialogProps {
  currentBlueprintName: string;
}

export function SwitchBlueprintDialog({
  currentBlueprintName,
}: SwitchBlueprintDialogProps) {
  const [open, setOpen] = useState(false);
  const [blueprints, setBlueprints] = useState<BlueprintListItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadBlueprints = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchBlueprintsList();
      setBlueprints(response.blueprints);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load blueprints"
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen) {
        loadBlueprints();
      }
    },
    [loadBlueprints]
  );

  const handleSelect = useCallback(
    (name: string) => {
      if (name === currentBlueprintName) return;
      switchBlueprint(name);
      setOpen(false);
    },
    [currentBlueprintName]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <FolderOpen className="w-4 h-4" />
          Switch
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch Blueprint</DialogTitle>
          <DialogDescription>
            Select a blueprint to open.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <p className="text-sm text-destructive text-center py-4">
              {error}
            </p>
          )}

          {!isLoading && !error && blueprints.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No blueprints found.
            </p>
          )}

          {!isLoading &&
            !error &&
            blueprints.map((bp) => {
              const isCurrent = bp.name === currentBlueprintName;
              return (
                <button
                  key={bp.name}
                  onClick={() => handleSelect(bp.name)}
                  disabled={isCurrent}
                  className={`
                    w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left
                    transition-colors
                    ${
                      isCurrent
                        ? "bg-primary/10 cursor-default"
                        : "hover:bg-muted/50 cursor-pointer"
                    }
                  `}
                >
                  <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {prettifyBlueprintName(bp.name)}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {bp.name}
                    </p>
                  </div>
                  {isCurrent && (
                    <Check className="w-4 h-4 shrink-0 text-primary" />
                  )}
                </button>
              );
            })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
