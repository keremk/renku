# Blueprint Condition Semantics

Blueprint conditions have one primary job: they describe which branch of the
graph is active. Keep that branch decision on the import or producer that owns
the branch.

## Import And Producer Activation

Use `if:` on `imports:` when a producer should run only in a branch:

```yaml
imports:
  - name: AudioProducer
    producer: audio/text-to-speech
    loop: segment
    if: hasNarration
```

When `hasNarration` is false, the whole `AudioProducer[segment]` job is
inactive. The runner skips the job as a unit.

## Required Inputs In Active Branches

Inside an active branch, required scalar inputs are unconditional. Do not put
`if:` on required input bindings:

```yaml
connections:
  - from: ScriptProducer.Script[segment].Narration
    to: AudioProducer[segment].Text
  - from: SegmentDuration
    to: AudioProducer[segment].Duration
```

If `AudioProducer[segment]` is active, both `Text` and `Duration` must be bound
and available. Missing required inputs are validation errors. Renku must not
choose between multiple conditional sources for one required scalar input.

## Valid Edge Conditions

Keep edge-level conditions for routing, not branch activation. Edge conditions
are valid for:

- Public output routes, especially when multiple branches can publish the same
  output.
- Optional scalar inputs, where absence is part of the producer contract.
- Fan-in members, where a sparse collection intentionally includes only some
  upstream artifacts.

Example output route:

```yaml
connections:
  - from: TextClipProducer.GeneratedVideo
    to: GeneratedVideo
    if: useText
  - from: ReferenceClipProducer.GeneratedVideo
    to: GeneratedVideo
    if: useReference
```

Example optional input:

```yaml
connections:
  - from: CharacterProducer.Portrait
    to: ReferenceVideoProducer.ReferenceImage1
    if: useReference
```

`ReferenceImage1` is optional, so the edge condition describes whether that
optional input is present. It does not decide whether required inputs are
available.

Example fan-in member:

```yaml
connections:
  - from: AudioProducer[segment].GeneratedAudio
    to: TimelineComposer.AudioSegments
    if: hasNarration
```

`AudioSegments` is a fan-in input, so the condition selects collection members.

## Validation Expectations

Strict prepared validation is the default. A blueprint should fail validation
when:

- A required scalar input has an edge condition.
- A required scalar input has multiple conditional sources.
- A video or audio producer is missing a required `Duration` input declaration.
- A blueprint uses a video or audio producer without explicitly binding its
  `Duration` input.

Compatibility tests may opt out with `strictResolvedConditions: false`, but
production validation and catalog conformance should exercise strict semantics.
