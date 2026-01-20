import type { BlueprintOutputDef } from "@/types/blueprint-graph";

interface OutputsPanelProps {
  outputs: BlueprintOutputDef[];
  selectedNodeId: string | null;
  movieId: string | null;
}

export function OutputsPanel({
  outputs,
  selectedNodeId,
  movieId,
}: OutputsPanelProps) {
  // Determine which output is selected based on node ID
  const selectedOutputName = selectedNodeId?.startsWith("Output:")
    ? selectedNodeId.replace("Output:", "").split(".").pop()
    : null;

  if (outputs.length === 0) {
    return (
      <div className="text-muted-foreground text-sm">
        No outputs defined in this blueprint.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!movieId && (
        <div className="text-muted-foreground text-xs bg-muted/30 p-2 rounded mb-4">
          Provide --movie-id or --last to view generated artifacts.
        </div>
      )}

      {outputs.map((output) => {
        const isSelected = selectedOutputName === output.name;

        return (
          <OutputCard
            key={output.name}
            output={output}
            isSelected={isSelected}
            movieId={movieId}
          />
        );
      })}
    </div>
  );
}

function OutputCard({
  output,
  isSelected,
  movieId,
}: {
  output: BlueprintOutputDef;
  isSelected: boolean;
  movieId: string | null;
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
        <p className="text-xs text-muted-foreground mb-2">{output.description}</p>
      )}

      {movieId && (
        <div className="mt-2 text-xs text-muted-foreground/60 italic">
          Artifact preview coming in Stage 3...
        </div>
      )}
    </div>
  );
}
