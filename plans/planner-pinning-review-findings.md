# Planner Review, Rewritten in Plain English

## Why you should care

This planner change has two logic bugs that directly affect user trust.

- In one case, the system **re-runs work the user explicitly asked to keep**.
- In the other case, the system **skips work that is actually required**.

So the planner can be wrong in both directions:

1. it can run too much,
2. or it can run too little.

When a planner does either of those, users get confusing behavior, unexpected costs, and failures that look random.

## First, a simple mental model

The planner is trying to decide: “Which producers should run this time?”

Two controls are relevant here:

- **Pinning** means: “Do not regenerate this artifact. Reuse what already exists.”
- **`reRunFrom`** means: “Start rerunning from this layer index onward.”

A correct planner should combine those rules safely:

- `reRunFrom` says where rerun *could* start,
- pinning says specific outputs that must still stay excluded.

In other words, pinning should remain a hard rule even when rerun scope is broad.

---

## Finding 1 (P1): Pinning is undone by `reRunFrom`

### File location
`core/src/planning/planner.ts:197-199`

### What the current code appears to do

1. It removes jobs that correspond to pinned outputs.
2. Later, normal-mode layer building (`buildExecutionLayers`) force-includes all jobs at/after `reRunFrom`.
3. That force-inclusion can add back jobs that were just removed due to pinning.

### Why this is a correctness bug

Pinning is an explicit user decision. If a later phase re-adds pinned jobs, that user decision is silently overridden.

That means the user says “keep this output,” but the planner says “I’ll regenerate it anyway.”

### Concrete scenario (walkthrough)

Assume 4 layers:

- Layer 0: `Producer:A` creates `Artifact:A`
- Layer 1: `Producer:B` creates `Artifact:B`
- Layer 2: `Producer:C` creates `Artifact:C`
- Layer 3: `Producer:D` creates `Artifact:D`

Now the user does this:

- pins `Artifact:B`
- sets `reRunFrom=0`

Expected behavior:

- rerun everything from layer 0 **except** the pinned producer for `Artifact:B`
- `Producer:B` should remain excluded

Actual behavior from the reported logic:

- planner first excludes `Producer:B`
- later, layer expansion says “include all jobs from layer 0 onward”
- `Producer:B` is re-added

So the pin has no effect in this flow.

### User-visible impact

- User intent is violated.
- Extra generation work happens unexpectedly.
- Costs and runtime increase.
- Previously accepted outputs can get overwritten, causing drift.

### Why severity is high (P1)

This affects common rerun workflows (`reRunFrom=0` or similar), so it is not a rare edge case. It breaks a core contract: when users pin outputs, those outputs should not be regenerated.

---

## Finding 2 (P2): Skipping producers by ID list only (without checking real reusability)

### File location
`core/src/planning/planner.ts:208-210`

### What the current code appears to do

The exclusion check seems to be:

- “If all produced artifact IDs are in `pinnedArtifactIds`, skip this producer.”

### Why this is a correctness bug

Being listed in `pinnedArtifactIds` only proves this:

- the ID was requested as pinned.

It does **not** prove this:

- the artifact is actually present now,
- the artifact is valid,
- the artifact came from a successful latest attempt,
- the artifact can really be consumed downstream.

So the planner can skip generation based on a label, not on actual reusable data.

### Concrete scenario (walkthrough)

Assume:

- `Producer:X` creates `Artifact:X`
- `Artifact:X` is included in `pinnedArtifactIds`

But in storage/runtime state:

- latest attempt for `Producer:X` failed,
- or `Artifact:X` payload is missing/corrupted/unavailable.

Expected behavior:

- planner should not skip blindly.
- planner should either:
  1. schedule `Producer:X` to regenerate, or
  2. fail fast with a clear planning error that pinned artifact is not reusable.

Actual behavior from the reported logic:

- producer is skipped because ID is pinned,
- downstream step later asks for `Artifact:X`,
- runtime fails when required input is missing.

### User-visible impact

- Plans look valid but fail later.
- Failures appear “downstream” and are harder to diagnose.
- Debugging gets expensive because root cause is hidden in planner assumptions.

### Why severity is high (P2)

This bug creates under-scheduling: required producers are omitted. That can directly break execution and damage reliability.

---

## The two bugs together (important)

These bugs are especially dangerous as a pair:

- P1 makes planner run jobs it should not run.
- P2 makes planner skip jobs it must run.

That means the same planning system can feel nondeterministic to users:

- sometimes it ignores pins,
- sometimes it trusts pins too much without checking whether data exists.

Both outcomes erode confidence quickly.

---

## Expected planner invariants (the rules that should always hold)

A healthy planner should enforce these invariants:

1. **Pinning is sticky across phases**
   - Once a producer is excluded because of pinning, later transforms (including `reRunFrom`) must not reintroduce it.

2. **Skip only when reuse is proven**
   - A producer can be skipped only if each pinned output is verifiably reusable now.
   - “Pinned ID exists in a set” is not enough proof.

3. **Fail fast when pinning is invalid**
   - If user pins `Artifact:...` but no reusable artifact exists, planner should fail with a descriptive error instead of building a fragile plan.

These invariants match your repo rules about avoiding silent fallbacks and surfacing missing canonical bindings explicitly.

---

## Practical consequence for product behavior

If unchanged, users will experience:

- “I pinned this, why did it rerun?”
- “Planner said skip, why did execution fail with missing input?”

Those are exactly the kinds of issues that make a workflow tool feel unpredictable.

---

## One-line conclusion

The implementation currently treats pinning inconsistently:

- too weak against `reRunFrom` in one path,
- too strong (without validation) in another path.

Both should be corrected so pinning means: **reuse existing valid output, otherwise fail clearly or regenerate intentionally**.
