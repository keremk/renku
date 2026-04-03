Issues identified and proposed changes

  Six distinct problems caused rework:

  1. Added unrequested media tracks (narration, music, transcription)
  2. Hardcoded individual image inputs instead of an array input with a loop (had to be corrected to celebrity-then-now pattern)
  3. Constant index [0] on a director output sub-field path → validator rejected it
  4. Mixed scalar + looped fan-in to timeline → R012 error (undocumented)
  5. Cross-dimension collection broadcast via [styleImage] loop → R041 error (undocumented)
  6. Prompt producer producer.yaml had wrong top-level sections added by the director-prompt-engineer subagent

  Here are the proposed changes:

  ---
  Change 1 — skill.md: Add a rule against assuming media tracks

  In ## Critical Rules, add rule 11:

  11. **Only add the media tracks the user explicitly requested.** Narration/TTS, background music, and transcription/karaoke are NOT implicit requirements — they must be
   explicitly requested. Never add them speculatively. Step 2 covers Style, Audience, and Duration structure only.

  ---
  Change 2 — skill.md: Add guidance on variable user-provided image arrays

  In ### Step 5: Determine Inputs and Artifacts, add a new subsection after the artifacts checklist:

  **User-provided image arrays:**
  When the user will supply multiple images of the same kind (e.g., 2–3 style reference images, a set of character photos), use:
  - `type: array, itemType: image` on the input (not individual `image` inputs)
  - A companion `NumOf<Thing>` count input
  - A `<thing>` loop with `countInput: NumOf<Thing>`

  To broadcast the ENTIRE array as a collection to a looped producer (e.g., all style images → every CharacterImageProducer), wire it directly:
  ```yaml
  - from: StyleReferenceImages
    to: CharacterImageProducer[character].SourceImages  # whole-collection broadcast
  Do NOT attempt to use a second loop dimension to index into it (e.g., StyleReferenceImages[styleImage] → Producer[character].Input[styleImage] causes R041 — conflicting
   input binding when dimensions don't align).

  To give each producer instance a specific element (one image per character), index by the producer's loop dimension:
  - from: CelebrityImages[character]
    to: ImageProducer[character].SourceImages[0]
  See celebrity-then-now for the reference pattern.

  ---

  ### Change 3 — `skill.md` + `comprehensive-blueprint-guide.md`: Constant index on sub-field paths is invalid

  **In `skill.md`, Step 6 `Connection patterns`**, add:

  ```markdown
  **Constant-index sub-field access is NOT supported:** You cannot use a hardcoded index followed by a field name: `Director.Episode.Scenes[0].VideoPrompt` →
  **rejected**. The validator treats `[0]` as attempting to declare a dimension.

  **Fix:** If you need a value that is logically "scene 0 only" (e.g., an opening scene image prompt), make it a **top-level scalar field** in the director output instead
   of an array element:
  ```yaml
  # ✅ Director output field — top-level scalar
  - from: EpisodeDirector.Episode.InitialSceneImagePrompt
    to: InitialSceneImageProducer.Prompt

  # ❌ Constant index + sub-field — REJECTED by validator
  - from: EpisodeDirector.Episode.Scenes[0].SceneImagePrompt
    to: InitialSceneImageProducer.Prompt
  When you find yourself reaching for [0], ask whether that field should be a separate scalar in the director schema.

  ---

  ### Change 4 — `skill.md` + `common-errors-guide.md`: Document R012

  **In `skill.md`, Step 6**, add to connection patterns:

  ```markdown
  **Cannot mix scalar and looped sources into the same fan-in (R012):** If one connection to `TimelineComposer.VideoSegments` is scalar (no loop) and another is looped
  (e.g., `extension` dimension), you get:
  > R012: mixed upstream dimension signatures `[]`, `[extension]`

  **Fix:** Use a single loop for all video producers so all fan-in sources share the same dimension. The proven pattern is `image-to-video` with `[scene-1].LastFrame →
  [scene].StartImage` chaining for all scenes in one `scene` loop — avoid a separate "first scene" producer + an "extension" loop.

  In common-errors-guide.md, add a new entry:

  ### R012: Mixed Upstream Dimension Signatures

  **Error:** A fan-in target (e.g., `TimelineComposer.VideoSegments`) receives connections from sources with different dimension signatures — for example, one scalar
  source and one looped source.

  **Example:**
  ```yaml
  # ❌ Scalar + looped to same fan-in
  - from: FirstSceneProducer.GeneratedVideo       # no loop dimension = []
    to: TimelineComposer.VideoSegments
  - from: ExtendVideoProducer[ext].GeneratedVideo  # [ext] dimension
    to: TimelineComposer.VideoSegments

  Fix: Ensure all connections into the same fan-in target share the same dimension. Use a single loop for all video generation:
  loops:
    - name: scene
      countInput: NumOfSegments

  producers:
    - name: SceneVideoProducer
      producer: video/image-to-video
      loop: scene          # ALL scenes in one loop — no scalar/looped mismatch

  connections:
    - from: InitialImage
      to: SceneVideoProducer[0].StartImage         # constant index for first frame
    - from: SceneVideoProducer[scene-1].LastFrame
      to: SceneVideoProducer[scene].StartImage     # sliding window for the rest
    - from: SceneVideoProducer[scene].GeneratedVideo
      to: TimelineComposer.VideoSegments           # single dimension — no conflict

  ---

  ### Change 5 — `common-errors-guide.md`: Document R041

  **Add a new entry:**

  ```markdown
  ### R041: Conflicting Input Binding (Cross-Dimension Collection)

  **Error:** Two connections try to bind different values to the same producer input for the same loop instance via cross-dimension indexing.

  **Example:**
  ```yaml
  # ❌ styleImage loop × character loop = conflicting bindings for CharacterImageProducer[0]
  - from: StyleReferenceImages[styleImage]
    to: CharacterImageProducer[character].SourceImages[styleImage]
  When NumOfStyleImages: 2 and NumOfCharacters: 2, the planner creates bindings StyleReferenceImages[0] AND StyleReferenceImages[1] for
  CharacterImageProducer[0].SourceImages, causing a conflict.

  Fix: Use whole-collection broadcast instead — wire the entire array directly:
  # ✅ Broadcast the whole array as a collection to every character producer
  - from: StyleReferenceImages
    to: CharacterImageProducer[character].SourceImages
  Drop the styleImage loop entirely. The StyleReferenceImages array is passed as-is to each character's SourceImages collection.

  ---

  ### Change 6 — `skill.md` + new reference doc: Prompt producer YAML structure

  **In `skill.md`, Step 4**, add after the delegation paragraph:

  ```markdown
  **Prompt producer YAML structure:** `producer.yaml` has only these valid top-level sections: `meta`, `inputs`, `artifacts`, `loops`. Configuration for the prompt file
  and output schema belongs in `meta`:
  ```yaml
  meta:
    id: MyDirector
    kind: producer
    promptFile: ./prompts.toml      # ← here, not as a top-level section
    outputSchema: ./output-schema.json
  There is NO top-level type:, prompts:, or output: section. If the director-prompt-engineer subagent generates these, remove them.

  ---

  ### Change 7 — `skill.md` Step 1: Check existing blueprints first

  **Add to `### Step 1: Gather Requirements`**:

  ```markdown
  **Before designing, scan existing blueprints in the workspace** (`ls ~/videos/` or similar) for patterns that match your use case. Blueprints like `animated-cartoon`,
  `continuous-video`, and `celebrity-then-now` demonstrate proven connection patterns (last-frame chaining, variable image arrays, mixed fan-in from multiple looped
  producers). Reading one similar blueprint before designing will prevent most structural errors.

  ---
  Change 8 — skill.md Step 9: Verify model names from catalog

  In ### Step 9: Test with Dry Run, add before the code block:

  **Model names must match the catalog exactly.** Before writing model selections in `input-template.yaml`, verify names:
  ```bash
  grep "name:" /path/to/catalog/models/fal-ai/fal-ai.yaml | grep <keyword>
  # e.g., grep "name:" catalog/models/fal-ai/fal-ai.yaml | grep seedream
  # → bytedance/seedream/v4.5/edit   (not "bytedance/seedream-4.5")
  Names use / path separators and include version+variant suffixes.