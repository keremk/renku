# Producer Overrides: Inherit vs Selected-Only (Layman Guide + Design Notes)

## Why this note exists

We discovered a mismatch between Viewer and CLI behavior when producer overrides are involved.

- Viewer sends overrides with `mode: "inherit"`.
- CLI `--pid` maps to `mode: "selected-only"`.

That means a copied CLI command can run a **different plan** from what the Viewer preview showed.

This document explains the current behavior in plain language, with examples, and proposes a direction for a deterministic, simpler design follow-up.

## Plain-language mental model

Think of planning as a two-step process:

1. Decide what work is needed.
2. Apply user constraints.

### `inherit` mode

`inherit` means:

- Start from normal planner logic first (dirty/missing/failed dependency analysis).
- Then apply producer directives as **caps/disables**.
- Do **not** force reruns just because a producer was mentioned.

In plain terms: "keep normal smart reuse behavior, but limit or disable specific producer families."

### `selected-only` mode

`selected-only` means:

- Treat producer directives as the main selection scope.
- Explicitly selected producer jobs are included.
- Non-selected jobs are filtered out (except explicit forced targets).

In plain terms: "run only what I explicitly selected."

## Concrete examples

## Example A: everything already reusable

Graph (simplified):

- `Script -> Audio[0..1] -> Video`

State:

- Existing artifacts are present and reusable.
- Nothing is dirty.

User intent:

- "For Audio, set count to 1."

### In Viewer (`inherit`)

- Base planner says: "Nothing needs rerun."
- Override caps family to one slot, but does not force rerun.
- Result: likely zero scheduled jobs.

### In CLI with `--pid Producer:AudioProducer:1` (`selected-only`)

- Selected-only semantics can schedule selected Audio job(s) anyway.
- Result: can rerun work that Viewer considered reusable.

Impact:

- Same apparent user action, different actual execution behavior.

## Example B: one producer has partial dirtiness

State:

- `Audio[1]` is missing/failing.
- `Audio[0]` is reusable.

User sets Audio count to 1.

### Inherit expectation

- Keep planner-driven reuse and only allow first-dimension slot(s) selected by cap.
- Should schedule only truly needed work under cap.

### Selected-only via `--pid`

- May force selection behavior broader than dirty set.
- Can still diverge from inherit planning intent.

## Where mismatch is currently introduced

Current code behavior:

- Viewer request builder sends:
  - `producerOverrides.mode = "inherit"`
  - directives from dialog state
- Plan response builder creates copyable CLI command.
- CLI string generation converts directives to `--pid`.
- CLI `--pid` is parsed as `selected-only`.

So copy/paste flow changes mode semantics implicitly.

## What was already fixed earlier (and remains correct)

Core planner behavior currently preserves earlier fix:

- In `inherit`, producer override selection does not force reruns.
- In `selected-only`, selected producers are explicitly scheduled.

So the mismatch is not that core planner forgot the fix.
The mismatch is at Viewer CLI string translation.

## Immediate fixes done in this pass (separate from mode redesign)

- Fix #1: disabling producer override clears stale `count` so invalid `{ enabled: false, count: N }` is not sent.
- Fix #3: producer scheduling refresh dedupe is now in-flight only, allowing retries.

No behavior redesign for #2 is included in this pass.

## Follow-up design goals for #2

The follow-up should aim for these invariants:

1. Viewer and CLI expose equivalent capabilities.
2. Copyable CLI command always reflects actual Viewer intent.
3. Semantics are deterministic and easy to explain.
4. No silent mode conversion.

## Candidate direction for follow-up (high-level)

Likely end-state:

- Introduce CLI syntax that can express inherit-mode producer overrides directly.
- Keep `--pid` as selected-only (for backward compatibility), but make mode explicit in docs/help.
- Viewer command generator should emit mode-appropriate CLI flags.
- If command cannot be equivalent, UI must state exactly what differs.

This note does not lock final flag design yet; it captures the behavioral contract we need.

## Suggested acceptance criteria for the redesign task

1. A Viewer plan using inherit overrides can produce an equivalent CLI command that re-plans identically.
2. Existing selected-only CLI flows still work as before.
3. `--up` / layer limiting interaction is explicit and tested per mode.
4. Tests cover:
   - reusable artifacts + inherit cap
   - missing artifact + inherit cap
   - selected-only explicit forcing
   - viewer-generated command roundtrip parity


Ok back to the #2 planning. I think having 2 separate modes inherit vs. selected-only is wrong. The baseline should always be the automatic planning based on the graph
analysis and dirty detection -> i.e. no user intervention. That is the source of truth of what needs to run. Users can then override this:
1) They can determine up to which layers to run (--up). This is course level follow the plan up to this layer override.
2) They can determine which producers should run and how many artifacts they can produce. This is the newly implemented more granular version of --up and we use --pid
and list the names of the producers that users want to run. This still follows the baseline dependency resolution, so if a user says Producer:X needs to run than the
upstream producers should also run. Just like the --up layers one which means up to those layers.
3) Once a run happens at least once, then the users can also determine to keep some of the artifacts even if the dirty planner plans them to run because of upstream
changes. That is the --pin mechanism.
4) Once a run happens at least once, then the users can override the dirty mechanism and ask the plan to regenerate specific artifacts, this is using --aid flag. The
viewer has a convenience where it can set all the artifacts of a producer. Actually we should probably change this flag to match the design of the --pin flag and make
it so that --regen with artifact and producer ids. (like --pin) This will create a more consistent CLI experience.
So essentially those are the ways users can override the planner's inherit planning. That is an easy to understand and explain mental model from UX perspective. It
seems like our implementation is still a bit convoluted. Ideally all this should logic be in one place and well covered with unit tests and with all edge cases, so
that we have a solid implementation. And the viewer mainly is the UI on top of it. Core contains the logic, CLI exposes flags for commandline UX. But it is essentially
always the same. This way converting from UI to CLI commands is deterministic and testable with all combinations. Now I want you to go over the codebase and 1)
determine how close are we there 2) determine the edge cases we handle 3) come up with a plan to refactor this in once place that can be easily unit tested and have
comprehensive test coverage with all possible cases


# Refactor Plan: One Unified Planning Override Model (Core-First, CLI/Viewer Parity)

  ## 1) Executive Summary

  - We are partially close to your target model already.
  - The baseline planner logic (dirty detection + dependency graph) is strong and already central in core.
  - The main problem is semantic drift across surfaces:
  - Core still carries two producer modes (inherit vs selected-only).
  - CLI --pid currently maps to selected-only semantics.
  - Viewer sends inherit-style overrides but generates CLI commands using --pid, which can produce non-equivalent behavior.
  - This refactor will remove that split and make planning overrides deterministic, centralized, and testable in one place.

  ———

  ## 2) Current State: How Close We Are

  ### What already matches your mental model

  - Baseline planning is graph + dirty detection driven.
  - Pin logic is centralized and strict (canonical IDs, reusable checks, validation).
  - Artifact-targeted regeneration exists and propagates downstream.
  - Producer scheduling metadata is already returned for UI/CLI display.

  ### Edge cases currently handled well

  - Invalid canonical IDs fail fast.
  - Malformed producer tokens fail fast.
  - Duplicate/unknown producer directives fail fast.
  - Invalid producer counts fail fast.
  - Missing upstream dependencies from override scope fail fast.
  - Pin IDs are validated and non-reusable pins fail fast.
  - Pin overlap with force targets already resolves in favor of force target.

  ### Where we are still misaligned

  - Producer behavior still depends on inherit vs selected-only mode.
  - --pid currently behaves like a force-style selected-only path instead of baseline+scope.
  - Viewer request semantics and generated CLI semantics can diverge.
  - --up suppression around --pid is ad hoc.
  - Legacy flags (--from, --aid) still shape behavior and increase cognitive load.

  ———

  ## 3) Target Behavior Contract (Single Source of Truth in Core)

  ### Canonical override inputs to core

  - upToLayer: coarse scope cap.
  - producerScope: explicit producer allow-list with optional per-producer count caps.
  - regenerateIds: repeatable canonical IDs of type Artifact:... or Producer:....
  - pinIds: repeatable canonical IDs of type Artifact:... or Producer:....

  ### Canonical scheduling semantics

  - Baseline planner computes dirty plan set B.
  - Scope set S is computed as:
  - If producerScope exists, S is producer-selected jobs (respecting count caps) plus required upstream closure.
  - Else if upToLayer exists, S is all jobs through that layer.
  - Else S is full graph scope.
  - Force set F is resolved from regenerateIds:
  - Artifact:... => source job + downstream lineage.
  - Producer:... => all jobs in that producer family (within active scope caps) + downstream lineage.
  - Scope is always applied to regen: F_effective = F ∩ S.
  - Effective scheduled set starts as: (B ∪ F_effective) ∩ S.
  - Pins apply last, except regen conflicts where regen wins.
  - Non-fatal conflicts emit warnings; invalid requests still fail fast.

  ### Explicit precedence and conflict rules

  | Priority Order | Rule | Result |
  |---|---|---|
  | 1 | Determine active scope (producerScope or upToLayer or full graph) | Defines what is even eligible to run |
  | 2 | Apply baseline dirty plan and explicit regen inside scope | Builds candidate execution set |
  | 3 | Apply pin suppression | Removes eligible pinned work |
  | 4 | Resolve pin vs regen overlap | regen wins, warning emitted |

  ### Warnings to return (non-fatal)

  - Pin and regen conflict detected; regen wins.
  - Regen targets fall outside active scope; targets dropped by scope.

  ### Fail-fast errors to keep

  - Unknown IDs.
  - Invalid count values.
  - Missing upstream artifacts required by selected scope.
  - Non-reusable pin targets.
  - Other true impossibilities.

  ———

  ## 4) Implementation Plan by Subsystem

  ## A. Core (main refactor location)

  - Introduce a canonical override resolver that computes effective scope, force targets, pin suppression, and warnings before planner execution.
  - Remove mode-based producer semantics from core (inherit / selected-only).
  - Keep planner baseline logic intact, but feed it unified resolved sets instead of mode flags.
  - Preserve strict validation behavior and dependency checks.
  - Expose structured warnings in plan result so viewer/CLI can render the same outcomes.

  ## B. Planner adapter contract

  - Replace mode-oriented fields with generic scheduling controls:
  - Allowed job set.
  - Forced job set.
  - Pinned artifact set.
  - Remove ProducerOverrideMode from adapter/planner-facing contract.

  ## C. CLI surface

  - Remove legacy flags completely:
  - --re-run-from, --from.
  - --artifact-id, --artifact, --aid.
  - Add repeatable --regen accepting canonical Artifact:... and Producer:....
  - Keep --up.
  - Keep --pid, but change semantics to scope selection only (not force mode).
  - Keep rule: --pid scope overrides --up.
  - Keep rule: --regen respects active scope.
  - If --regen targets are outside scope, drop them and emit warnings.
  - Treat removed flags as unknown flags (no backward-compat shims).

  ## D. Viewer surface

  - Stop sending mode-based producer overrides.
  - Build request payload in the same canonical override shape as CLI semantics.
  - Continue producer toggle/count UX, but map to explicit producerScope.
  - Generate CLI command from canonical resolved override semantics, not ad hoc conversion logic.
  - Ensure generated command remains behavior-equivalent to viewer plan intent.

  ## E. Runtime/config cleanup

  - Remove reRunFrom from run config and generation surfaces.
  - Remove layer-skipping-by-rerun execution behavior.
  - Remove rerun-only validation hooks.
  - Remove rerun-specific error codes/messages that no longer apply.
  - Update docs and examples to only describe --up, --pid, --pin, --regen.

  ———

  ## 5) Public API / Interface Changes

  ### Core type and request changes

  - Remove ProducerOverrideMode.
  - Replace mode-based producer override input with producer-scope directives.
  - Replace targetArtifactIds with regenerateIds supporting Artifact:... and Producer:....
  - Remove reRunFrom from generation/plan/run config interfaces.
  - Add structured planning warnings to plan result for non-fatal override conflicts.

  ### CLI changes

  - Removed flags: --re-run-from, --from, --artifact-id, --artifact, --aid.
  - Added flag: repeatable --regen.
  - Retained but redefined: --pid as scope selector only.

  ———

  ## 6) Comprehensive Test Plan

  ## A. Core override resolver tests

  - Baseline-only planning with no overrides.
  - --up only scope capping.
  - --pid only scope selection with reusable artifacts not force-rerun.
  - --pid count cap behavior across loop dimensions.
  - Required upstream closure for selected producers.
  - --pid + --up precedence (--pid wins).
  - --regen Artifact:... lineage forcing + downstream propagation.
  - --regen Producer:... family forcing + downstream propagation.
  - --regen targets outside scope are dropped with warnings.
  - --pin validation and producer-pin expansion.
  - --pin + --regen overlap warning and regen-wins behavior.
  - Dependency-unavailable cases still fail fast.

  ## B. Planner / adapter tests

  - No remaining mode-dependent code paths.
  - Allowed/forced/pinned interactions follow precedence contract.
  - Existing dirty detection behavior remains stable.

  ## C. CLI tests

  - Removed flags fail as unknown options.
  - --regen parsing and validation for both ID kinds.
  - --pid scope semantics (no selected-only force mode).
  - Precedence combinations: --pid, --up, --regen, --pin.

  ## D. Viewer tests

  - Request payload generation matches canonical override contract.
  - Producer dialog scheduling refresh retry behavior remains intact.
  - CLI command generation parity tests for mixed combinations.

  ## E. Cross-surface parity tests

  - For each fixture combination, verify viewer request and equivalent CLI invocation produce:
  - same scheduled jobs,
  - same layer outputs,
  - same warnings.

  ———

  ## 7) Assumptions and Defaults (Locked)

  - --pid is scope-only, not force-run.
  - Producer scope includes required upstream closure when needed.
  - --pid wins over --up.
  - --regen always respects active scope.
  - Out-of-scope regen targets are dropped with warning.
  - --pin vs --regen conflict is warning-level; regen wins.
  - --pin and --regen require existing movie context.
  - Removed legacy flags have no compatibility layer and are treated as unknown.