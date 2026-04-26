# Architecture Plan: Schema-Driven Model Inputs, Tested Against Seedance And Kling O3

  ## Summary

  The goal is to remove `flattenFanIn` and replace it with a real, schema-driven input projection layer.

  The architecture should be tested against concrete provider contracts, not a hypothetical future model. The implementation must prove it works for:

  - `fal-ai/bytedance/seedance-2.0/reference-to-video`
  - `fal-ai/bytedance/seedance-2.0/fast/reference-to-video`
  - `fal-ai/kling-video/o3/standard/reference-to-video`
  - `fal-ai/kling-video/o3/pro/reference-to-video`

  The Kling O3 schemas are especially important because they are more complex than Seedance. They include:

  - top-level `image_urls` arrays referenced as `@Image1`, `@Image2`,
  - nested `elements[]` objects referenced as `@Element1`, `@Element2`,
  - element fields such as `frontal_image_url`, `reference_image_urls[]`, and `video_url`,
  - scalar fields such as `start_image_url` and `end_image_url`,
  - `prompt` / `multi_prompt` shape rules.

  Provider docs used:

  - https://fal.ai/models/fal-ai/kling-video/o3/standard/reference-to-video/api
  - https://fal.ai/models/fal-ai/kling-video/o3/pro/reference-to-video/api
  - https://fal.ai/models/bytedance/seedance-2.0/reference-to-video/api
  - https://fal.ai/models/bytedance/seedance-2.0/fast/reference-to-video/api

  ## Key Terms

  - **Producer input name**: the name declared in producer YAML, such as `Prompt`, `Duration`, `ReferenceImages`, `VideoSegments`.
  - **Canonical input ID**: Renku’s exact internal graph ID for a concrete input, such as `Input:SeedanceVideoGenerator[segment].ReferenceImages`.
  - **Input binding**: the planner-created table that connects a producer input name to its canonical input ID.

  Example:

  ```ts
  {
    ReferenceImages: "Input:SeedanceVideoGenerator[segment].ReferenceImages",
    Duration: "Input:SeedanceVideoGenerator[segment].Duration"
  }
  ```

  Runtime code may use the producer input name plus this exact table. It must not build, parse, slice, pattern-match, or infer canonical IDs.

  ## Public Interface Changes

  Remove `flattenFanIn` from:

  - core mapping types,
  - provider transform implementation,
  - producer YAML mappings,
  - web docs,
  - skills guidance.

  Add schema-driven model input projection:

  - normal schema array fields receive plain arrays,
  - scalar schema fields receive scalar values,
  - nested object-array schema fields can be built from grouped fan-in,
  - Renku-owned internal fields can request grouped fan-in explicitly.

  Add Renku schema metadata where needed:

  ```json
  "x-renku-shape": "fanIn"
  ```

  This means “preserve grouped fan-in metadata for an internal Renku producer,” not “send this shape to an external provider.”

  ## Runtime Input API

  Add a shared runtime API used by external provider handlers and Renku-native handlers.

  Planned calls:

  ```ts
  runtime.inputs.value("Duration")
  runtime.inputs.fanIn("ReferenceImages")
  runtime.inputs.buildModelInput(mapping, schema)
  ```

  Behavior:

  - `value("Duration")`
    - reads `inputBindings.Duration`,
    - fetches that exact canonical ID from resolved inputs,
    - returns the scalar value,
    - fails fast if the binding or value is missing.

  - `fanIn("ReferenceImages")`
    - reads `inputBindings.ReferenceImages`,
    - fetches that exact canonical fan-in value,
    - returns the grouped collection,
    - fails fast if the binding is missing or the value is not fan-in.

  - `buildModelInput(mapping, schema)`
    - projects producer inputs into the exact shape requested by the model schema.

  Handlers should stop doing things like:

  ```ts
  `Input:${producerName}.${inputName}`
  ```

  or scanning keys by prefix. That is the class of hack this removes.

  ## Projection Rules

  ### Plain Arrays

  Seedance uses this shape:

  ```json
  "image_urls": {
    "type": "array",
    "items": { "type": "string", "format": "uri" }
  }
  ```

  A fan-in input mapped to `image_urls` becomes:

  ```json
  {
    "image_urls": ["image-1", "image-2"]
  }
  ```

  The existing file resolver then uploads local blobs because the schema says the array items are URI strings.

  ### Scalars

  A scalar schema field such as `start_image_url` receives one scalar value.

  If a fan-in collection is mapped to a scalar field, projection fails unless the mapping explicitly uses an existing transform such as `firstOf`.

  No silent “first item” behavior.

  ### Nested Object Arrays For Kling O3

  Kling O3 requires object arrays:

  ```json
  {
    "elements": [
      {
        "frontal_image_url": "...",
        "reference_image_urls": ["..."]
      }
    ]
  }
  ```

  The projection layer should support target field paths into array items, for example:

  ```yaml
  ElementFrontalImages:
    field: elements[].frontal_image_url

  ElementReferenceImages:
    field: elements[].reference_image_urls
  ```

  Rules:

  - A grouped fan-in source writes one `elements[index]` object per group.
  - If the target property is scalar, each group must resolve to exactly one value.
  - If the target property is an array, each group resolves to that property’s array.
  - Multiple mappings into the same `elements[]` array merge by group index.
  - Missing schema-required element properties fail validation.
  - Optional element properties, such as `video_url`, may be omitted.
  - Group order determines `@Element1`, `@Element2`, and so on.

  This is the concrete proof that the design handles more than Seedance’s simple top-level arrays.

  ### Internal Grouped Fan-In

  Timeline does not want provider-style arrays. It needs grouped metadata.

  For internal Renku schemas:

  ```json
  "videoSegments": {
    "x-renku-shape": "fanIn",
    "x-renku-itemType": "video"
  }
  ```

  Projection returns a structured grouped collection:

  ```ts
  {
    groupBy: "segment",
    orderBy: "segment",
    groups: [
      [{ id: "Artifact:...", value: ... }],
      [{ id: "Artifact:...", value: ... }]
    ]
  }
  ```

  External provider schemas should not receive this Renku metadata.

  ## TimelineComposer Changes

  Add a real input schema for `renku/timeline/ordered`.

  It should define:

  - grouped inputs:
    - `imageSegments`
    - `videoSegments`
    - `audioSegments`
    - `transcriptionAudio`
    - `textSegments`
    - `music`

  - scalar/system inputs:
    - `duration`
    - `movieId`
    - `movieTitle`
    - `storageRoot`
    - `storageBasePath`

  Update Timeline mappings so every consumed value is mapped explicitly by producer input name.

  Timeline should consume the projected model input payload and stop:

  - constructing canonical IDs,
  - parsing bracket syntax from input references,
  - scanning resolved input keys by prefix,
  - reading hard-coded canonical input IDs for normal producer inputs.

  Timeline still keeps its real grouped behavior; the schema asks for that grouped shape explicitly.

  ## Seedance Requirements

  Seedance reference producers should map plainly:

  ```yaml
  ReferenceImages:
    field: image_urls
  ReferenceVideos:
    field: video_urls
  ReferenceAudios:
    field: audio_urls
  ```

  Keep:

  - images optional,
  - videos optional,
  - audio optional,
  - fal’s rule that audio references require at least one image or video reference,
  - prompt guidance for `@Image1`, `@Video1`, and `@Audio1`.

  ## Kling O3 Requirements

  Use the actual fal schemas for both:

  - `fal-ai/kling-video/o3/standard/reference-to-video`
  - `fal-ai/kling-video/o3/pro/reference-to-video`

  Add projection tests against both schemas.

  The tests must cover:

  - top-level `image_urls` from fan-in to plain URI array,
  - `start_image_url` and `end_image_url` as scalar URI fields,
  - `elements[].frontal_image_url` from grouped fan-in to scalar element fields,
  - `elements[].reference_image_urls` from grouped fan-in to array element fields,
  - merged element objects by group index,
  - provider upload resolution inside both top-level arrays and nested element arrays,
  - prompt label order matching final payload order:
    - `image_urls[0]` is `@Image1`,
    - `elements[0]` is `@Element1`.

  Do not implement Kling as a special case. The same projection layer must pass both Seedance and Kling tests because the schema and mapping request those shapes.

  ## Historical Documentary Fix

  Keep the corrected historical-character wiring:

  ```yaml
  HistoricalCharacterAssetsProducer[historicalcharacter]
  ```

  Do not use fixed `[0]`.

  Acceptance criteria:

  - each segment receives references for the selected historical characters for that segment,
  - reference order is deterministic through `groupBy` and `orderBy`,
  - no reference selection uses canonical ID parsing or name extraction.

  ## Docs And Skills

  Web docs:

  - Keep `fanIn`, `groupBy`, and `orderBy` out of `index.mdx`.
  - Teach them in `blueprint-authoring.mdx`.
  - Explain `fanIn` as “collect many outputs into one input list.”
  - Explain `groupBy` as “how many lists Renku creates.”
  - Explain `orderBy` as “the order inside each list.”
  - Remove `flattenFanIn`.
  - Document provider mapping field paths, including nested object-array paths like `elements[].reference_image_urls`.
  - Restore useful YAML comments in reference sections.
  - Remove unsupported syntax.

  Skills repo:

  - Remove `flattenFanIn` guidance.
  - Add guidance for schema-driven projection.
  - Add concrete Seedance and Kling O3 prompt-label guidance.
  - Reinforce exact input bindings and canonical-ID opacity.

  Writing to `/Users/keremk/Projects/aitinkerbox/skills/skills` requires filesystem approval because it is outside the Renku writable root.

  ## Phase Plan

  ### Phase 1: Shared Projection Layer

  Create a subagent for core/provider runtime work.

  Tasks:

  - Add producer-input-name based runtime accessors.
  - Add schema-driven model input projection.
  - Add nested object-array projection support for `elements[].field`.
  - Add grouped fan-in output for `x-renku-shape: "fanIn"`.
  - Remove `flattenFanIn` from mapping types and transform code.
  - Make `runtime.sdk.buildPayload` delegate to the new projection path.

  Focused tests:

  - Seedance fan-in to `image_urls`, `video_urls`, `audio_urls`.
  - Kling O3 standard nested `elements[]`.
  - Kling O3 pro nested `elements[]`.
  - scalar mismatch failure.
  - empty optional fan-in skip.
  - unresolved fan-in member failure.

  ### Phase 2: Internal Handler Migration

  Create a subagent for Timeline and Renku-native handlers.

  Tasks:

  - Add the `renku/timeline/ordered` input schema.
  - Update Timeline mappings.
  - Refactor Timeline to consume projected model input.
  - Remove canonical-ID construction/parsing from Timeline.
  - Move overlapping SubtitlesComposer and VideoStitcher fan-in access to the shared API where practical.

  Preserve behavior for:

  - master tracks,
  - empty conditional groups,
  - segment duration inference,
  - transcription/audio alignment.

  ### Phase 3: Catalog, Docs, And Skills

  Create a subagent for catalog/docs/skills work.

  Tasks:

  - Remove `flattenFanIn` from Seedance mappings.
  - Keep optional Seedance image/video/audio references.
  - Keep fal schema constraints.
  - Add projection contract tests for the two concrete Kling O3 schemas.
  - Verify historical documentary reference wiring remains segment-specific.
  - Update web docs.
  - Update skills repo after approval for cross-root writes.

  ## Verification Plan

  Use focused tests during phases. Do not run full `pnpm test` after every phase.

  Planned checks:

  - `pnpm test:providers`
  - `pnpm validate:producers`
  - `pnpm validate:catalog-blueprints`
  - `pnpm --filter @gorenku/web build`
  - `pnpm build`

  Run full `pnpm test` only if the integrated cross-package changes justify the time.

  No `git add`, no `git commit`, and no destructive git commands.

  ## Assumptions

  - Removing `flattenFanIn` is acceptable because the product has not shipped.
  - Existing working-tree changes are revised in place, not reset.
  - `x-renku-*` schema metadata is acceptable for Renku-owned behavior.
  - Provider schemas define payload shape.
  - Prompt producers define semantic language, but payload projection defines deterministic label order.