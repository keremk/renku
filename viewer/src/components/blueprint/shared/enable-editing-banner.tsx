import { Button } from "@/components/ui/button";

interface EnableEditingBannerProps {
  isEnabling: boolean;
  onEnableEditing: () => void;
}

/**
 * Banner shown when a build is read-only and editing can be enabled.
 * Shows an explanation and "Enable Editing" button.
 */
export function EnableEditingBanner({
  isEnabling,
  onEnableEditing,
}: EnableEditingBannerProps) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 mb-4">
      <div>
        <p className="text-sm font-medium text-foreground">Read-only</p>
        <p className="text-xs text-muted-foreground">
          This build was created via CLI. Enable editing to modify values.
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={onEnableEditing}
        disabled={isEnabling}
        className="h-8 px-3 text-xs border-amber-500/50 hover:bg-amber-500/20"
      >
        {isEnabling ? "Enabling..." : "Enable Editing"}
      </Button>
    </div>
  );
}
