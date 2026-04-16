
# Findings
Understood: no aliases, no lookup magic. Producer inputs that are wired to upstream nodes must resolve to those canonical upstream
  IDs (artifacts or global inputs). The intermediate Input:Producer.* placeholders should not survive into job inputs or sdkMapping
  when a connection exists.

  Findings (what’s broken)

  - The planner canonicalizes sdkMapping keys to Input:Producer.* and then mirrors them into inputBindings pointing back to
    themselves. For AudioProducer that yields Input:AudioProducer.TextInput -> Input:AudioProducer.TextInput, so the job has no path
    to Artifact:ScriptProducer.NarrationScript[0]. runtime.sdk.buildPayload therefore can’t find a value and throws.
  - This isn’t just AudioProducer: any connected producer input will emit a self-bound canonical key instead of the upstream canonical    source. We papered over it previously with alias lookups; the regression reintroduced the self-binding.

  Canonical-only architecture (uniform approach)
    (Artifact:ScriptProducer.NarrationScript[segment] or Input:Duration, etc.).
  - Connected inputs must not retain Input:Producer.* in the job’s inputs or bindings. They should list the upstream canonical IDs
    directly.
  - Unconnected inputs (selection/config like Input:AudioProducer.AudioProducer.model) remain as canonical Input:Producer.* because
  2. sdkMapping uses those canonical sources

  - When normalizing sdkMapping, map each field to the canonical upstream ID determined above. If a mapping key already is canonical
    and matches the upstream, keep it; otherwise replace it with the upstream canonical.
  - If a mapping entry cannot be tied to a canonical source (no edge, no declared input), fail fast—no self-binding, no heuristics.

  3. Job inputs and context

  - job.inputs should be the set of canonical sources the job actually needs: upstream artifacts, global inputs, and any unconnected
    Input:Producer.* config keys.
  - context.inputBindings becomes a straightforward alias map from logical input names to their canonical sources (never to
    themselves). For connected inputs, the target is the upstream canonical ID; for config inputs, the target is the canonical config
    input ID.
  - Eliminate the practice of adding Input:Producer.* mirrors for connected inputs.

  4. Runner/runtime expectations

  - With the above, resolvedInputs will contain actual upstream values under the same canonical IDs that sdkMapping references, so
    runtime.sdk.buildPayload can succeed without alias fallback.
  - readResolvedValue trims prefixes today; we can leave it for backward safety, but the primary path should rely on exact canonical
    IDs after this change.

  Edge cases to address explicitly

  - Fan-in: the canonical input for a collected list stays Input:Producer.InputName with a fan-in descriptor; sdkMapping should
    reference that canonical ID, and the runner populates the aggregated value—no aliases.
  - Dimensions/loops: per-segment connections must yield index-aware canonical IDs (e.g., Artifact:ScriptProducer.NarrationScript[2])
    in both job.inputs and sdkMapping.
  - Optional/unconnected producer inputs: remain canonical Input:Producer.*; if missing at runtime, they fail as expected.
  - Config/selection keys from provider options (provider, model, etc.) stay as canonical Input:Producer.Producer.*; they’re not
    connected and must be supplied by inputs/events.
  - Mixed inputs (one connected, one defaulted) should only carry Input:Producer.* for the defaulted ones, never for the connected
    ones.

  Concrete plan to implement (after approval)

  1. Audit canonical-expander and planner: ensure collapse/build of inputBindings derives connected bindings from edges and excludes
     self-bindings for connected inputs; confirm job.inputs contains only canonical sources.
  2. Update planner.normalizeSdkMapping logic to remap sdkMapping keys to the canonical sources from inputBindings (or error if none),
     dropping any self-references.
  3. Adjust provider-context/runner if needed to stop injecting mirror entries for connected inputs.
  4. Add tests:
      - Planner test with a producer input connected to an upstream artifact asserting inputBindings and sdkMapping use that artifact
        ID, not Input:Producer.*.
      - Fan-in test ensuring aggregated canonical input is used for sdkMapping.
      - Regression test for the AudioProducer path (TextInput wired to NarrationScript) verifying the emitted plan and that
        runtime.sdk.buildPayload succeeds with resolved artifacts.

  Let me know if this architecture matches your intent; I’ll then apply it end-to-end with the guardrails above.


# Refactor Summary
- 1:1 edge: If a producer input has exactly one upstream edge, that input is replaced by the upstream canonical ID in job.inputs
    and in inputBindings/sdkMapping. Example: AudioProducer.TextInput -> Artifact:ScriptProducer.NarrationScript[0]. In the job: no
    Input:AudioProducer.TextInput survives; instead everything points to Artifact:ScriptProducer.NarrationScript[0].
  - Fan-in (many->one): The input represents an aggregation, not a single source. We keep the canonical aggregated input (e.g.,

  What the job carries for fan-in

  - job.inputs: includes the canonical aggregated input ID (Input:TimelineComposer.VideoSegments). We do NOT replace it with any
    single artifact ID because it’s many->one.
  - job.context.fanIn: a map describing the aggregation for that input, e.g.:
      - key: Input:TimelineComposer.VideoSegments
      - value: { groupBy: "segment", members: [{ id: "Artifact:VideoProducer.SegmentVideo[0]", group: 0 }, { id:
        "Artifact:VideoProducer.SegmentVideo[1]", group: 1 }, …] }
  - No aliases/self-bindings are added. The fan-in descriptor is the canonical linkage to upstream artifacts.

  What the runner provides at runtime for fan-in

  - It resolves each member artifact ID to its payload and stores those in resolvedInputs keyed by the artifact IDs (e.g.,
    Artifact:VideoProducer.SegmentVideo[0] → blob data).
  - It also injects the grouped collection under the aggregated input key, e.g. resolvedInputs['Input:TimelineComposer.VideoSegments']
    = { groupBy: 'segment', groups: [['Artifact:VideoProducer.SegmentVideo[0]'], ['Artifact:VideoProducer.SegmentVideo[1]'], …] }.
  - So the provider sees:
      - The aggregated, canonical input value at Input:TimelineComposer.VideoSegments.
      - Each upstream artifact value keyed by its canonical artifact ID.
  - No aliases, no lookups: everything is canonical and explicit.

  What sdkMapping should use

  - For 1:1: map directly to the upstream canonical artifact/input (e.g., Artifact:ScriptProducer.NarrationScript[0]).
  - For fan-in: map to the aggregated canonical input (Input:TimelineComposer.VideoSegments). If the producer needs blobs, it can read
    the artifact IDs from that grouped structure and then use the artifact entries already present in resolvedInputs.

  Why we keep the aggregated input in fan-in

  - It’s the only canonical handle for the collection; there is no single upstream artifact to substitute.
  - Removing it would lose grouping metadata and break the many->one aggregation contract.

  Edge cases called out

  - Mixed: a producer can have both 1:1 inputs (collapsed to artifacts) and fan-in inputs (keep the aggregated canonical ID).
  - Dimensions/loops: fan-in members carry indexed canonical IDs (e.g., Artifact:VideoProducer.SegmentVideo[2]); the aggregated input
    remains Input:TimelineComposer.VideoSegments with grouped member IDs.
  - Unconnected config/selection inputs: stay as Input:Producer.* canonical IDs (they’re true inputs, not connections).


# Overall approach

  - Keep the architecture but cleanly split the work into: Stage 1 (Parsing), Stage 2 (Graph Resolution), Stage 3 (Planning). Remove
    alias/self-binding behavior. Everything uses canonical IDs; connected 1:1 inputs collapse to upstream artifacts; fan-in keeps the
    aggregated canonical input with explicit member artifacts.

  Stage 1: Parsing (structure only, no connections yet)

  - Inputs parsed:
      - Blueprint YAMLs (blueprint documents, modules) → inputs, artifacts, producers.
      - Producer YAMLs → model variants, sdkMapping, outputs, schemas, config defaults.
      - User inputs (inputs.yaml) + implicit inputs (MovieId, StorageRoot, StorageBasePath, etc.).
  - Outputs:
      - Canonical node inventory: Input:*, Artifact:*, Producer:* (with namespace, indices/dimensions known).
      - Producer declared inputs/outputs stored structurally (no edges yet).
      - Canonical ID helpers well-tested: formatCanonicalInputId, producer-scoped input IDs, dimension handling.
  - Tests to add/strengthen:
      - Parsing a blueprint with namespaces/loops produces correct canonical IDs for inputs/artifacts/producers.
      - Producer YAML variant parsing preserves sdkMapping/output schema, config defaults, and canonicalizes model/provider casing.
      - Implicit inputs are present and canonical.

  Stage 2: Graph Resolution (connect + normalize)

  - Responsibilities:
      - Resolve declared connections into edges between canonical nodes.
      - Collapse 1:1 producer inputs to upstream canonical sources: job inputs use the artifact/input IDs, not Input:Producer.*.
      - Fan-in: keep aggregated canonical input; attach fan-in descriptor with member artifact canonical IDs (group/order). No
        aliases.
      - Build inputBindings for each producer: logical input name → canonical source (artifact/global input for 1:1; aggregated input
        for fan-in; Input:Producer.* only for unconnected config/selection inputs).
      - Normalize sdkMapping to the same canonical sources (no self-binding).
      - Produce a resolved graph ready for planning: nodes with concrete inputs, produces, inputBindings, sdkMapping, fanIn
        descriptors, schemas/config attached.
  - Tests to add/strengthen:
      - 1:1: AudioProducer.TextInput → ScriptProducer.NarrationScript[segment] yields inputs/bindings/sdkMapping all pointing to the
        artifact ID.
      - Fan-in: TimelineComposer.VideoSegments keeps aggregated input, fan-in members list VideoProducer.SegmentVideo[*], sdkMapping
        uses the aggregated input.
      - Mixed: a producer with both connected and unconnected inputs keeps only the unconnected ones as Input:Producer.*.
      - Dimensions/loops: indices propagate correctly (e.g., [2]).
      - Missing bindings: resolution fails fast (no self-binding).
      - Config/selection inputs remain canonical Input:Producer.Producer.* when not connected.

  Stage 3: Planning (topology + dirtiness)

  - Responsibilities:
      - Kahn/topological layering over the resolved graph.
      - Dirty detection unchanged but operating on resolved canonical inputs/artifacts.
      - Emit execution plan with resolved job.inputs, inputBindings, sdkMapping, fanIn, schemas, config, outputs.
  - Tests to add/strengthen:
      - Topology respects dependencies after collapse (VideoProducer after VideoPrompt; AudioProducer after Script).
      - Dirty detection triggers reruns when upstream inputs/artifacts change.
      - Plan serialization keeps canonical IDs (snapshot test for the AudioProducer case).

  Cleanup/renames

  - Remove alias/self-binding code paths and dead fallback logic.
  - Clarify function names around parsing vs resolution vs planning; separate modules per stage.
  - Keep readResolvedValue for safety but ensure primary path uses exact canonical IDs.

  Execution order

  1. Introduce clearer separation (files/modules) for Stage 1 vs 2 vs 3; move existing logic accordingly.
  2. Implement resolution rules (1:1 collapse, fan-in handling) and update planner normalization to use resolved bindings.
  3. Update provider/runtime expectations if needed (should already align once the plan emits correct canonical IDs).
  4. Add/expand tests described above.

  If this matches your expectations, I’ll proceed with the refactor and the test suite additions in that order.


  # Stages
  Stage 1 – Parsing isolation and hardening

  - Refactor/organize code so parsing is a clean unit: blueprint YAML → canonical node inventory (inputs, artifacts, producers),
    producer YAML variants (sdkMapping/outputs/schemas/config), implicit inputs (MovieId, StorageRoot, StorageBasePath, etc.), and
    canonical ID helpers.
  - No connections or collapsing here; just structural data with namespaces/dimensions resolved.
  - Add/strengthen tests:
      - Canonical ID generation (namespaces, loops/indices).
      - Producer variant parsing (sdkMapping, outputs, schemas, config defaults, casing).
      - Implicit inputs presence and canonicalization.
  - Output: a well-defined “parsed blueprint” structure with canonical nodes/metadata, no edges resolved.
  - Summary to deliver after Stage 1: what was moved/renamed, what the parsed structure looks like, test coverage added, and any gaps
    or questions for Stage 2.

  Stage 2 – Graph resolution and planning (collapse + plan)

  - Consume the parsed structure and resolve connections:
      - 1:1: collapse connected producer inputs to upstream canonical artifacts/inputs; eliminate self-bound Input:Producer.*.
      - Fan-in: keep aggregated canonical input; attach fan-in descriptor with member artifact IDs; sdkMapping targets the aggregated
        input.
      - Build inputBindings and sdkMapping using resolved canonical sources; unconnected config/selection inputs remain
        Input:Producer.*.
      - Fail fast on missing bindings; ensure dimensioned/looped IDs carry indices.
  - Planning: run topology (Kahn), dirty detection, and emit execution plan using resolved canonical IDs (job.inputs, inputBindings,
    sdkMapping, fanIn, schemas/config/outputs).
  - Add/strengthen tests:
      - 1:1 collapse (AudioProducer.TextInput → ScriptProducer.NarrationScript[segment]) reflected in plan.
      - Fan-in aggregation (TimelineComposer.VideoSegments) keeps aggregated input with member artifacts; sdkMapping uses aggregated
        canonical input.
      - Mixed connected/unconnected inputs; dimensions/loops; failure on missing bindings; dirty detection still correct.
      - Snapshot-style plan test for the AudioProducer case to prove canonical IDs flow end-to-end.
  - Summary to deliver after Stage 2: changes made, guarantees achieved (no aliases/self-bindings), test matrix results, and any
    follow-ups.

  If you want this as three stages, I can split Stage 2 into (a) Resolution and (b) Planning/tests; otherwise I’ll proceed with the
  two-stage plan above and provide the Stage 1 summary before moving to Stage 2.