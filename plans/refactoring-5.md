Here’s the detailed summary of what changed for the Replicate video provider and its integration tests:

  ### Replicate video handler (providers/src/producers/video/replicate-video.ts)

  - Simplified to a schema/mapping-only wrapper:
      - Uses runtime.sdk.buildPayload() to assemble the input strictly from sdkMapping and inputBindings provided in jobContext.
      - Requires and validates the model’s input schema (extras.schema.input) via validatePayload; throws if missing.
      - No defaults, merges, or heuristic fallbacks. Removed custom prompt/image/negative/last-frame resolution logic, resolution/
        aspect ratio guessers, and providerConfig default merging.
      - Fixed output MIME type is now a constant (video/mp4).
      - Diagnostics no longer track heuristic flags (hasImage, etc.); they report the validated input and output URLs.

  ### Video unit test (providers/src/producers/video/replicate-video.test.ts)

  - Rewritten around the schema-first, mapping-driven behavior:
      - Provides typed extras with jobContext mappings and resolvedInputs.
      - Tests fail fast on missing required inputs, missing schema, and schema validation errors.
      - Added simulated-mode check to ensure validation also applies in dry-run/simulated mode.
      - Removed coverage of old fallback behaviors (images, optional negatives, merging defaults, etc.).

  ### Integration helper (providers/tests/integration/schema-helpers.ts)

  - Provides schema-aware extras for video tests:
      - Uses per-model schema paths (relative to providers/tests/integration) to load the actual JSON schema.
      - Hardcoded mapping mirrors catalog/blueprints/modules/producers/video.yaml (Prompt→prompt, AspectRatio→aspect_ratio,
        Resolution→resolution, SegmentDuration→duration), per model.
      - Validates that schema contains mapped fields; builds inputBindings/sdkMapping accordingly.
      - Exposes getVideoMapping for reuse.

  ### Integration test (providers/tests/integration/replicate-video.int.test.ts)

  - Single text-to-video test driven by one selected model via env flags (RUN_VIDEO_SEEDANCE_PRO_FAST / RUN_VIDEO_SEEDANCE_LITE /
    RUN_VIDEO_VEO_FAST / RUN_ALL_VIDEO_TESTS). Throws if multiple models are enabled.
  - Input construction:
      - Loads the model’s schema and uses defaults for mapped fields when present.
      - Hardcodes cost-sensitive fields: duration=2s; resolution=480p (or 720p for Veo).
      - Supplies a basic value (e.g., 16:9) for required fields without schema defaults (e.g., aspect_ratio).
      - Prompt is provided explicitly; no other heuristics.
  - Only one test remains (text-to-video); image/negative/interpolation cases were removed to keep scope minimal and cost low.
  - Uses buildVideoExtras to wire resolvedInputs, sdkMapping, and inputBindings consistently; no providerConfig defaults/
    customAttributes.

  ### Paths and housekeeping

  - Fixed schema path resolution for integration tests (relative to providers/tests/integration).
  - All type checks pass: pnpm --filter @tutopanda/providers type-check and pnpm --filter @tutopanda/providers test:typecheck.
  - Integration run should be invoked with a single model flag and pnpm --filter @tutopanda/providers test:integration.

  ### Core principles applied

  - Fail fast: no fallbacks, no guessing; missing schema or required input throws before calling Replicate.
  - Schema/mapping as the single source of truth for inputs; providerConfig defaults/customAttributes are ignored.
  - Cost minimization in integration: lowest allowed duration/resolution are hardcoded where defaults would otherwise be higher.