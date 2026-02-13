# Human-friendly plan for fixing array inputs with looped producers

## What is happening today

You give Renku an input like this:

- `CelebrityThenImages` is an array
- index `0` = first image
- index `1` = second image
- index `2` = third image

You wire it like this:

- `CelebrityThenImages[character] -> ThenImageProducer[character].SourceImages[0]`

So this should happen:

- producer run `0` gets image `0`
- producer run `1` gets image `1`
- producer run `2` gets image `2`

But two bad things happen today:

1. It can fail with:  
   `Missing required input "Input:CelebrityThenImages[0]"`
2. In some plans, producer run `0` can incorrectly get image index `2` (wrong mapping).

---

## Why the missing-input error happens

Renku stores your input array as one key/value:

- key: `Input:CelebrityThenImages`
- value: `[img0, img1, img2]`

Later, runtime asks for:

- `Input:CelebrityThenImages[0]`

That exact key does not exist, so it says "missing input" even though the value is inside the parent array key.

Simple analogy:

- You have one box named `CelebrityThenImages` with 3 photos inside.
- Code asks for a separate box named `CelebrityThenImages[0]`.
- It does not open the first box and pull photo `0`.
- It just says the second box is missing.

---

## Why the wrong index can appear

When Renku prepares loop jobs (`ThenImageProducer[0]`, `[1]`, `[2]`), it builds input mappings for each job.

In this specific path, mapping data from one loop run can overwrite mapping data from another run.

Result:

- job `0` can end up pointing to source index `2` instead of `0`.

So this is not one bug, it is two bugs:

1. runtime cannot read `array[index]` from stored whole-array input
2. planner/expander can assign the wrong index to the wrong loop job

---

## The fix

## Fix 1: Runtime will resolve indexed input IDs from parent arrays

When runtime asks for `Input:CelebrityThenImages[0]`, it will:

1. try exact key first
2. if not found, recognize this is indexed access
3. look up parent key `Input:CelebrityThenImages`
4. verify parent is an array
5. return element at index `0`

### Example

If resolved inputs include:

- `Input:CelebrityThenImages = ["a.jpg", "b.jpg", "c.jpg"]`

then:

- `Input:CelebrityThenImages[0]` returns `"a.jpg"`
- `Input:CelebrityThenImages[1]` returns `"b.jpg"`

### Invalid access will fail fast with a clear error

We will throw a specific SDK error when:

- parent exists but is not an array
- index is out of range
- index format is invalid

No silent fallback and no guessing.

---

## Fix 2: Planner/expander will stop cross-loop index overwrites

When creating job input mappings, we will enforce that each loop job only receives the source value from the same loop index.

After fix:

- `ThenImageProducer[0]` maps to `Input:CelebrityThenImages[0]`
- `ThenImageProducer[1]` maps to `Input:CelebrityThenImages[1]`
- `ThenImageProducer[2]` maps to `Input:CelebrityThenImages[2]`

No loop run can overwrite another run's mapping.

---

## Files to change

1. `providers/src/sdk/transforms.ts`

- add indexed canonical input resolver logic
- use that resolver in all mapping read paths (direct mapping, conditions, combine, element reconstruction)

2. `core/src/resolution/canonical-expander.ts`

- fix per-loop mapping assignment so each loop job keeps the correct source index

3. `core/src/errors/codes.ts`

- add SDK error code for invalid indexed input access

---

## Tests to add

### Core tests

File: `core/src/resolution/canonical-expander.test.ts`

- add a test for this exact wiring pattern
- assert job `0` gets index `0`, job `1` gets index `1`, job `2` gets index `2`

### Provider transform t

File: `providers/src/sdk/transforms.test.ts`

- indexed input resolves from parent array
- nested indexed array resolution works
- non-array parent throws clear error
- out-of-range index throws clear error

### Provider runtime tests

File: `providers/src/sdk/runtime.test.ts`

- verify payload build throws explicit indexed-access error for invalid index

### Optional end-to-end test

Add a CLI fixture and dry-run e2e test mirroring your reproduction so this cannot regress.

---

## Acceptance criteria

The fix is done when:

1. valid indexed array access works without missing-input error
2. invalid indexed access fails with a clear, specific error
3. looped producer jobs receive matching source indices
4. existing artifact-based indexed-collection behavior still passes

---

## Important implementation guardrails

- Keep canonical IDs end-to-end.
- Do not add alias-based fallback lookups.
- Do not add silent default values.
- Fail fast with explicit errors when bindings are invalid.



What works today
  2. Whole-array inputs work.
     Example: tests load InputImages as an array and pass it directly to image_urls with no [index] dereference
     at runtime.
     See cli/tests/end-to-end/blob-input.e2e.test.ts:200 and cli/tests/end-to-end/blob-input.e2e.test.ts:213.
  3. Artifact-to-collection-index wiring works.
     Example: ReferenceImages[0] and [1] are bound to artifact outputs, and tests assert that exact behavior.
     See cli/tests/fixtures/blueprints/indexed-collection-binding.yaml:89 and cli/tests/end-to-end/indexed-
     collection-binding.e2e.test.ts:93.
  4. Input parsing/serialization of arrays works.
     See core/src/parsing/input-loader.test.ts:638 and core/src/parsing/input-loader.test.ts:669.
  5. What is broken
  6. Runtime lookup for indexed canonical inputs does exact-key lookup only.
     In applyMapping, it does context.inputs[canonicalId] directly.
     See providers/src/sdk/transforms.ts:80 and providers/src/sdk/transforms.ts:85.
  7. Planning stores whole input events as given canonical keys; it does not split arrays into per-index keys.
     See core/src/orchestration/planning-service.ts:229 and core/src/orchestration/planning-service.ts:247.
  8. So if binding points to Input:Foo[0] but resolved inputs only have Input:Foo, runtime misses it.
  9. I verified this with real runs (not theory)
  10. I ran your repo’s own transcription fixture blueprint (NarrationScript[segment] ->
     AudioProducer[segment].Text).
  11. It failed with:
     Missing required input "Input:NarrationScript[0]" ...
     and similarly for [1] and [2].
  12. That blueprint line is here: cli/tests/fixtures/blueprints/transcription-path-resolution/transcription-
     path-resolution.yaml:61.
  13. Why this was not caught by the e2e test: that test mocks AudioProducer and returns success without building
     payload from inputs.
     See cli/tests/end-to-end/transcription-audio-path-resolution.e2e.test.ts:133 through cli/tests/end-to-end/
     transcription-audio-path-resolution.e2e.test.ts:149.
  14. About the “wrong index 2 for job 0” claim
  15. I also created a throwaway repro in this repo with your exact pattern:
     CelebrityThenImages[character] -> ThenImageProducer[character].SourceImages[0].
  16. Generated bindings showed SourceImages[0] mapped to Input:CelebrityThenImages[2] for jobs [0], [1], and
     [2].
  17. That matches your observed index-mismatch bug.
  18. The suspect code path is this propagation block, which iterates element inputs broadly and can overwrite
     per-loop bindings:
     core/src/resolution/canonical-expander.ts:735 to core/src/resolution/canonical-expander.ts:748.