# Improve Blueprint Authoring, Validation, and Dry-Run

## Top-Level Goal

We should improve this system in three places at the same time:

1. Authoring guidance should stop steering people toward the wrong architecture.
2. Validation should catch structural problems before the blueprint ever reaches viewer or dry-run.
3. Dry-run should behave more like real execution and explain failures much more clearly.

The main lesson from this session is:

- the blueprint idea was not fundamentally broken
- the system was encouraging the wrong abstraction too early
- and then it only caught important problems too late

So the plan is not “make blueprints simpler.”
It is:

- make the authoring model clearer
- make structural checks earlier
- make dry-run more truthful and more diagnosable

———

## Workstream 1: Improve skills/skills Guidance

### Goal

Make the skills help users choose the right blueprint shape up front instead of generating a generic graph that only breaks later.

### 1. Update create-blueprint

File:

- /Users/keremk/Projects/aitinkerbox/skills/skills/create-blueprint/SKILL.md

### Changes

- Make the first architectural question explicit:
    - asset-only pipeline
    - composition pipeline
    - fully rendered video pipeline
- Add a second architectural question right after that:
    - is the motion generation meant to be generic/simple
    - or model-family-specific and tightly controlled
- Teach the skill to distinguish:
    - topic-generic planning
    - from
    - model-specific execution

That distinction was the core missing idea in this session.

- Add a new recommended pattern for advanced documentary work:
    - one root blueprint
    - shared planning logic
    - child blueprints for repeatable execution units
    - local producers when catalog producers are too generic
- Explicitly tell the skill:
    - do not assume “model choice” is a late UI dropdown decision
    - for advanced video workflows, model family can change the topology
- Add a “reference asset usefulness” checklist:
    - if the blueprint creates portraits, character sheets, start/end frames, or reference bundles
    - then the skill must identify exactly which downstream producers consume them
    - if no downstream consumer exists, the blueprint is incomplete
- Add a “published outputs are endpoints, not internal sources” rule:
    - top-level outputs may terminate the graph
    - but internal edges should not route from published output connectors back into producers

### Why this matters

This would have caught the two biggest authoring mistakes earlier:

- creating character sheets that were not actually used downstream
- wiring SegmentStillImages back into SeedanceStartEndClipProducer

———

### 2. Update create-video

File:

- /Users/keremk/Projects/aitinkerbox/skills/skills/create-video/SKILL.md

### Changes

- Move from “pick a model” to “pick a workflow family.”
- Before prompting, require the skill to classify each motion need as something like:
    - plain text clip
    - reference-driven clip
    - start/end transition clip
    - multi-shot clip
    - talking head clip
- Teach the skill that for advanced video models:
    - prompts are not portable across families
    - reference semantics are not portable across families
    - input wiring is not portable across families
- Add a rule:
    - if the blueprint is built for Seedance-style execution, do not treat Kling/Veo as a drop-in replacement unless the workflow contract is truly the same
- Expand the model guide mapping approach already present there and make it the main method:
    - write prompts only after loading the exact family guide
    - never write “universal” advanced video prompts

### Why this matters

This skill is already closer to the right mental model than model-picker.
It should become the source of truth for:

- workflow-specific prompting
- model-family-aware motion planning

———

### 3. Rewrite model-picker

File:

- /Users/keremk/Projects/aitinkerbox/skills/skills/model-picker/SKILL.md

### Changes

This file is now the most outdated part of the chain.

It still assumes too much of this older model:

- select generic producer
- select compatible model
- maybe swap later
- usually end with timeline + exporter

That is too weak for advanced motion pipelines.

#### Replace the old framing with this:

- first choose the execution family
- then choose the producer contract
- only then choose the exact model variant

So the picker should return not just:

- producer + provider + model

It should return:

- execution family
- workflow mode
- producer contract
- model

#### Remove or rewrite these outdated assumptions:

- “always include timeline/ordered and ffmpeg/native-render”
- generic common patterns that always end in timeline/export
- generic video/ref-image-to-video style advice as if all reference workflows are equivalent

#### Add a new decision tree:

For video:

- Does the workflow need no references?
- Does it need one or more identity references?
- Does it need a start image and end image?
- Does it need multi-shot control?
- Does it need native audio?
- Does it need a talking-head flow?

The picker should then recommend:

- either a catalog producer
- or a local custom producer blueprint pattern

### Why this matters

Right now this skill is still encouraging the exact abstraction that caused the blueprint design drift.

———

### 4. Update director-prompt-engineer

File:

- /Users/keremk/Projects/aitinkerbox/skills/skills/director-prompt-engineer/SKILL.md

### Changes

This skill still leans too hard toward:

- one director prompt producing all downstream prompts

That is fine for simpler blueprints, but not for advanced model-family execution.

It should be updated to say:

- the main director should often emit semantic asset plans
- model-family-specific prompt adapters may then translate those semantics into final prompts

Also fix the outdated file-structure examples in this skill so they match the current producer format and do not reintroduce legacy shapes.

### Why this matters

This change reduces the pressure to make one prompt schema serve incompatible downstream models.

———

### 5. Add new docs in skills/skills/*/references

### New docs to add

- asset-only-blueprint-patterns.md
- model-family-execution-patterns.md
- reference-bundle-patterns.md
- common-errors-advanced-blueprints.md

### What they should cover

- asset-only endpoints are valid
- root outputs are publication endpoints, not internal wiring nodes
- when to use local producers
- when to use child blueprints
- when model family should change topology
- how reference bundles must be explicitly consumed
- how to design start/end branches safely
- how to reason about Seedance/Veo/Kling as different execution families, not just different models

———

## Workstream 2: Improve Validation

### Goal

Catch structural and contract errors before viewer load or dry-run.

### 1. Make CLI validation include viewer projection checks

### Problem seen in this session

The blueprint validated, but viewer still failed with:

- Output:SegmentStillImages[0] -> InputSource:SeedanceStartEndClipProducer.StartImage

### Plan

Make blueprints:validate run the same graph projection logic that viewer uses.

That means validation should fail if:

- canonical edges reference nodes viewer cannot materialize
- output/input collapse produces viewer-invalid edges
- internal graph shape differs from what viewer expects

### Why this matters

It removes the current split where:

- CLI says “valid”
- viewer says “400 bad request”

———

### 2. Add a validation rule forbidding internal edges from published outputs

### Rule

If a connection uses a published top-level output as the source for another internal producer input, fail validation.

Allowed:

- producer output -> top-level output
- top-level output as terminal publication

Not allowed:

- top-level output -> internal producer input

### Why this matters

This would have caught the SegmentStillImages -> StartImage problem immediately.

———

### 3. Add required-input condition coherence validation

### Problem seen in this session

For SegmentReferenceImageProducer and SeedanceReferenceClipProducer:

- Prompt was conditional
- element image bindings behaved as if they were unconditional
- runner executed jobs with required prompt missing

### Plan

For each producer job, validate that required mapped fields are conditionally coherent.

In plain language:

- if a required field is only active under a condition
- and sibling required inputs keep the job alive outside that condition
- validation should flag it

This can be implemented as a producer-contract preflight:

- inspect provider schema required fields
- inspect job input bindings
- inspect input conditions
- fail if the execution can survive with some required fields missing

### Why this matters

This catches “job can still run, but required payload field disappears” before runtime.

———

### 4. Keep strengthening exact canonical validation for JSON handoff

### Problem seen earlier in this session

Whole-object JSON links like:

- ExpertSet -> PlanDirector.ExpertSet

caused loading and planning failures before we fixed the engine.

### Plan

Keep validation strict about:

- exact whole-object JSON outputs
- exact canonical node existence
- exact binding materialization

No fuzzy matching, no alias guessing.

### Why this matters

These are high-value structural edges in complex blueprints.
If they fail, they should fail early and clearly.

———

### 5. Improve asset-only validation semantics

### Plan

Validation should explicitly understand:

- top-level published outputs count as connected endpoints
- asset-only blueprints do not need timeline/exporter tails
- producer-contract inputs/outputs should not create noisy false warnings just because the graph ends at publication

### Why this matters

It reduces false noise and makes the real problems easier to see.

———

### 6. Add semantic lint hooks for advanced blueprint assumptions

Some problems are not pure graph-shape errors.
They are semantic-contract errors.

Example from this session:

- StartEnd clips depended on the first two plain stills
- but the planning contract did not originally guarantee those stills would be plain

### Plan

Add optional semantic lint metadata for blueprints.

Examples:

- StartEnd requires image slots 0 and 1 to be plain
- Reference workflow requires exactly one historical character selected
- Talking-head requires portrait + audio

Then validation can check:

- blueprint wiring
- prompt producer schema
- prompt producer instructions
  against those declared assumptions

### Why this matters

It catches “architecturally valid but semantically contradictory” blueprints earlier.

———

## Workstream 3: Improve Dry-Run

### Goal

Make dry-run more like real execution, and much easier to debug.

### 1. Enforce provider-required inputs identically in simulated mode

### Problem seen in this session

The ElevenLabs voice issue did not fail in dry-run, even though live execution failed.

### Plan

Every simulated provider path should use the same payload-building and required-field enforcement as live execution.

Dry-run should never skip:

- required schema field checks
- canonical input lookup checks
- provider config checks

### Why this matters

A green dry-run must mean “structurally executable,” not “simulation was lenient.”

———

### 2. Add a “planned vs executed inputs” debug section for failed jobs

### Problem seen in this session

We had to manually inspect the saved plan to learn that:

- the plan contained the prompt binding
- but execution lost it later

### Plan

When a dry-run job fails because of a missing required input, print:

- planned binding for that alias
- whether it was filtered by conditions
- whether it was present in resolved inputs at execution time
- which conditions were satisfied or unsatisfied

Example output:

- Prompt planned as Artifact:HistoricalReferenceStillPromptProducer.Prompt[0][0][1]
- Prompt removed because condition X was unsatisfied
- SourceImages[0] remained active under no condition
- Job still executed because unconditional artifact inputs remained

### Why this matters

It would have saved a lot of time in this session.

———

### 3. Improve skip diagnostics for conditional jobs

### Plan

For skipped jobs, dry-run should clearly say:

- skipped because all conditional inputs were inactive
- or skipped because upstream failed
- or skipped because layer trimming excluded prerequisite branch

And for executed conditional jobs, it should be able to print:

- which branch activated them

### Why this matters

Right now too much of the branching behavior is invisible unless we inspect snapshots by hand.

———

### 4. Add better coverage generation for condition fields

### Problem seen here

Dry-run succeeds now, but coverage still reports partial branch coverage for:

- ImagePlans[*].UseHistoricalReference
- MotionPlan.Workflow

### Plan

Improve dry-run validation case generation so it deliberately explores:

- both boolean outcomes
- enum branches like Text, Reference, StartEnd, MultiShot
- at least one representative reference selection per looped dimension

Also allow blueprint authors to optionally provide:

- coverage hints
- representative branch cases
- required workflow coverage expectations

### Why this matters

Advanced blueprints need smarter coverage than simple random or shallow branch sampling.

———

### 5. Add a preflight mode before full dry-run execution

### Plan

Introduce a lightweight structural preflight that runs before dry-run execution:

- viewer projection check
- provider required-field preflight
- canonical binding existence check
- conditional coherence check
- unresolved artifact/input check

This would be faster than a full dry-run and would catch many failures earlier.

### Why this matters

Many of our failures were structural, not model-simulation failures.

———

### 6. Improve stage-limited dry-run behavior and messaging

### Problem seen earlier

Running only the first stage complained about condition artifacts from later unscheduled jobs.

We fixed the planner bug, but the dry-run messaging can still look suspicious when later-layer condition fields are absent.

### Plan

Make stage-limited dry-run explicitly say:

- later-layer condition fields were not expected in this run
- coverage only applies to scheduled layers

### Why this matters

It reduces noise and helps users trust partial runs.

———

## Suggested Implementation Order

### Phase 1: Highest impact, lowest ambiguity

- Update model-picker
- Update create-blueprint
- Add viewer-projection checks into CLI validation
- Add validation rule forbidding internal edges from published outputs
- Add better dry-run failure diagnostics for planned vs executed inputs

### Phase 2: Architectural maturity

- Update create-video
- Update director-prompt-engineer
- Add new authoring docs for asset-only and model-family execution patterns
- Add required-input condition coherence validation
- Add preflight mode before dry-run

### Phase 3: Advanced quality improvements

- Add semantic lint hooks for blueprint assumptions
- Improve dry-run branch coverage generation
- Add optional coverage hints / branch expectations for complex blueprints

———

## Expected Outcome

If we implement this plan, the next blueprint of this complexity should fail much earlier and much more usefully.

Instead of the sequence we had in this session:

- wrong abstraction generated
- references created but unused
- viewer-only graph failure
- late dry-run failure
- simulation/live mismatch
- deep condition-propagation debugging

we should get something more like:

- skills propose the right blueprint shape up front
- validation rejects the invalid graph wiring immediately
- preflight rejects conditionally incoherent jobs immediately
- dry-run behaves like live execution
- failures point to the exact missing binding or branch mismatch

That would make complex blueprints feel like a supported advanced path, not like a fight against hidden assumptions.