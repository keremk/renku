# Output Connectors, Runtime Artifacts, and the Planner Fix

## Why this document exists

The earlier explanation used too many overlapping terms.

That made a hard architectural issue sound fuzzier than it really is.

This document uses one term for each concept, defines each term in plain language, and then uses those same terms consistently throughout.

The goal is to answer three questions clearly:

1. What exactly is broken today?
2. What should the architecture be instead?
3. What is the clean plan to get there without hacks or fallbacks?

---

## Terminology

This section is the vocabulary for the rest of the document.

If a term is not defined here, I should not rely on it later.

### 1. Canonical ID

A **canonical ID** is the exact internal ID the system uses.

Examples:

- `Input:Duration`
- `Producer:SegmentUnit.MainVideo`
- `Artifact:SegmentUnit.MainVideo.GeneratedVideo`

Important rule:

- A canonical ID is not a nickname.
- It is not a display label.
- It is not “close enough.”
- It is the exact internal identity.

### 2. Runtime artifact

A **runtime artifact** is an artifact that is actually produced by a job during execution and written to the event log.

Example:

- A real job runs for `Producer:SegmentUnit.MainVideo`
- That job writes `Artifact:SegmentUnit.MainVideo.GeneratedVideo`

That artifact is a runtime artifact because execution really creates it.

### 3. Connector

A **connector** is a graph node used to connect parts of the blueprint together.

Connectors help describe the graph.

They are not themselves produced files.

There are two connector kinds:

- `Input:...`
- `Output:...`

This is the key distinction that removes the current confusion.

### 4. Output connector

An **output connector** is a node declared in a blueprint’s `artifacts:` section whose job is to expose a value to the parent blueprint or to the outside world.

Examples:

- In a composite blueprint: `Output:SegmentUnit.Video`
- In the root blueprint: `Output:Movie`

An output connector is part of the blueprint interface.

It tells the outside world:

- “This blueprint exposes a video called `Video`”
- or “This whole blueprint exposes a final output called `Movie`”

Important rule:

- an output connector is not a saved artifact
- an output connector is not something the runner materializes
- an output connector is just the outward-facing attachment point of the graph

### 5. Export binding

An **export binding** is a connection that says:

- “Take this already-produced runtime artifact and expose it through this output connector.”

Concrete example:

```yaml
- from: MainVideo.GeneratedVideo
  to: Video
```

Inside a composite blueprint, that means:

- source: `MainVideo.GeneratedVideo` is the real runtime artifact
- destination: `Video` is the output connector of the composite blueprint

So an export binding is not new production work.

It is only a publication step at the blueprint boundary.

Another way to say it in plain language:

- the source is the real produced file
- the destination is the name the blueprint gives that file when exposing it outward

### 6. Composite blueprint

A **composite blueprint** is a blueprint that contains other producers or other nested blueprints.

Example:

- `SegmentUnit`
- `CelebrityVideoProducer`

It is “composite” because it orchestrates inner work.

### 7. Leaf producer

A **leaf producer** is an actual runnable producer job at execution time.

Example:

- `Producer:SegmentUnit.MainVideo`

This is the thing the runner executes.

### 8. Materialize

To **materialize** an artifact means:

- the runner records it in the event log
- it gets a blob or other stored output
- downstream jobs can load it by its canonical artifact ID

If an artifact is not materialized, then as far as runtime is concerned, it does not exist.

### 9. Alias

I am only using **alias** in one narrow sense:

- when two different artifact IDs are treated as if they refer to the same produced thing

That is the behavior we want to remove from the internal architecture.

I will avoid using this word for anything else.

---

## The Core Architectural Rule

Here is the rule the system should follow:

> One physical produced artifact should have one runtime canonical artifact ID.

And:

> Output connectors should be graph connectors, not second runtime artifact identities.

That means:

- runtime artifacts belong to leaf producers
- output connectors belong to blueprint boundaries
- the planner and runner should reason only about runtime artifact IDs
- the UI may display output names, but that is presentation, not runtime identity

---

## The Example We Should Use

This example is the clearest one because it shows all three layers:

1. leaf producer
2. composite output connector
3. root output connector

It already exists in the tests.

### The shape

Leaf producer:

- `Producer:SegmentUnit.MainVideo`

Leaf producer runtime artifact:

- `Artifact:SegmentUnit.MainVideo.GeneratedVideo`

Composite output connector:

- `Output:SegmentUnit.Video`

Root output connector:

- `Output:Movie`

### The authored connections

Inside `SegmentUnit`:

```yaml
- from: MainVideo.GeneratedVideo
  to: Video
```

At the root:

```yaml
- from: SegmentUnit.Video
  to: Movie
```

### What this should mean

This should mean:

1. `MainVideo` runs
2. it produces one real artifact:
   - `Artifact:SegmentUnit.MainVideo.GeneratedVideo`
3. the composite exposes that artifact outward through `Output:SegmentUnit.Video`
4. the root blueprint exposes that same thing outward through `Output:Movie`

In other words:

- one real produced artifact
- two public output names layered on top of it

### What it should **not** mean

It should **not** mean that runtime now has three equally real produced artifact IDs:

- `Artifact:SegmentUnit.MainVideo.GeneratedVideo`
- `Output:SegmentUnit.Video`
- `Output:Movie`

If runtime treats those connector IDs as if they were real persisted artifacts, then the system has duplicated internal identity.

That is exactly the kind of thing that leads to planner bugs.

---

## What The Code Does Today

The current system treats inputs and artifacts differently.

### Inputs

Input indirection is collapsed away.

That means:

- if one input points to another input
- the expander resolves that chain
- downstream jobs end up using one canonical input ID

This is the cleaner model.

### Artifacts

This is the part that is easy to misunderstand, so here is the precise version.

In the **current code**, the graph does **not** have a separate `Output:` node type yet.

So today the graph overloads `Artifact:` and uses it for two different things:

1. real runtime artifacts
2. blueprint boundary outputs

Because of that overload, a blueprint export currently shows up in the graph as an `Artifact -> Artifact` edge.

That does **not** mean:

- “a real saved artifact is flowing into another real saved artifact”

What it really means today is:

- “the graph is using one `Artifact:` node to stand for a real produced thing”
- and another `Artifact:` node to stand for a boundary output connector”

So when I say `Artifact -> Artifact` chain, I mean:

- **in the current representation**, the system has two `Artifact:` nodes connected together
- even though only the first one is a real persisted artifact

### Concrete example

Using the nested blueprint example:

```text
Producer:SegmentUnit.MainVideo
  -> Artifact:SegmentUnit.MainVideo.GeneratedVideo
  -> Artifact:SegmentUnit.Video
  -> Artifact:Movie
```

What these nodes really are:

- `Artifact:SegmentUnit.MainVideo.GeneratedVideo`
  - this is the real runtime artifact
- `Artifact:SegmentUnit.Video`
  - this is **not** really a runtime artifact
  - it is the composite blueprint’s outward-facing output
- `Artifact:Movie`
  - this is **not** really a runtime artifact either
  - it is the root blueprint’s outward-facing output

So the current graph shape is:

- `Artifact(real) -> Artifact(connector) -> Artifact(connector)`

That is the overload we want to remove.

### What I did **not** mean

I did **not** mean `Output -> Input` chains there.

That is a different kind of graph connection.

`Output -> Input` or, in today’s code, `Artifact -> Input`, means:

- “a produced thing is being consumed by another producer”

Example:

```text
Artifact:VideoProducer.GeneratedVideo
  -> Input:TimelineComposer.VideoSegments
```

That is normal data flow between jobs.

By contrast, the problematic `Artifact -> Artifact` chain is not “producer A feeds producer B”.

It is:

- “one produced thing is being re-exposed through one or more blueprint boundaries”

### Why `resolvedProduces` appears

The producer graph first records the direct producer output:

- `Producer:SegmentUnit.MainVideo`
  -> `Artifact:SegmentUnit.MainVideo.GeneratedVideo`

Then it follows the extra `Artifact -> Artifact` links:

- `Artifact:SegmentUnit.MainVideo.GeneratedVideo`
  -> `Artifact:SegmentUnit.Video`
- `Artifact:SegmentUnit.Video`
  -> `Artifact:Movie`

And it concludes:

- the same producer also “produces” `Artifact:SegmentUnit.Video`
- and also “produces” `Artifact:Movie`

That expanded set becomes `resolvedProduces`.

So internally the system ends up carrying two concepts at once:

1. the real direct runtime artifact IDs in `node.produces`
2. the expanded “also considered produced” connector IDs in `context.resolvedProduces`

That split is the heart of the problem.

### What the cleaner model should look like

If we introduce `Output:` explicitly, the same authored idea becomes much easier to read:

```text
Producer:SegmentUnit.MainVideo
  -> Artifact:SegmentUnit.MainVideo.GeneratedVideo
  -> Output:SegmentUnit.Video
  -> Output:Movie
```

Now the types tell the truth:

- `Artifact:` = real persisted runtime artifact
- `Output:` = graph connector at a blueprint boundary

That is why the rename matters so much.

---

## Why This Breaks The Planner

The planner currently asks:

- “Which artifacts are available if I keep this set of jobs?”

And it answers that by trusting `resolvedProduces`.

So a job can be treated as satisfying:

- its real runtime artifact
- plus one or more connector-facing IDs downstream

But execution does not do that.

Execution serializes `job.produces`.
The runner records `job.produces`.
The event log stores what jobs actually materialize.

So the planner can believe:

- `Output:SegmentUnit.Video` exists as if it were a materialized thing
- `Output:Movie` exists as if it were a materialized thing

while runtime only ever materializes:

- `Artifact:SegmentUnit.MainVideo.GeneratedVideo`

That means the planner is making scheduling decisions using artifact IDs that the runner will never create.

This is not just a bug in pruning.

This is a broken contract between planning and execution.

---

## The Problem In One Sentence

The planner is currently allowed to believe in more produced artifact IDs than runtime is allowed to materialize.

That should never be possible.

---

## Why `resolvedProduces` Is Architecturally Wrong

`resolvedProduces` is wrong because it encodes this statement:

> “One job satisfies multiple internal artifact identities across blueprint boundaries.”

That is exactly what a canonical-ID architecture should avoid.

If we keep `resolvedProduces`, then even if we patch one caller, the bad model remains available for future code to misuse.

That is why the right fix is not:

- “use `resolvedProduces` less”
- or “be careful where we read it”

The right fix is:

- stop generating that concept in the first place

---

## What An Export Binding Should Be

This is the precise definition we should use going forward:

> An export binding maps one runtime artifact to one output connector at a blueprint boundary.

That means an export binding is:

- boundary metadata
- not production
- not materialization
- not a second runtime artifact

### Good mental model

Think of it like this:

- runtime artifact = the actual file on disk / blob in storage
- output connector = the port on the box when the blueprint hands it to the outside world

The port on the box is useful.

But it is not a second file.

---

## The Clean Architectural Model

### Runtime layer

The runtime layer should know only:

- runnable producers
- runtime artifact IDs produced by those runnable producers
- canonical input IDs

This layer is used by:

- producer graph
- planner
- execution plan
- runner
- event log
- artifact resolver
- providers

### Blueprint interface layer

The blueprint interface layer should know:

- which output connectors map to which runtime artifact IDs

This layer is used by:

- UI display
- “what outputs does this blueprint expose?”
- storyboard or viewer projection if it wants friendly blueprint-level labels

This layer should not be used by:

- planner dirtiness logic
- dependency validation
- runner materialization
- provider input lookup

---

## Proposed Rules

These are the rules I recommend we enforce.

### Rule 1. Only leaf producers create runtime artifacts

A runtime artifact must come from a direct `Producer -> Artifact` relationship for a runnable producer job.

No output connector should count as a produced runtime artifact.

### Rule 2. Export bindings are boundary mappings only

An export binding should produce a map like:

```ts
artifactExports = {
  "Output:SegmentUnit.Video": "Artifact:SegmentUnit.MainVideo.GeneratedVideo",
  "Output:Movie": "Artifact:SegmentUnit.MainVideo.GeneratedVideo"
}
```

That map is metadata, not runtime availability.

### Rule 3. Planner and runner use runtime artifact IDs only

If an artifact ID is not materializable by the runner and resolvable from the event log, the planner must not treat it as available.

### Rule 4. No fallback lookup from output connector to runtime artifact at execution time

The runner should not be asked to “figure out what output this probably meant.”

If runtime needs an artifact, it should request the exact runtime canonical artifact ID.

### Rule 5. Output connectors may be shown in the UI, but only as projections

The UI may say:

- “Movie”
- “SegmentUnit.Video”

But under the hood that should map to one runtime artifact ID.

Presentation names are fine.
Duplicate runtime identities are not.

---

## What Needs To Change In Core

### 1. Introduce `Output:` as a first-class connector ID family

Today the internal graph overloads `Artifact:` for two different meanings:

- real persisted runtime product
- blueprint boundary connector

That should be split.

I recommend:

- `Input:...` for inbound graph connectors
- `Output:...` for outbound graph connectors
- `Artifact:...` only for real persisted runtime products

This is the naming change that makes the architecture readable.

### 2. Collapse export bindings during expansion

The expander should treat output-connector-to-upstream chains the same way it already treats input indirection:

- follow the chain
- validate it
- collapse it away from the runtime graph
- keep a separate export map

The key result should be:

- runtime graph contains runtime artifacts only
- export metadata contains output-connector mappings

### 3. Remove `resolvedProduces`

Delete the field from `ProducerJobContext`.

Delete the logic that computes transitive artifact “also produced” sets.

Delete planner and override-validation code that depends on it.

### 4. Restrict artifact ownership to direct runtime production

A producer owns a runtime artifact when:

- the graph contains a direct `Producer -> Artifact` edge
- and that artifact belongs to the runnable producer’s canonical scope

Not because some output connector further downstream points to it.

### 5. Keep root outputs visible without making them runtime artifacts

The system still needs to know that a root blueprint exposes outputs like:

- `FinalVideo`
- `Movie`
- `Timeline`

That should come from export metadata, not from pretending those are runtime-produced artifacts.

### 6. Validate export bindings strictly

An export binding should be valid only if:

1. it resolves to exactly one upstream runtime artifact
2. it does not participate in a cycle
3. it does not try to aggregate multiple sources
4. it does not use `groupBy` or `orderBy`

Conditions may still be allowed on export bindings.

If conditions exist, the collapse step must preserve them correctly.

---

## Why The Catalog Supports This Design

I checked the catalog structure.

That matters because it tells us whether this design matches how the repo is already being authored.

### What I found

Declared blueprint outputs are already acting like connectors, not internal runtime artifacts.

I found:

- no declared output used both as a source and a destination
- no declared output with multiple inbound producers
- no declared output using `groupBy`
- no declared output using `orderBy`

I did find conditional output connections, such as:

- “only expose `SegmentVideo[segment]` when `isVideoNarration`”

That is fine.

It means:

- export bindings may be conditional
- but they are still exports, not aggregators or real produced runtime artifacts

So the catalog shape supports the stricter architecture.

---

## Why This Is Better Than A Smaller Patch

There is a smaller patch available:

- stop using `resolvedProduces` in pruning
- leave the rest of the model intact

That would reduce one immediate bug.

But it would still leave the system with two internal artifact identities for one produced thing.

That is exactly the kind of half-fix that makes future regressions likely.

If the goal is a pristine architecture, the system should not carry that concept at all.

---

## The Viewer Bug, In Plain Language

This is a separate issue.

### What happens today

1. The user creates a plan.
2. The dialog shows the plan.
3. The user clicks `Run`.
4. `executePlan()` fails before execution really starts.
5. The execution state is set to `failed`, but the old plan is still stored.
6. The dialog only shows the big failure screen when there is no plan.
7. So the user keeps seeing the old plan with no clear “run failed to start” message.

### Why this is wrong

Because there are actually three different failure phases:

1. planning failed
2. execution failed to start
3. execution started and later failed

Those are not the same thing.

The state model should reflect that.

### Clean fix

Use separate failure kinds instead of reusing one generic `PLAN_FAILED` path.

Then the dialog can behave correctly:

- planning failed: show the full planning failure screen
- execution failed to start: keep the plan visible and show an inline retryable error
- execution later failed: show execution failure state/logs, not planning failure UI

---

## Implementation Plan

## Summary

Replace internal artifact aliasing with a strict separation:

- `Output:` connector IDs for graph boundaries
- runtime artifact IDs for planning and execution
- output-connector mappings for interface/display

At the same time, split viewer failures by phase so execution-start errors are visible and retryable.

## Core Changes

1. Add an explicit export-mapping result to blueprint expansion.
   - This should map each `Output:...` ID to exactly one upstream runtime artifact ID.
   - This mapping is metadata, not runtime availability.

2. Collapse output connectors out of the expanded runtime graph.
   - Keep runtime artifacts in the graph.
   - Remove composite/root output connectors from the runtime artifact set after validating their export bindings.
   - Propagate conditions from export bindings so downstream visibility remains correct.

3. Delete `resolvedProduces`.
   - Remove the type field from `ProducerJobContext`.
   - Remove its construction in `createProducerGraph`.
   - Remove all planner and validation logic that reads it.

4. Make producer ownership direct-only.
   - A producer owns only the runtime artifacts directly emitted by that producer.
   - No transitive ownership through output connectors.

5. Keep root outputs “published” through export metadata.
   - If the root blueprint exposes `FinalVideo`, the system should know that.
   - But the planner should still reason about the runtime artifact behind it.

6. Add strict validation for export bindings.
   - Reject multi-source exports.
   - Reject export cycles.
   - Reject `groupBy` or `orderBy` on export bindings.
   - Preserve and validate conditional exports.

## Planner / Execution Changes

1. Planner availability checks must use runtime artifact IDs only.
   - No `Output:...` ID should count as available unless some separate UI/projection layer maps it to a real materialized runtime artifact.

2. Execution plans must continue to serialize only runtime-produced artifact IDs.
   - That will now match the planner’s understanding.

3. Runner, event log, artifact resolver, and providers must continue to consume exact canonical runtime IDs only.
   - No `Output:` lookup in runtime.
   - No alias lookup.

## Viewer Changes

1. Split failure state by phase.
   - planning failure
   - execution-start failure
   - execution-runtime failure

2. When execution fails to start:
   - keep the plan visible
   - show a prominent inline error
   - allow retry

3. If the UI wants to show friendly output names, resolve them from export metadata.
   - Do not infer runtime equivalence from string patterns.

## Tests

1. Expansion test:
   - `MainVideo.GeneratedVideo -> SegmentUnit.Video -> Movie`
   - expect one runtime artifact identity
   - expect `Output:SegmentUnit.Video -> Artifact:SegmentUnit.MainVideo.GeneratedVideo`
   - expect `Output:Movie -> Artifact:SegmentUnit.MainVideo.GeneratedVideo`

2. Validation test:
   - reject multi-source export binding
   - reject export cycle
   - reject `groupBy` / `orderBy` on export bindings

3. Planner regression test:
   - downstream producer cannot survive planning based on a connector ID that is not a materialized runtime artifact

4. Producer graph test:
   - no `resolvedProduces`
   - direct runtime outputs only

5. Storyboard / manifest projection test:
   - no duplicate pass-through output connectors shown as fake runtime artifacts
   - friendly output labeling still works

6. Viewer execution-state test:
   - plan exists
   - `executePlan()` rejects
   - plan remains visible
   - inline error is shown
   - retry remains possible

## Final Verification

When implementing, final verification should include:

```bash
pnpm test
```

from the repository root, in addition to focused package tests during development.

---

## Recommended Decision

If the goal is:

- strict canonical IDs
- no fallbacks
- no architectural hacks
- a planner that is genuinely trustworthy

then I recommend:

- introducing `Output:` as the canonical connector identity for non-materialized blueprint outputs
- removing internal artifact aliasing entirely
- treating output connectors as export metadata only
- deleting `resolvedProduces`
- making the planner and runner operate on the same runtime artifact identity model

That is the clean fix.

It is larger than a local patch, but it is the version that leaves the repo in a better architectural state instead of just making one symptom quieter.
