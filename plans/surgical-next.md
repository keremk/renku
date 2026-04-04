## Original Request (This was then clarified with questions, included here as additional initial context, the full plan is in the next section)
I need to give users (both CLI and viewer) further ability to do surgical generation. Currently we allow users 1) Do layer by layer generation up to a certain layer 2)
Allow users to mark some producers (or even specific artifacts they produced) to keep them from being regenerated 3) Allow users to mark some producers (or certain
artifacts of those producers) for forced regeneration even if they are not marked as dirty. In all these cases, we use (and should always keep using) the existing
dirty tracking system in the planning.
The goal here is to give users full control over the generation so that they can save costs, try some specific prompts before committing to a full run, keep good
artifacts. What we are still lacking is an ability to generate only certain producer artifacts in an up-to-layer type of run. This is important especially if the
layers have many producers and a lot of artifacts to generate. The cost of a single layer can be very high. There are 2 scenarios for this: 1) User toggles specific
producers on/off from the planning, so those producers don't run. Note that there is an edge case where if a layer depends on a producer from a previous layer to
produce artifacts from them, toggling off the prior layer's producer will effectively toggle off its downstream dependencies as well. Most likely use case though is
that the user do not actually add the downstream layer anyways but they can of course. 2) User restricts how many artifacts the producer can generate in a layer. This
is for the cases where a specific producer can produce a lot of artifacts (hence expensive) but the user wants to merely try the model and its prompts before
generating all these artifacts. Again the similar edge case is valid where a downstream producer may not get its artifacts if they are not generated from the prior
layer. 3) A combination of the above first and second scenarios.
Here is the UI proposal (viewer)
[Image #1] As seen in the rough wireframe, we should add a new section in the overview tab of the producer (launched from the blueprint viewer at the bottom) This
section should both show the current plan info and also allow the user to toggle it. The default is it is scheduled to run but the user can toggle it off. Also this
sections shows how many artifacts this producer will generate. The user can decrease the artifacts (or increase up to maximum possible) or reset it so that it follows
the plan (negating the overrides) 1) If the producer is generating multiple types of artifacts, this should also be stated. But these are usually tied to one
generation. For example a video producer can generate an audio track, first and last frame images for the video generation. So it does not make sense to change these
dependent generations since if a video is not generated there won't be an audio track either. So dependent generations should not be available to override. 2) As
stated before if the producer depends on upstream producers this overriding section is also not possible. The actual plan should win, and there should be a warning
here that says overriding this may not work because of upstream producers. (i.e. their dependent artifact not being available). Warning is good and the plan does the
right thing.
For CLI:
We should add a new switch to generate command. --pid (or --producer-id long form) which takes the canonical producer id + # of artifacts to produce (all if omitted)
Example: renku generate --pid "Producer:CharacterGenerator:1" will only run that producer and with 1 artifact
Edge cases: 1) If used with --last or --id then it will use the prior build 2) The list of producers should be valid according to plan. E.g. you cannot ask it to
generate a producer artifacts downstream if the their upstream dependencies are not yet generated. 3) This supercedes --up. So if they are both used in the same
generate command, --pid wins. 4) The plan should intersect the other constraints as in --aid and --pin. These 2 supercedes pin. I.e. if they are used in the same
generate command, they win. 5) Generate fails fast with a proper error (using the numbered error architecture we built) if an invalid option is created. 6) The Copy
CLI button in the viewer app, should continue to work and add this new --pid into account.
Key engineering constraints:
1) We should follow the layered architecture. Use core for this logic and viewer and CLI are thin wrappers on the services provided by core 2) Use the error
architecture we defined. Fail fast and do not add fallbacks that hide errors just to make it work 3) Dirty planning logic needs to be intact. These are just overrides
to it when it make sense according to the plan. Follow the same mechanisms we had for the other surgical generations, do not break that architecture 4) Make sure the
core logic is well covered through unit tests and easily testable. The combination of these surgical generations needs to be well covered through those tests. 5) Add
integration and end-to-end tests when necessary. Make sure to follow the testing patterns on fixtures and where they are generated. Each package should own their
fixtures and not depend on each other, the tests should not refer to catalog blueprints but instead create targeted and well named blueprints in their corresponding
fixture folders.

## Surgical Producer-Level Generation Overrides (Core-First)

### Summary

- Add a producer-level override system in core that can:
    - turn specific producers on/off for a run,
    - cap how many artifacts a producer generates,
    - combine both behaviors safely.
- Keep the existing dirty-tracking flow as the source of truth, then apply these as explicit surgical constraints.
- Expose this in:
    - CLI via repeatable --pid/--producer-id Producer:Alias[:count],
    - Viewer via a new override section in the producer details Overview tab.
- Preserve fail-fast behavior with numbered errors and no fallback guessing.

### Non-Negotiable Engineering Constraints

  - Layered architecture:
      - All scheduling/validation/precedence logic lives in core planning services.
      - cli only parses flags and renders output; viewer only captures UI state and calls server APIs.
  - Error architecture:
      - Use numbered core error codes for all invalid combinations and invalid producer/count/dependency cases.
      - Fail fast; no silent fallback, no implicit substitution, no guessing.
  - Dirty planning integrity:
      - Existing dirty logic remains the baseline source of schedulable work.
      - New producer overrides are applied through the same surgical planning mechanism used today (aid/pin/up/from paths).
  - Testability:
      - Core logic must be extracted/organized so override normalization and precedence are unit-testable in isolation.
  - Fixture discipline:
      - Integration/E2E tests use package-owned fixtures only.
      - No cross-package fixture dependency.
      - No tests referencing catalog blueprints; use targeted, explicitly named local fixture blueprints.

### Public Interface / Behavior Changes

- CLI:
    - New repeatable flag: --pid (long form --producer-id), format Producer:Alias[:count].
    - count is optional; if omitted, use full planned producer cardinality.
    - Multiple producers are passed by repeating the flag.
    - :0 (or any non-positive count) is invalid and errors.
    - --pid with --from is invalid and errors.
    - --pid supersedes --up when both are provided.
    - --pid + --aid are both force-target sets; they supersede pin conflicts on overlapping targets.
- Core planning request:
    - Add normalized producer override payload used by both CLI and viewer (global mode + per-producer directives).
    - Add explicit producer override validation and dependency closure validation.
- Planning response metadata:
    - Include effective per-producer scheduling/cap result and warnings (for UI display and Copy CLI generation).

### Implementation Plan

1. Core: normalize and validate producer overrides

- Introduce a canonical ProducerOverrides model in planning service input.
- Normalize CLI/viewer inputs into this model before planner execution.
- Enforce:
    - producer ID must be canonical and present in current plan graph,
    - count must be integer >= 1 and <= producer’s max selectable range,
    - duplicate producer directives are invalid (fail fast),
    - dependency closure must hold after overrides are applied.
- Multi-dimensional producer behavior:
    - Producer:X:N limits by the first index dimension (lowest canonical indices first),
    - all deeper dimensions under selected first-dimension values remain included,
    - expose this in metadata so UI/CLI text can explain multiplicative impact.

2. Core: merge with existing surgical controls and dirty logic

- Keep baseline dirty plan computation intact.
- Apply surgical precedence in this order:
    - Build force-target set from --aid and --pid.
    - Apply pinning only to jobs/artifacts outside that force-target set.
    - Apply producer on/off and count caps to scheduled candidates.
- Validate that selected/capped producers still have required upstream artifacts.
- If not valid, fail planning with numbered dependency/selection errors (no silent degrade).

3. CLI: parsing, orchestration, and output

- Add parsing for repeatable --pid/--producer-id.
- Parse once, split optional trailing :count, then only use canonical producer IDs internally.
- Wire parsed targets into planning-service request.
- Update interactive and non-interactive plan displays to show effective producer caps and warnings.
- Update CLI error rendering paths for new numbered errors.
- Ensure existing options keep behavior, except explicit precedence changes above.

4. Viewer: producer-level controls and server wiring

- In producer details Overview tab, add a new “Scheduling Overrides” section showing:
    - scheduled toggle (default on / inherit),
    - artifact count control (min 1, max plan-derived),
    - reset-to-plan action.
- Show plan-derived info:
    - scheduled/effective count,
    - artifact-type summary (including dependent outputs grouped, read-only),
    - warning when upstream dependencies may invalidate override outcomes.
- Persist overrides in viewer execution context and include them in plan + execute requests.
- Update server plan/execute handlers to pass normalized producer overrides to core.
- Copy CLI button:
    - include repeated --pid entries reflecting current effective producer overrides and counts,
    - continue including other selected surgical flags as applicable.

5. Errors and observability

- Add numbered core error codes for:
    - invalid --pid format,
    - unknown producer ID,
    - invalid/out-of-range count,
    - duplicate producer directives,
    - invalid --pid + --from,
    - dependency-missing after producer restriction.
- Surface unchanged through CLI and viewer server; UI maps them to clear user-facing messages.

### Test Plan

1. Core unit tests

- Producer override normalization and validation.
- First-dimension count semantics (including multi-dimensional producer matrices).
- On/off selection propagation and dependency closure failures.
- Precedence matrix:
    - pid vs up,
    - pid + aid,
    - pid/aid vs pin overlap behavior.
- Dirty-tracking invariance: baseline dirty logic still drives candidate set.

2. Core orchestration/planning-service tests

- End-to-end plan request with combined surgical options.
- Error-code assertions for each invalid combination.

3. CLI tests

- Argument parsing for repeatable --pid.
- Format/count/duplicate failure cases.
- --pid + --from rejection.
- --pid superseding --up.
- Plan display snapshot/behavior for capped counts and warnings.

4. Viewer tests

- Producer details override UI state transitions (toggle/count/reset).
- Warning rendering for upstream-dependent scenarios.
- Execution context serialization/deserialization of overrides.
- Plan/execute handler payload forwarding.
- Copy CLI command generation with --pid included correctly.

5. Integration/E2E coverage

- Add package-local fixtures (no cross-package fixture dependency, no catalog blueprint dependency).
- Scenario tests for:
    - selective producer run in up-to-layer workflow,
    - capped producer count with downstream dependency failure,
    - mixed aid + pid + pin precedence behavior across core/cli/viewer boundaries.

### Assumptions and Defaults

- Multiple producer selections are passed with repeated --pid flags.
- :0 is invalid (no implicit disable via count).
- --pid is allowed for both fresh and existing runs (except with --from, which is invalid).
- If user-selected producer restrictions create an impossible dependency graph, planning fails fast with numbered errors.
- Viewer allows overrides even for upstream-dependent producers, but shows warnings and relies on plan validation for final authority.