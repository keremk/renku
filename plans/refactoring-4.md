Here’s the full brief for the next pass:

  Architectural principles:

  - Use canonical IDs only; no fallbacks or alias lookups at runtime. If a required canonical input is missing, throw.
  - Collapsing rules:
      - Input fed by another Input: treat downstream input as the upstream; discard the downstream input node/value.
      - Artifact fed into an Input: collapse to the artifact and discard the input, except when the input is a fan-in target (then
        keep the fan-in input).
  - Inputs and artifacts should not have parallel defaulted values fighting each other; connectivity must determine which value flows.
  Desired flow:

  1. Parsing (loadInputsFromYaml):
      - Resolve authored keys to canonical IDs; apply defaults. This may create both root and scoped canonical inputs (e.g.,
        Input:NumOfImagesPerNarrative=3 and Input:ImagePromptProducer.NumOfImagesPerNarrative=1).
  2. Pre-expansion input source map (canonical graph, no indices):
      - Consider only Input→Input edges.
      - For each Input (non fan-in):
          - If exactly one upstream Input, map this canonical input ID to the upstream canonical input ID.
          - If multiple upstream inputs, throw.
          - If no upstream inputs, map to itself.
      - Fan-in inputs are left as themselves. They aggregate all the artifacts in an array with canonical IDs.
      - No artifact handling here (artifact→input collapse happens later, post-expansion).
  3. Normalize inputValues using that map:
      - For each Input:* entry, rewrite it to its source canonical ID (from the map) and drop the downstream key. The result should keep only
        the source canonical IDs (e.g., only Input:NumOfImagesPerNarrative=3, not Input:ImagePromptProducer.NumOfImagesPerNarrative=1).
  4. Dimension sizing:
      - Use the normalized inputs.
      - readInputValue builds the canonical ID from namespacePath + name, resolves to the source via the map
        (sources.get(canonical) ?? canonical), then looks up that canonical ID in the normalized inputs; throw if missing. No layered
        fallbacks.
      - This ensures countInput sees the upstream value (3) and sizes loops correctly.
  5. Expansion and post-expansion collapsing:
      - Expand nodes with computed sizes.
      - collapseInputNodes on the expanded graph collapses:
          - Input→Input: downstream input dropped.
          - Artifact→Input (non fan-in): input dropped, artifact retained.
          - Fan-in inputs preserved.
      - Build inputBindings and fan-in collections as before.

  What’s broken now:
  - We are trying to execute and pass the e2e test: cli/tests/end-to-end/image-audio.e2e.test.ts
  - We still produce 8 jobs; normalization/source-map isn’t removing the scoped default before sizing.

  What to implement/fix:

  - Ensure only one buildInputSourceMapFromCanonical exists, following the Input→Input-only logic and self-mapping when no upstream
    input.
  - normalizeInputValues and readInputValue must use the Map’s .get (no .identity).
  - Confirm normalization drops Input:ImagePromptProducer.NumOfImagesPerNarrative and preserves Input:NumOfImagesPerNarrative=3 so
    sizing uses 3.

  Then rerun the image-audio e2e; expect 12 jobs without adding scoped overrides.