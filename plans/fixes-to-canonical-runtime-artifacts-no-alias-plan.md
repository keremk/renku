Here is the architecturally pure implementation checklist, using the repo’s intended terminology exactly:

- Artifact:... = the one persisted artifact identity
- Input:... and Output:... = connectors only
- jobs produce only Artifact:...
- root output discovery must use explicit Output -> source bindings, never name matching

Target State

We want two clean contracts, not one overloaded one:

- Runtime contract: jobs, planner, runner, manifest, event log all deal only in canonical Artifact:... and Input:... IDs.
- Blueprint interface contract: output connectors are resolved explicitly as Output:... -> Input:... | Artifact:....

That means this shape:

Producer:SegmentUnit.MainVideo
  -> Artifact:SegmentUnit.MainVideo.GeneratedVideo
  -> Output:SegmentUnit.Video
  -> Output:Movie

must be represented as:

- one real artifact: Artifact:SegmentUnit.MainVideo.GeneratedVideo
- two connector bindings:
    - Output:SegmentUnit.Video -> Artifact:SegmentUnit.MainVideo.GeneratedVideo
    - Output:Movie -> Artifact:SegmentUnit.MainVideo.GeneratedVideo

Never as “three produced artifacts.”

———

Exact Type Changes

I would make these type changes first, because they force the rest of the code to stay honest.

- In core/src/types.ts:531, keep ProducerJobContext.produces and JobDescriptor.produces as Artifact:... only by convention and comment. Do not widen them to include
  Output:....
- In core/src/resolution/canonical-expander.ts:48, replace the artifact-only output binding shape with a source-based one. I would rename, not just tweak, because the
  current names encode the wrong idea.

Proposed shape:

export interface OutputConnectorBinding {
  outputId: string;   // canonical Output:...
  sourceId: string;   // canonical Input:... or Artifact:...
  conditions?: EdgeConditionDefinition;
  indices?: Record<string, number>;
}

export interface CanonicalBlueprint {
  nodes: CanonicalNodeInstance[];
  edges: CanonicalEdgeInstance[];
  inputBindings: Record<string, Record<string, string>>;
  outputSources: Record<string, string>; // Output:... -> Input:... | Artifact:...
  outputSourceBindings: OutputConnectorBinding[];
  fanIn: Record<string, FanInDescriptor>;
}

Why rename:

- outputBindings currently sounds generic, but in practice callers have treated it as “output -> artifact.”
- artifactId is now definitely wrong if Output:Duration -> Input:Duration is valid.
- outputSources / sourceId makes the contract explicit and prevents the same bug from coming back.
- In core/src/types.ts:557, extend ExecutionPlan with root output interface metadata, separate from jobs:

export interface RootOutputBinding {
  outputId: string; // root-level Output:...
  sourceId: string; // canonical Input:... or Artifact:...
}

export interface ExecutionPlan {
  revision: RevisionId;
  manifestBaseHash: string;
  layers: JobDescriptor[][];
  createdAt: IsoDatetime;
  blueprintLayerCount: number;
  rootOutputBindings?: RootOutputBinding[];
}

This is the clean boundary:

- layers stays runtime-only
- rootOutputBindings carries blueprint-interface metadata for the CLI/UI
- In cli/src/commands/generate.ts:66, replace the guessed single-output field with an explicit materialized-output list:

export interface MaterializedRootOutput {
  outputId: string;    // Output:Movie
  artifactId: string;  // Artifact:SegmentUnit.MainVideo.GeneratedVideo
  artifactPath: string;
  mimeType?: string;
}

export interface GenerateResult {
  ...
  rootOutputs?: MaterializedRootOutput[];
}

I would remove finalOutputPath rather than preserve it with a new guess. If the product wants a single “primary output” later, that should be a first-class blueprint
rule, not inference.

———

File-by-File Checklist

core/src/resolution/canonical-expander.ts:56

- Rename CanonicalOutputBinding.artifactId to sourceId.
- Rename outputBindings to outputSources.
- Rename outputBindingDescriptors to outputSourceBindings.
- Update resolveOutputBinding() so an Output connector may resolve from:
    - Artifact
    - Input
    - another Output
- Keep all current fail-fast rules:
    - missing source
    - multiple inbound bindings
    - cycles
    - groupBy / orderBy on output inbound edges
- Update normalizeCollapsedInputBindings() so:
    - if an input binding points to Output:...
    - it resolves to the exact upstream Input:... or Artifact:...
    - no fake artifact ID is synthesized

Example after this change:

- Input:Duration -> Output:MovieDuration
- outputSources['Output:MovieDuration'] === 'Input:Duration'

core/src/resolution/producer-binding-summary.ts:282

- Keep Output resolution recursive and transparent.
- Ensure the only returned source kinds remain:
    - input
    - artifact
- Never return output as a final binding kind.
- If there is any other viewer/helper path still doing direct source-type switching, align it to this same rule.

Expected outcome:

- Output:SharedImage -> Artifact:ImageSource.GeneratedImage
- producer binding summaries surface Artifact:ImageSource.GeneratedImage
- no “unsupported Output source node” error

core/src/resolution/producer-graph.ts:28

- Keep produces as canonical artifact IDs only.
- Replace every artifact-only assumption over canonical.outputBindings with the renamed canonical.outputSources.
- In computeConnectedArtifacts(), only add an output source if sourceId is actually an Artifact:....
- Do not ever add Output:... to produces.
- Do not put root output connector names back into the job contract.

This is where the third regression is fixed correctly:
the job still produces the one real artifact, and the root output name is carried separately in rootOutputBindings.

core/src/orchestration/planning-service.ts:89

- After expandBlueprintResolutionContext(...), collect root-level output bindings from the expanded canonical graph.
- Root-level means Output: connectors with empty namespace path.
- Add a helper such as collectRootOutputBindings(canonical) that returns:
    - Output:Movie -> Artifact:SegmentUnit.MainVideo.GeneratedVideo
    - or Output:Duration -> Input:Duration
- Attach that result to plan.rootOutputBindings before the plan is returned/persisted.

Why here:

- planning service already has both the expanded canonical graph and the execution plan
- it is the cleanest place to bridge runtime metadata and blueprint-interface metadata
- the lower-level planner should remain focused on scheduling, not blueprint interface semantics

core/src/types.ts:550

- Add RootOutputBinding.
- Extend ExecutionPlan.
- Add comments that produces must stay canonical Artifact:... IDs only.
- This is worth being explicit about because the old regression came from contract drift.

cli/src/lib/planner.ts:68

- No major logic change should be needed.
- Just pass through the richer ExecutionPlan with rootOutputBindings.
- If there are any local result types duplicating ExecutionPlan assumptions, update them to carry the new metadata transparently.

cli/src/lib/artifacts-view.ts:24

- Add a new helper that resolves materialized root outputs by exact canonical IDs, not names.

Suggested helper:

export function resolveMaterializedRootOutputs(args: {
  rootOutputBindings: RootOutputBinding[];
  artifacts: ArtifactInfo[];
}): MaterializedRootOutput[]

Rules:

- For each rootOutputBinding:
    - if sourceId is Artifact:..., find the exact matching artifact entry by canonical ID
    - if sourceId is Input:..., it is not a materialized artifact, so it does not produce an artifactPath
- No substring checks
- No “pick the first video”
- No FinalVideo / FinalAudio special cases
- No fallback inference

This is the place where findFinalOutput() should disappear entirely.

cli/src/commands/generate.ts:228

- Delete findFinalOutput().
- Remove finalOutputPath from GenerateResult.
- After building the artifacts view, call resolveMaterializedRootOutputs(...) using:
    - queryResult.plan.rootOutputBindings or equivalent plan metadata
    - artifacts.artifacts
- Return rootOutputs instead.

This gives the CLI an explicit contract like:

rootOutputs: [
  {
    outputId: 'Output:Movie',
    artifactId: 'Artifact:SegmentUnit.MainVideo.GeneratedVideo',
    artifactPath: '/.../Movie.mp4',
    mimeType: 'video/mp4'
  }
]

That is exact, canonical, and free of heuristics.

cli/src/commands/execute.ts:79

- If the caller needs access to root output metadata immediately after planning, consider returning the plan itself or the root bindings through ExecuteResult.
- If not, this file may not need much change.
- The important thing is that runGenerate() can access plan.rootOutputBindings without reconstructing anything from names.

———

Contract For Root Output Resolution

This is the contract I would use, because it cleanly separates blueprint interface from runtime materialization.

1. Planning-time blueprint interface contract

Stored on the plan:

interface RootOutputBinding {
  outputId: string; // root-level Output:...
  sourceId: string; // canonical Input:... or Artifact:...
}

Examples:

- Output:Movie -> Artifact:SegmentUnit.MainVideo.GeneratedVideo
- Output:Duration -> Input:Duration

What this means:

- every root output connector has one exact canonical source
- the source is either an input connector or an artifact
- the contract is exact and machine-resolvable

2. Post-build materialized-output contract

Derived in CLI from rootOutputBindings + manifest/materialized artifacts:

interface MaterializedRootOutput {
  outputId: string;    // root-level Output:...
  artifactId: string;  // exact canonical Artifact:...
  artifactPath: string;
  mimeType?: string;
}

Examples:

- Output:Movie resolves to a materialized artifact entry
- Output:Duration does not, because it is input-backed and not an artifact on disk

That means the CLI can truthfully say:

- “These root outputs materialized as files”
- without pretending every output connector becomes a file

———

What Must Be Deleted

These are the specific anti-patterns I would remove, not preserve:

- findFinalOutput() substring matching in cli/src/commands/generate.ts:441
- any logic that treats Output:... as if it belongs in job.produces
- any artifact-only field name for output connector resolution such as artifactId when the source can be Input:...
- any “single final output” inference unless there is an explicit blueprint-level rule declaring one

———

Tests To Add

core/src/resolution/canonical-expander.test.ts:1

- Input -> Output passthrough resolves to exact Input:...
- Output -> Output -> Artifact resolves to exact Artifact:...
- output cycle fails fast
- multiple upstream output bindings fail fast

core/src/resolution/producer-binding-summary.test.ts:1

- producer input fed from an output connector resolves to the upstream canonical source
- source kind is still only input or artifact

core/src/resolution/producer-graph.test.ts:1

- produces contains only Artifact:...
- root output connectors never appear in produces
- artifact-backed root outputs still mark their source artifact as connected

core/src/orchestration/planning-service.test.ts:1

- generated plan includes exact rootOutputBindings
- input-backed root outputs stay input-backed
- artifact-backed root outputs stay artifact-backed

cli/src/lib/artifacts-view.ts:1 or a new test beside it

- exact canonical artifact ID lookup resolves materialized root outputs
- no name-based matching exists

cli/src/commands/generate.test.ts:1

- GenerateResult.rootOutputs is populated from plan metadata plus exact artifact ID matching
- no FinalVideo / FinalAudio convention is required

———

Recommended Order

1. Change the expander types and names first.
2. Fix output connector resolution to return exact source IDs.
3. Update producer graph so produces stays artifact-only.
4. Add rootOutputBindings at planning-service level.
5. Replace CLI final-output guessing with exact root-output materialization.
6. Update tests around each boundary.
7. Finish with pnpm test from the repo root.

If you want, the next step can be a surgical implementation plan by commit, so each commit stays reviewable and isolated.