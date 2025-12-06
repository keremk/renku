# YAML Blueprint Specification

This document defines the YAML surface that replaces the legacy TOML blueprints. It is intentionally verbose so an author (or parser implementer) can understand every moving part and how the generated plan ties back to canonical node IDs.

---

## 1. Repository layout
- **Top-level blueprints** live in `catalog/blueprints/*.yaml`. Each file describes a public workflow the CLI can execute (audio-only, image-only, image+audio, etc.).
- **Modules** live under `catalog/blueprints/modules/`. A module contains reusable node definitions (inputs, artefacts, producers) and can itself import other modules.
- **Prompt definitions** for LLM producers live in `catalog/blueprints/modules/prompts/*.toml`.
- **JSON schemas** referenced by those prompts live in `catalog/blueprints/modules/schemas/*.json`.

Every YAML file is parsed by `core/src/blueprint-loader/yaml-parser.ts` and ultimately produces the same `BlueprintTreeNode` structure the old TOML parser emitted.

---

## 2. File structure

Each blueprint YAML file follows the sections below. All fields are required unless explicitly marked optional.

### 2.1 `meta`
```yaml
meta:
  name: Image Only Narration
  id: ImageOnly
  version: 0.1.0
  author: Tutopanda
  license: MIT
  description: Optional free-form string
```
- `id` and `name` must be non-empty strings.
- `version`, `author`, `license`, `description` are optional but encouraged for traceability.

### 2.2 `inputs`
Array of input definitions:
```yaml
inputs:
  - name: InquiryPrompt
    description: Prompt describing the movie script.
    type: string            # string | int | image | audio | json | boolean ...
    required: true|false
    default: <value>        # required whenever `required: false`
```
Rules:
- Each `name` must be unique within the file.
- Optional inputs **must** provide `default`; this lets the CLI synthesize a complete input object before planning.
- `type` is a free-form string that flows through to validation/UI and eventually the providers.

### 2.3 `artifacts`
Array of artefact definitions:
```yaml
artifacts:
  - name: SegmentImage
    type: multiDimArray     # string describing the kind of payload.
    itemType: image         # optional, used for arrays.
    description: ...
    countInput: NumOfSegments   # optional reference to an input that sets multiplicity.
```
Rules:
- Names must be unique.
- `countInput` is how the parser knows the cardinality of a multi-instance artefact. It should point at an input declared in the same file.
- Artefacts inherit the namespace of the file (or module) in which they appear.

### 2.4 `loops`
Loops declare human-friendly dimension symbols:
```yaml
loops:
  - name: segment
    countInput: NumOfSegments
  - name: image
    parent: segment
    countInput: NumOfImagesPerNarrative
```
- `name` must be unique within the file.
- `parent` (optional) lets you express nested dimensions (e.g., `image` inside `segment`).
- `countInput` must reference an input defined in the same file.
- Loops **do not** automatically modify node IDs; they simply document the dimension symbols that authors must use in the connection references (see §2.6). The parser validates that a loop is declared before the symbol appears in local connections.

### 2.5 `modules`
Modules import other YAML files so you can compose complex workflows:
```yaml
modules:
  - name: ScriptGenerator        # namespace introduced in this file
    path: ./modules/script-generator.yaml
  - name: AudioGenerator
    path: ./modules/audio-generator.yaml
    loop: segment                # optional hint for documentation (current parser stores it but node IDs still come from connections)
```
- `name` is the namespace segment used when referring to nodes inside the module (e.g., `AudioGenerator.TextInput`).
- `path` is relative to the importing file.
- `loop` is an optional annotation authors can use to document the expected multiplicity (e.g., “we instantiate this module per segment”). Connections must still include the `[segment]` notation explicitly; the parser does **not** infer dimensions automatically.
- Cycles are rejected when the loader builds the tree.

### 2.6 `connections`
Edges wire inputs, producers, and artefacts:
```yaml
connections:
  - from: InquiryPrompt
    to: ScriptGenerator.InquiryPrompt
  - from: ScriptGenerator.NarrationScript[segment]
    to: AudioGenerator[segment].TextInput
```
Rules:
- Both `from` and `to` are required.
- References use dot-notation for namespaces and **square brackets** for each dimension symbol. Examples:
  - `ScriptGenerator.NarrationScript[segment]`
  - `ImageGenerator[segment][image].Prompt`
  - `TimelineComposer.ImageSegments`
- The parser rejects any `@symbol` usage. `[symbol]` is the only supported notation.
- You can omit the namespace when referring to nodes defined in the current file (e.g., `InquiryPrompt`).
- Dimension symbols must have been declared either in the current file’s `loops` section or inside the module where the node is defined. (The parser only validates symbols that belong to the current file; cross-module validation happens when the module file itself is parsed.)

### 2.7 `collectors`
Collectors provide first-class fan-in semantics:
```yaml
collectors:
  - name: TimelineImages
    from: ImageGenerator[segment][image].SegmentImage
    into: TimelineComposer.ImageSegments
    groupBy: segment
    orderBy: image
```
- The parser validates that `from` points at one or more artefact nodes and `into` references an input node. It marks the target input as `fanIn: true` so downstream consumers know to expect an array of canonical IDs.
- `groupBy` is required and must match a loop declared in the current file. This tells the runtime how to bucket artefacts (e.g., all `segment=0` images belong together).
- `orderBy` is optional metadata describing the secondary sort key within each group.
- During expansion the collector rewrites edges so producers receive a collection keyed by `groupBy`. No ad-hoc alias maps are needed—producers simply iterate over the array of canonical artefact IDs.

### 2.8 `producers`
Module YAML files define their producers inline:
```yaml
producers:
  - name: TextToImageProducer
    provider: replicate
    model: bytedance/seedream-4
    promptFile: ./prompts/image-prompt-producer.toml
    jsonSchema: ./schemas/image-prompt-producer.json
    sdkMapping:
      Prompt: { field: prompt, type: string, required: true }
    outputs:
      SegmentImage: { type: image, mimeType: image/png }
```
- `provider` and `model` are required.
- A producer can inline `settings`, `systemPrompt`, `userPrompt`, `jsonSchema`, `variables`, etc., or load them from a referenced `promptFile`.
- `promptFile` must be a TOML document with fields `model`, `textFormat`, `[settings]`, `variables`, `systemPrompt`, `userPrompt`, and optional nested `jsonSchema`.
- `jsonSchema` can be an inline JSON object/string or a path to a `.json` file.
- When both the YAML and the prompt file specify the same property, the YAML value wins (e.g., inline `systemPrompt` overrides the one embedded in TOML).

---

## 3. Dimension notation
- Dimensions are always written using square brackets (`Node[dimension]`).
- Multiple dimensions are written in order, e.g., `ImageGenerator[segment][image].Prompt`.
- Symbols are plain identifiers (letters, numbers, underscores). They should match entries in the surrounding file’s `loops` array.
- The parser throws if it encounters an `@` suffix or malformed brackets.
- The canonical expander later uses these symbols to compute node IDs such as `Artifact:ImageGenerator[segment=0][image=1].SegmentImage`.

---

## 4. Prompt & schema ingestion
- All prompt TOML files are resolved through the same FlyStorage abstraction the rest of core uses, so CLI and cloud runners read the exact same bytes.
- `promptFile` TOML keys:
  - `model`, `textFormat`, `variables`.
  - `[settings]` (arbitrary key/value pairs). If the TOML also contains `systemPrompt` or `userPrompt` inside `[settings]`, they are hoisted to the top level and removed from the settings bag.
  - `systemPrompt`, `userPrompt` as triple-quoted strings for multi-line content.
  - `jsonSchema`: either inline JSON or a path relative to the TOML file.
- JSON schemas are loaded as text and re-serialized (pretty-printed) into the producer config so downstream consumers don’t need to revisit the filesystem.

---

## 5. Parser behavior summary
1. Read YAML and reject anything that is not an object.
2. Parse `meta`, `inputs`, `artifacts`, `loops`, `modules`, `connections`, `collectors`, and `producers`.
3. Validate:
   - Optional inputs must have defaults.
   - Artefacts have unique names.
   - Loop names are unique.
   - Connection references do **not** use `@` and only mention dimensions declared in the current file.
4. Load external TOML/JSON resources via FlyStorage.
5. Return a `BlueprintDocument` with:
   - `meta`, `inputs`, `artefacts`, `producers`, `subBlueprints`, `edges`.
   - Sub-blueprints keep the `loop` property for future use, but canonical graph expansion still relies solely on the node IDs expressed in the `edges`.

--- 

## 6. Authoring checklist
1. Declare every user-facing input in `inputs`.
2. For any repeated artefact, add a `countInput`.
3. Use `loops` to name dimension symbols; reference them with `[symbol]` everywhere.
4. Import shared logic through `modules` and keep their namespaces consistent.
5. Wire everything with `connections` using the `[symbol]` notation—no `@` shortcuts.
6. Keep prompts in TOML for better editor support and embed schemas via JSON files.

Following this spec guarantees a single, deterministic canonical graph no matter how many modules you compose, without relying on undocumented parser behavior or temporary conversion rules.
