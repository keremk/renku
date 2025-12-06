# Renku CLI Reference

## Introduction

Renku CLI is a command-line SDK for generating AI-powered multimedia content through declarative workflow blueprints. The system orchestrates multiple AI providers (OpenAI, Replicate, and ElevenLabs) to create narrated video content from simple text prompts.

### Scope

The CLI provides a complete toolkit for:

- **Declarative Workflow Definition**: Author reusable YAML blueprints that define multi-step generation pipelines
- **Dynamic Cardinality Management**: Automatically scale workflows based on input parameters (e.g., generate N segments with M images each)
- **Multi-Provider Orchestration**: Coordinate OpenAI, Replicate, and Tutopanda services in a single workflow
- **Artifact Management**: Track, inspect, and edit all generated assets (scripts, images, audio, timelines)
- **Interactive Editing**: Modify generated content and replay workflows with updated inputs
- **Blueprint Modularity**: Compose complex workflows from reusable modules
- **Playback Integration**: Launch Remotion-based viewer for previewing generated movies

### Architecture

The system operates on three core components:

1. **Blueprint YAML Files**: Define the workflow graph, provider configurations, and data flow
2. **Input YAML Files**: Supply runtime values for blueprint parameters
3. **Storage Directory**: Organize generated artifacts, manifests, and metadata per movie

All configuration is file-based. The CLI does not use runtime flags for overriding provider settings or workflow parameters—everything is declared in version-controlled YAML and TOML files.

> **Note:** Commands have been consolidated. Use `renku generate` for both new runs and continuations (`--movie-id`/`--last`). Flags use kebab-case with aliases: `--movie-id`/`--id`, `--blueprint`/`--bp`, `--inputs`/`--in`, `--up-to-layer`/`--up`, `--root-folder`/`--root`, and `--dry-run`.

---

## Getting Started

### Environment Configuration

Create a `.env` file in the CLI directory or current working directory:

```bash
# OpenAI
OPENAI_API_KEY=sk-...

# Replicate
REPLICATE_API_TOKEN=r8_...

```

### Initialization

Initialize the Renku storage configuration:

```bash
renku init --root-folder=/path/to/storage
renku init --root=/path/to/storage  # Short form
```

This creates:
- `~/.config/renku/cli-config.json` with storage settings (fixed location)
- `{rootFolder}/builds/` directory for movie outputs
- `{rootFolder}/catalog/blueprints/` with bundled YAML blueprint templates

Required flags:
- `--root-folder` / `--root`: Storage root directory (mandatory)

### Generate Your First Movie

1. **Create an inputs file** (`my-inputs.yaml`):

```yaml
inputs:
  InquiryPrompt: "Explain the water cycle"
  Duration: 30
  NumOfSegments: 3
  VoiceId: "Wise_Woman"
  ImageStyle: "Scientific illustration"
```

2. **Run the generate command**:

```bash
renku generate \
  --inputs=my-inputs.yaml \
  --blueprint={rootFolder}/catalog/blueprints/image-audio.yaml
```

3. **View the result**:

```bash
renku viewer:view --movie-id=movie-a1b2c3d4
```

---

## Core Concepts

### Blueprints

Blueprints are YAML files that define complete generation workflows. They specify:

- **Inputs**: Required and optional parameters
- **Artifacts**: Output types produced by the workflow
- **Loops**: Iteration dimensions for scaling operations
- **Modules**: References to reusable sub-blueprints
- **Connections**: Data flow between nodes
- **Producers**: Provider configurations (OpenAI, Replicate, ElevenLabs, Renku)
- **Collectors**: Optional fan-in operations for aggregating array outputs

Blueprints are installed to `<root>/blueprints/` (default `~/.renku/blueprints/`). When running from source, they also live under `cli/catalog/blueprints/`.

#### Example Blueprints

1. **audio-only.yaml**: Generate script and audio narration (no images)
2. **image-audio.yaml**: Full pipeline with images, audio, and timeline composition
3. **image-only.yaml**: Generate script and images without audio

### Producer Modules

Producer Modules are reusable blueprint components located in `<root>/blueprints/modules/` (the repo copy lives under `cli/catalog/blueprints/modules/`):

1. **script-generator.yaml**: Uses OpenAI to generate movie title, summary, and narration segments
2. **image-prompt-generator.yaml**: Creates detailed image prompts from narrative text
3. **image-generator.yaml**: Generates images using Replicate (seedream-4 model)
4. **audio-generator.yaml**: Generates audio using ElevenLabs (text-to-speech)
5. **timeline-composer.yaml**: Composes images and audio into a timeline JSON manifest

### Inputs

Input files are YAML documents that provide runtime values for blueprint parameters. All required inputs from the blueprint's `inputs` section must be present.

Example:

```yaml
inputs:
  InquiryPrompt: "Tell me about the Battle of Waterloo"
  Duration: 30
  NumOfSegments: 2
  VoiceId: "Wise_Woman"
  ImageStyle: "Ghibli"
  Size: "1K"
  AspectRatio: "16:9"
```

### Artifacts

Artifacts are typed outputs produced by the workflow:

- **string**: Plain text
- **json**: Structured JSON data
- **image**: Image files (PNG, JPG)
- **audio**: Audio files (MP3, WAV)
- **video**: Video files (MP4)
- **array**: Single-dimensional array of items
- **multiDimArray**: Multi-dimensional array (e.g., images[segment][image])

Artifacts are stored in `~/.tutopanda/builds/movie-{id}/artefacts/`.

### Loops

Some producers generate multiple artifacts and in some blueprints connecting these to each other create nested dimensions. For example, ScriptProducer generates multiple NarrativeSegments (n of them), and when you connect this to a ImagePromptProducer it also creates multiple prompts for each of the segments (m of them). So you end up creating nxm Prompts (and once fed into ImageProducer, nxm Image Artifacts). To annotate this in the blueprints, we use `loops`. 

Loops define iteration dimensions for scaling operations. They enable dynamic cardinality based on input values.

```yaml
loops:
  - name: segment
    description: Iterates over narration segments
    countInput: NumOfSegments
  - name: image
    description: Iterates over images per segment
    parent: segment
    countInput: NumOfImagesPerNarrative
```

Loops can be nested using the `parent` property, creating multi-dimensional iteration spaces.

### Index Notation

Connections use index notation to specify array cardinality:

- `Node.Output` - Scalar value
- `Node[segment].Output` - Single-dimensional array
- `Node[segment][image].Output` - Multi-dimensional array

Example:
```yaml
connections:
  - from: ScriptGenerator.NarrationScript[segment]
    to: AudioGenerator[segment].TextInput
```

This notation indicates that each `AudioGenerator` instance (one per segment) receives the corresponding narration text.

### Producers

Producers are provider configurations that execute actual generation tasks. Three types are supported:

1. **OpenAI**: LLM-based generation
2. **Replicate**: Model invocation for images and audio
3. **Renku**: Built-in services (e.g., OrderedTimeline)

Producer configurations are embedded in blueprint modules under the `producers` section.

### Collectors

Collectors perform fan-in operations, aggregating array outputs for downstream nodes:

```yaml
collectors:
  - name: TimelineImages
    from: ImageGenerator[segment][image].SegmentImage
    into: TimelineComposer.ImageSegments
    groupBy: segment
    orderBy: image
```

This collects all images grouped by segment and ordered by image index.

---

## CLI Commands Reference

### `renku init`

Initialize Renku storage configuration.

**Usage:**
```bash
renku init --root-folder=/path/to/storage
renku init --root=/path/to/storage
```

**Options:**
- `--root-folder` / `--root` (required): Storage root directory for builds and blueprints

**Creates:**
- `~/.config/renku/cli-config.json` with storage settings
- `{rootFolder}/builds/` directory for movie outputs
- `{rootFolder}/catalog/blueprints/` with bundled blueprints

**Example:**
```bash
renku init --root-folder=/Users/alice/renku-storage
renku init --root=/Users/alice/renku-storage
```

---

### `renku generate`

Create a new movie or continue an existing one.

**Usage (new run):**
```bash
renku generate [<inquiry-prompt>] --inputs=<path> --blueprint=<path> [--dry-run] [--nonInteractive] [--up-to-layer=<n>]
```

**Usage (continue an existing movie):**
```bash
renku generate --movie-id=<movie-id> [--blueprint=<path>] [--dry-run] [--nonInteractive] [--up-to-layer=<n>]
renku generate --last [--dry-run] [--nonInteractive] [--up-to-layer=<n>]
```

**Options:**
- `--inputs` / `--in` (required for new runs): Path to inputs YAML file
- `--blueprint` / `--bp` (required for new runs): Path to blueprint YAML file
- `--movie-id` / `--id` (mutually exclusive with `--last`): Continue a specific movie
- `--last` (mutually exclusive with `--movie-id`): Continue the most recent movie (fails if none recorded)
- `--dry-run`: Execute a mocked run without calling providers
- `--nonInteractive`: Skip confirmation prompt
- `--up-to-layer` / `--up`: Stop execution after the specified layer (live runs only)

**Behavior:**
1. New runs: validate inputs/blueprint, generate a new movie id, create `builds/movie-{id}/`, and execute the workflow.
2. Continuing runs: load the existing manifest and friendly workspace, apply any friendly edits, regenerate the plan, and execute with the stored blueprint (or an explicit override).
3. Friendly view under `movies/<id>` stays in sync after successful runs.
4. The CLI records the latest movie id so `--last` can target it explicitly; if missing, the command fails with an error.

**Examples:**
```bash
# New run with inline prompt
renku generate "Explain black holes" --inputs=~/inputs.yaml --blueprint=~/.renku/blueprints/audio-only.yaml

# Continue a specific movie
renku generate --movie-id=movie-q123456 --up-to-layer=1

# Continue the most recent movie
renku generate --last --dry-run
```

---

### `renku clean`

Remove the friendly view and build artifacts for a movie.

**Usage:**
```bash
renku clean --movie-id=<movie-id>
```

---

### `renku inspect`

Export movie data (prompts, artifacts, metadata) for inspection.

**Usage:**
```bash
renku inspect --movie-id=<id>
```

**Options:**
- `--movie-id` / `--id` (required): Movie ID to inspect

**Behavior:**
Displays:
- Movie metadata
- All artifacts with paths and types
- Prompts used in generation
- Plan structure

**Example:**
```bash
renku inspect --movie-id=movie-q123456
```

---

### `renku providers:list`

Show configured providers and their readiness status.

**Usage:**
```bash
renku providers:list --blueprint=<path>
```

**Options:**
- `--blueprint` / `--bp` (required): Path to the blueprint YAML file whose providers should be inspected

**Behavior:**
1. Loads the blueprint
2. Extracts all producer configurations
3. Attempts to warm-start each provider
4. Reports status (ready/failed)

**Example:**
```bash
renku providers:list --blueprint={rootFolder}/catalog/blueprints/image-audio.yaml
```

**Output:**
```
Provider: openai (gpt-4o)
Status: Ready

Provider: replicate (bytedance/sdxl-lightning-4step)
Status: Ready

Provider: elevenlabs (text-to-speech-1)
Status: Ready
```

---

### `renku blueprints:list`

List all available blueprint YAML files.

**Usage:**
```bash
renku blueprints:list
```

**Behavior:**
Scans `<root>/blueprints/` (default `~/.renku/blueprints/`) and displays all `.yaml` files with their metadata.

**Example Output:**
```
Available Blueprints:

1. audio-only.yaml
   - Audio-Only Narration
   - Generates script and audio narration

2. image-audio.yaml
   - Images with Audio Narration
   - Full pipeline with images, audio, and timeline

3. image-only.yaml
   - Image-Only Generation
   - Generates script and images without audio
```

---

### `renku blueprints:describe`

Show detailed information about a specific blueprint.

**Usage:**
```bash
renku blueprints:describe <path-to-blueprint.yaml>
```

**Options:**
- Positional argument (required): Path to the blueprint YAML file to describe

**Behavior:**
Displays:
- Blueprint metadata (name, description, version, author)
- Required and optional inputs
- Artifacts produced
- Loops defined
- Modules used
- Node/edge counts

**Example:**
```bash
renku blueprints:describe {rootFolder}/catalog/blueprints/image-audio.yaml
```

---

### `renku blueprints:validate`

Validate blueprint structure and references.

**Usage:**
```bash
renku blueprints:validate <path-to-blueprint.yaml>
```

**Options:**
- Positional argument (required): Path to the blueprint YAML file to validate

**Behavior:**
- Validates YAML syntax
- Checks module references
- Validates connections
- Ensures all required fields are present

**Example:**
```bash
renku blueprints:validate {rootFolder}/catalog/blueprints/image-audio.yaml
```

---

### `renku viewer:view`

Open the viewer for a movie (starts the server if needed).

**Usage:**
```bash
renku viewer:view --movie-id=<id>
```

**Options:**
- `--movie-id` / `--id` (required): Movie ID to open
- `--viewerHost`, `--viewerPort` (optional): Override host/port

**Behavior:**
- Starts the bundled viewer server if not running, then opens the movie page.
- Displays timeline with images, audio, and composition.

**Related commands:**
- `renku viewer:start` — start the server in the foreground.
- `renku viewer:stop` — stop the background server.

---

## Blueprint YAML Reference

### Complete Schema

```yaml
meta:
  name: <string>
  description: <string>
  id: <string>
  version: <semver>
  author: <string>
  license: <string>

inputs:
  - name: <string>
    description: <string>
    type: <string|int|array|collection>
    required: <boolean>
    default: <any>

artifacts:
  - name: <string>
    description: <string>
    type: <string|json|image|audio|video|array|multiDimArray>
    itemType: <string>  # For array types

loops:
  - name: <string>
    description: <string>
    countInput: <inputName>
    parent: <loopName>  # For nested loops

modules:
  - name: <string>
    path: <relativePath>
    loop: <loopName|loopName.childLoop>

connections:
  - from: <source>
    to: <target>

producers:
  - name: <string>
    providerName: <openai|replicate|elevenlabs|renku>
    modelName: <string>
    environment: <local|cloud>
    promptFile: <filename>  # OpenAI only
    jsonSchema: <schemaName>  # OpenAI only
    sdkMapping:
      <inputName>:
        field: <sdkFieldName>
        type: <string|number|boolean>
        required: <boolean>

collectors:
  - name: <string>
    from: <source>
    into: <target>
    groupBy: <loopName>
    orderBy: <loopName>
```

### Field Descriptions

#### `meta`
Metadata about the blueprint.

- `name`: Human-readable name
- `description`: Purpose and behavior
- `id`: Unique identifier (PascalCase)
- `version`: Semantic version
- `author`: Creator name
- `license`: License type (e.g., MIT)

#### `inputs`
Parameters accepted by the blueprint.

- `name`: Input identifier (PascalCase)
- `description`: Purpose and usage
- `type`: Data type (`string`, `int`, `array`, `collection`)
- `required`: Whether the input is mandatory
- `default`: Default value if not provided

**Example:**
```yaml
inputs:
  - name: Duration
    description: Desired movie duration in seconds
    type: int
    required: true
  - name: ImageStyle
    description: Visual style for images
    type: string
    required: false
    default: Photorealistic
```

#### `artifacts`
Outputs produced by the workflow.

- `name`: Artifact identifier (PascalCase)
- `description`: Purpose and content
- `type`: Output type
  - `string`, `json`, `image`, `audio`, `video`: Scalar types
  - `array`: Single-dimensional array
  - `multiDimArray`: Multi-dimensional array
- `itemType`: For array types, specifies the item type

**Example:**
```yaml
artifacts:
  - name: SegmentImage
    description: Images for each segment
    type: multiDimArray
    itemType: image
  - name: Timeline
    description: Composition manifest
    type: json
```

#### `loops`
Iteration dimensions for scaling operations.

- `name`: Loop identifier (lowercase)
- `description`: Purpose and behavior
- `countInput`: Input parameter that determines iteration count
- `parent`: Parent loop for nested iteration (optional)

**Example:**
```yaml
loops:
  - name: segment
    description: Iterate over narration segments
    countInput: NumOfSegments
  - name: image
    description: Iterate over images per segment
    parent: segment
    countInput: NumOfImagesPerNarrative
```

#### `modules`
References to reusable sub-blueprints.

- `name`: Module instance name (PascalCase)
- `path`: Relative path to module YAML file
- `loop`: Loop context (optional)
  - Single loop: `segment`
  - Nested loop: `segment.image`

**Example:**
```yaml
modules:
  - name: ScriptGenerator
    path: ./modules/script-generator.yaml
  - name: AudioGenerator
    path: ./modules/audio-generator.yaml
    loop: segment
  - name: ImageGenerator
    path: ./modules/image-generator.yaml
    loop: segment.image
```

#### `connections`
Data flow between nodes.

- `from`: Source node output
  - Blueprint input: `InputName`
  - Module output: `ModuleName.OutputName`
  - Array output: `ModuleName.OutputName[loop]`
  - Multi-dim array: `ModuleName.OutputName[loop1][loop2]`
- `to`: Target node input
  - Blueprint artifact: `ArtifactName[loop]`
  - Module input: `ModuleName.InputName`
  - Looped module input: `ModuleName[loop].InputName`

**Example:**
```yaml
connections:
  - from: InquiryPrompt
    to: ScriptGenerator.InquiryPrompt
  - from: ScriptGenerator.NarrationScript[segment]
    to: AudioGenerator[segment].TextInput
  - from: ImageGenerator[segment][image].SegmentImage
    to: SegmentImage[segment][image]
```

#### `producers`
Provider configurations for generation tasks.

**OpenAI Producer:**
```yaml
producers:
  - name: ScriptGenerator
    providerName: openai
    modelName: gpt-4o
    environment: local
    promptFile: generate-script.md
    jsonSchema: ScriptGeneratorOutput
```

- `promptFile`: Markdown file with prompt template (stored in `prompts/`)
- `jsonSchema`: TypeScript interface name for structured output

**Replicate Producer:**
```yaml
producers:
  - name: ImageGenerator
    providerName: replicate
    modelName: bytedance/sdxl-lightning-4step
    environment: local
    sdkMapping:
      Prompt:
        field: prompt
        type: string
        required: true
      Size:
        field: width
        type: number
        required: false
```

- `sdkMapping`: Maps blueprint inputs to SDK field names
  - `field`: SDK parameter name
  - `type`: Data type (`string`, `number`, `boolean`)
  - `required`: Whether the parameter is mandatory

**Renku Producer:**
```yaml
producers:
  - name: TimelineComposer
    providerName: renku
    modelName: OrderedTimeline
    environment: local
```

#### `collectors`
Fan-in operations for aggregating array outputs.

- `name`: Collector identifier
- `from`: Source node output (with indices)
- `into`: Target node input
- `groupBy`: Loop dimension for grouping
- `orderBy`: Loop dimension for ordering

**Example:**
```yaml
collectors:
  - name: TimelineImages
    from: ImageGenerator[segment][image].SegmentImage
    into: TimelineComposer.ImageSegments
    groupBy: segment
    orderBy: image
```

This collects all images, groups them by segment, orders by image index, and passes to `TimelineComposer`.

---

## Input YAML Reference

### Structure

Input files use YAML with a single `inputs` mapping:

```yaml
inputs:
  <InputName>: <value>
```

### Data Types

- **String**: Quoted text
- **Integer**: Numeric value (no quotes)
- **Array**: YAML array syntax

**Example:**
```yaml
inputs:
  InquiryPrompt: "Explain photosynthesis"
  Duration: 45
  NumOfSegments: 4
  VoiceId: "Wise_Woman"
  ImageStyle: "Scientific diagram"
  Size: "2K"
  AspectRatio: "16:9"
  Audience: "High school students"
```

### Validation Rules

1. All required inputs from the blueprint must be present
2. Optional inputs use blueprint defaults if omitted
3. Input names are case-sensitive and must match blueprint exactly
4. Type mismatches cause validation errors

### Special Inputs

#### `InquiryPrompt`
Stored in two locations:
- `builds/movie-{id}/inputs.yaml`
- `builds/movie-{id}/prompts/inquiry.txt`

This allows providers to reference it as both a config value and a prompt file.

---

## Provider Configuration

### Provider Types

#### 1. OpenAI
Uses LLM for text generation with structured outputs.

**Configuration:**
```yaml
producers:
  - name: ScriptGenerator
    providerName: openai
    modelName: gpt-4o
    environment: local
    promptFile: generate-script.md
    jsonSchema: ScriptGeneratorOutput
```

**Prompt File (`prompts/generate-script.md`):**
```markdown
You are a creative scriptwriter. Generate a movie script based on the following:

Topic: {InquiryPrompt}
Duration: {Duration} seconds
Segments: {NumOfSegments}
Audience: {Audience}
```

**JSON Schema (TypeScript Interface):**
```typescript
interface ScriptGeneratorOutput {
  MovieTitle: string;
  MovieSummary: string;
  NarrationScript: string[];
}
```

#### 2. Replicate
Invokes models for image and audio generation.

**Configuration:**
```yaml
producers:
  - name: ImageGenerator
    providerName: replicate
    modelName: bytedance/sdxl-lightning-4step
    environment: local
    sdkMapping:
      Prompt:
        field: prompt
        type: string
        required: true
      Size:
        field: width
        type: number
        required: true
```

**SDK Mapping:**
- Maps blueprint inputs to Replicate SDK field names
- Supports type conversion (string to number)
- Enforces required/optional fields

#### 3. Tutopanda
Built-in providers for specialized tasks.

**Configuration:**
```yaml
producers:
  - name: TimelineComposer
    providerName: tutopanda
    modelName: OrderedTimeline
    environment: local
```

**Available Models:**
- `OrderedTimeline`: Composes images and audio into a timeline JSON manifest

### Environment Configuration

- **`local`**: Uses local environment (CLI reads `.env` files)
- **`cloud`**: Reserved for future cloud-based execution

### Credentials

The CLI reads credentials from `.env` files in:
1. CLI directory (`cli/.env`)
2. Current working directory (`.env`)

**Required Variables:**
```bash
OPENAI_API_KEY=sk-...
REPLICATE_API_TOKEN=r8_...
```

---

## Storage Structure

### Directory Layout

Configuration (fixed location):
```
~/.config/renku/
├── cli-config.json          # Storage configuration
```

Data and generated artifacts (user-specified location):
```
{rootFolder}/
├── builds/
│   └── movie-{id}/
│       ├── inputs.yaml      # Original inputs
│       ├── plan.json        # Execution plan
│       ├── manifest.json    # Artifact metadata
│       ├── artifacts.log    # Execution log
│       ├── prompts/
│       │   └── inquiry.txt  # InquiryPrompt
│       └── artifacts/
│           ├── node-{id}-output.txt
│           ├── node-{id}-output.json
│           ├── node-{id}-output.png
│           └── node-{id}-output.mp3
└── config/
    └── blueprints/
        └── *.yaml           # Blueprint files
```

### File Descriptions

#### `cli-config.json`
Storage configuration created by `init`. Located at `~/.config/renku/cli-config.json`.

```json
{
  "storage": {
    "root": "/path/to/storage",
    "basePath": "builds"
  }
}
```

#### `inputs.yaml`
Original inputs provided to the workflow.

#### `plan.json`
Execution plan with nodes, edges, and dependencies.

#### `manifest.json`
Artifact metadata with types, paths, and node IDs.

#### `artifacts.log`
Execution log with timestamps and status.

#### `prompts/`
Directory for prompt files referenced by producers.

#### `artifacts/`
Directory for all generated artifacts. Files are named:
- `node-{nodeId}-{outputName}.{ext}`

Node IDs are deterministic and derived from:
- Module name
- Loop indices (if looped)
- Instance counter (for arrays)

**Example:**
- `node-ScriptGenerator-MovieTitle.txt`
- `node-AudioGenerator-0-SegmentAudio.mp3`
- `node-ImageGenerator-0-1-SegmentImage.png`

---

## Advanced Topics

### Iteration Workflow

Continuing work on an existing movie uses the same `generate` command with a target movie ID.

**Workflow:**

1. **Generate once to seed the movie:**
   ```bash
   renku generate --inputs=./inputs.yaml --blueprint=./blueprints/audio-only.yaml
   # Output: movie-q123456
   ```

2. **Apply edits locally:**
   - Update `builds/movie-q123456/inputs.yaml` (or edit artifacts in the friendly `movies/movie-q123456/` folder).

3. **Re-run generation against the same movie:**
   ```bash
   renku generate --movie-id=movie-q123456
   ```

4. **Review:**
   - Friendly view is refreshed under `movies/movie-q123456/`.
   - Use `renku viewer:view --movie-id=movie-q123456` to open the viewer.

**Use Cases:**
- Fix LLM-generated script errors by editing inputs and rerunning.
- Replace unsatisfactory artifacts from friendly edits.
- Regenerate partial workflows with `--up-to-layer` to limit execution.

### Blueprint Modules

Modules enable blueprint composition and reuse.

**Creating a Module:**

1. **Define module YAML** (`modules/my-module.yaml`):
   ```yaml
   meta:
     name: My Module
     id: MyModule

   inputs:
     - name: InputText
       type: string
       required: true

   outputs:
     - name: OutputData
       type: json

   producers:
     - name: MyProducer
       providerName: openai
       modelName: gpt-4o
       promptFile: my-prompt.md
   ```

2. **Reference in parent blueprint:**
   ```yaml
   modules:
     - name: MyModuleInstance
       path: ./modules/my-module.yaml

   connections:
     - from: ParentInput
       to: MyModuleInstance.InputText
     - from: MyModuleInstance.OutputData
       to: ParentArtifact
   ```

**Benefits:**
- Reuse common patterns (script generation, image generation)
- Isolate provider configurations
- Simplify complex blueprints
- Enable testing of individual components

### Index Notation Deep Dive

Index notation specifies array cardinality in connections.

**Scalar Connections:**
```yaml
- from: InquiryPrompt
  to: ScriptGenerator.InquiryPrompt
```
Both source and target are scalars (single values).

**Array Connections:**
```yaml
- from: ScriptGenerator.NarrationScript[segment]
  to: AudioGenerator[segment].TextInput
```
- Source is an array (one narration per segment)
- Target is looped (one AudioGenerator instance per segment)
- Each instance receives the corresponding array element

**Multi-Dimensional Connections:**
```yaml
- from: ImageGenerator[segment][image].SegmentImage
  to: SegmentImage[segment][image]
```
- Source is a 2D array (segments × images)
- Target artifact is also 2D
- Preserves array structure

**Fan-In Connections:**
```yaml
- from: AudioGenerator[segment].SegmentAudio
  to: TimelineComposer.AudioSegments
```
- Source is an array
- Target expects the full array
- Collector handles aggregation

### Dry Run Mode

Dry run mode executes a mocked workflow without calling providers.

**Usage:**
```bash
renku generate --inputs=my-inputs.yaml --blueprint=./blueprints/audio-only.yaml --dry-run
```

**Behavior:**
- Validates blueprint and inputs
- Generates execution plan
- Creates movie directory
- Generates mock artifacts (placeholder files)
- Does not call OpenAI, Replicate, or Tutopanda APIs

**Use Cases:**
- Test blueprint structure
- Validate input files
- Preview execution plan
- Check artifact output paths

### Non-Interactive Mode

Non-interactive mode skips confirmation prompts.

**Usage:**
```bash
renku generate --inputs=my-inputs.yaml --blueprint=./blueprints/audio-only.yaml --nonInteractive
```

**Use Cases:**
- CI/CD pipelines
- Automated workflows
- Batch processing

---

## Examples

### Example 1: Audio-Only Narration

**Blueprint:** `{rootFolder}/catalog/blueprints/audio-only.yaml`

**Inputs (`audio-inputs.yaml`):**
```yaml
inputs:
  InquiryPrompt: "Explain the history of the Roman Empire"
  Duration: 60
  NumOfSegments: 4
  VoiceId: "Wise_Man"
  Audience: "Adults"
```

**Command:**
```bash
renku generate \
  --inputs=audio-inputs.yaml \
  --blueprint={rootFolder}/catalog/blueprints/audio-only.yaml
```

**Outputs:**
- `MovieTitle.txt`
- `MovieSummary.txt`
- `NarrationScript-0.txt`, `NarrationScript-1.txt`, `NarrationScript-2.txt`, `NarrationScript-3.txt`
- `SegmentAudio-0.mp3`, `SegmentAudio-1.mp3`, `SegmentAudio-2.mp3`, `SegmentAudio-3.mp3`

---

### Example 2: Images with Audio

**Blueprint:** `{rootFolder}/catalog/blueprints/image-audio.yaml`

**Inputs (`image-audio-inputs.yaml`):**
```yaml
inputs:
  InquiryPrompt: "Tell me about the Solar System"
  Duration: 90
  NumOfSegments: 6
  NumOfImagesPerNarrative: 2
  ImageStyle: "Space photography"
  Size: "2K"
  AspectRatio: "16:9"
  VoiceId: "Wise_Woman"
  Audience: "Children"
```

**Command:**
```bash
renku generate \
  --inputs=image-audio-inputs.yaml \
  --blueprint={rootFolder}/catalog/blueprints/image-audio.yaml
```

**Outputs:**
- Script artifacts (title, summary, narration)
- Audio artifacts (6 segments)
- Image artifacts (6 segments × 2 images = 12 images)
- Timeline JSON manifest

**View Result:**
```bash
renku viewer:view --movie-id=movie-{id}
```

---

### Example 3: Iterate on an existing movie

**Scenario:** Regenerate after updating inputs.

**Step 1: Generate movie**
```bash
renku generate --inputs=my-inputs.yaml --blueprint={rootFolder}/catalog/blueprints/image-audio.yaml
# Output: movie-a1b2c3d4
```

**Step 2: Update inputs**
```bash
# Edit builds/movie-a1b2c3d4/inputs.yaml with new values
```

**Step 3: Re-run generation against the same movie**
```bash
renku generate --movie-id=movie-a1b2c3d4
```

**Result:**
- Updated plan and outputs for the same movie ID
- Friendly view refreshed under `movies/movie-a1b2c3d4`

---

### Example 4: Custom Blueprint Module

**Create a custom sentiment analyzer module.**

**File:** `<root>/catalog/blueprints/modules/sentiment-analyzer.yaml`
```yaml
meta:
  name: Sentiment Analyzer
  id: SentimentAnalyzer
  version: 0.1.0

inputs:
  - name: TextInput
    description: Text to analyze
    type: string
    required: true

outputs:
  - name: SentimentScore
    description: Sentiment score (-1 to 1)
    type: json

producers:
  - name: SentimentAnalyzer
    providerName: openai
    modelName: gpt-4o
    environment: local
    promptFile: analyze-sentiment.md
    jsonSchema: SentimentAnalyzerOutput
```

**Prompt File:** `cli/prompts/analyze-sentiment.md`
```markdown
Analyze the sentiment of the following text and provide a score from -1 (very negative) to 1 (very positive):

{TextInput}
```

**Schema:**
```typescript
interface SentimentAnalyzerOutput {
  score: number;
  explanation: string;
}
```

**Use in Blueprint:**
```yaml
modules:
  - name: SegmentSentiment
    path: ./modules/sentiment-analyzer.yaml
    loop: segment

connections:
  - from: ScriptGenerator.NarrationScript[segment]
    to: SegmentSentiment[segment].TextInput
```

---

## Troubleshooting

### Common Issues

**1. Missing API Credentials**
```
Error: OPENAI_API_KEY not found
```
**Solution:** Add credentials to `.env` file in CLI directory or current working directory.

**2. Invalid Blueprint Path**
```
Error: Blueprint file not found: /path/to/blueprint.yaml
```
**Solution:** Use absolute paths or paths relative to current directory.

**3. Missing Required Input**
```
Error: Required input 'InquiryPrompt' not found in inputs.yaml
```
**Solution:** Ensure all required inputs from blueprint are present in YAML file.

**4. Module Reference Error**
```
Error: Module not found: ./modules/missing-module.yaml
```
**Solution:** Check module path is relative to blueprint file location.

**5. Provider Configuration Error**
```
Error: Invalid sdkMapping for Replicate producer
```
**Solution:** Ensure all required SDK fields are mapped in `sdkMapping` section.

### Debug Mode

Set environment variable for verbose logging:
```bash
DEBUG=renku:* renku generate --inputs=my-inputs.yaml --blueprint=./blueprints/audio-only.yaml
```

### Validation Commands

**Validate blueprint:**
```bash
renku blueprints:validate my-blueprint.yaml
```

**Check providers:**
```bash
renku providers:list --blueprint=my-blueprint.yaml
```

**Dry run:**
```bash
renku generate --inputs=my-inputs.yaml --blueprint=./blueprints/audio-only.yaml --dry-run
```

---

## Appendix

### Configuration File Locations

- **CLI Config:** `~/.config/renku/cli-config.json` (fixed location, created on first init)
- **Environment:** `.env` in CLI directory or current working directory
- **Blueprints:** `{rootFolder}/catalog/blueprints/*.yaml` (copied during `renku init`)
- **Modules:** `{rootFolder}/catalog/blueprints/modules/*.yaml`
- **Prompts:** `cli/prompts/*.md`
- **Settings:** `cli/settings.json`

### Movie ID Format

Movie IDs are 8-character prefixes of UUIDs:
- Generated: `a1b2c3d4-5678-9abc-def0-123456789abc`
- Stored as: `movie-a1b2c3d4`

### Supported File Types

- **Blueprints:** `.yaml`
- **Inputs:** `.yaml`
- **Prompts:** `.md`, `.txt`
- **Artifacts:** `.txt`, `.json`, `.png`, `.jpg`, `.mp3`, `.wav`, `.mp4`

### Default Values

- **Blueprint:** *(none – always pass `--blueprint`/`--bp`)*
- **Config Path:** `~/.renku/`
- **Storage Base Path:** `builds/`
- **Environment:** `local`

---

## Additional Resources

- **Source Code:** `/home/keremk/developer/renku/cli`
- **Example Blueprints:** `~/.renku/blueprints/`
- **Example Inputs:** `<root>/inputs.yaml`
- **Default Settings:** `cli/settings.json`

For feature requests and bug reports, please open an issue in the Renku repository.
