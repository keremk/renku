# Renku CLI Commands Reference

## Introduction

Renku CLI is a command-line interface for generating AI-powered multimedia content through declarative workflow blueprints. This document covers the complete set of CLI commands, options, and configuration.

For detailed information on writing and understanding blueprints, see [Blueprint Authoring Guide](./blueprint-authoring.md).

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
renku generate [<inquiry-prompt>] --inputs=<path> --blueprint=<path> [--dry-run] [--non-interactive] [--up-to-layer=<n>]
```

**Usage (continue an existing movie):**
```bash
renku generate --movie-id=<movie-id> [--blueprint=<path>] [--dry-run] [--non-interactive] [--up-to-layer=<n>]
renku generate --last [--dry-run] [--non-interactive] [--up-to-layer=<n>]
```

**Options:**
- `--inputs` / `--in` (required for new runs): Path to inputs YAML file
- `--blueprint` / `--bp` (required for new runs): Path to blueprint YAML file
- `--movie-id` / `--id` (mutually exclusive with `--last`): Continue a specific movie
- `--last` (mutually exclusive with `--movie-id`): Continue the most recent movie (fails if none recorded)
- `--dry-run`: Execute a mocked run without calling providers
- `--non-interactive`: Skip confirmation prompt
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

### `renku export`

Export a previously generated movie to MP4 video format.

**Usage:**
```bash
renku export --movie-id=<movie-id> [--width=<px>] [--height=<px>] [--fps=<n>]
renku export --last [--width=<px>] [--height=<px>] [--fps=<n>]
```

**Options:**
- `--movie-id` / `--id` (mutually exclusive with `--last`): Export a specific movie by ID
- `--last` (mutually exclusive with `--movie-id`): Export the most recently generated movie
- `--width` (optional): Video width in pixels (default: 1920)
- `--height` (optional): Video height in pixels (default: 1080)
- `--fps` (optional): Frames per second (default: 30)

**Requirements:**
- The blueprint used to generate the movie must include a `TimelineComposer` producer
- The movie must have a Timeline artifact (generated during the generation phase)

**Behavior:**
1. Validates the blueprint has a TimelineComposer producer
2. Validates the manifest contains a Timeline artifact
3. Invokes the Docker-based Remotion renderer with specified quality settings
4. Saves the MP4 to `builds/{movieId}/FinalVideo.mp4`
5. Creates a symlink in `movies/{movieId}/FinalVideo.mp4` for easy access

**Error Messages:**
- "A TimelineComposer producer is required in the blueprint to export video." — Blueprint missing TimelineComposer
- "No timeline found. Please run the generation first to create a timeline." — No Timeline artifact in manifest
- "Docker render failed: ..." — Rendering error during export

**Examples:**
```bash
# Export a specific movie with default quality
renku export --movie-id=movie-q123456

# Export the most recent movie with custom resolution
renku export --last --width=1920 --height=1080

# Export with custom frame rate
renku export --movie-id=movie-q123456 --fps=60

# Export with 4K resolution
renku export --last --width=3840 --height=2160 --fps=24
```

**Output:**
```
Export completed successfully.
  Movie: movie-q123456
  Output: /path/to/storage/movies/movie-q123456/FinalVideo.mp4
  Resolution: 1920x1080 @ 30fps
```

---

### `renku producers:list`

List all available models for producers defined in a blueprint. This is useful for discovering model options when configuring the inputs file.

**Usage:**
```bash
renku producers:list --blueprint=<path>
```

**Options:**
- `--blueprint` / `--bp` (required): Path to the blueprint YAML file whose producers should be listed

**Behavior:**
1. Loads the blueprint
2. Extracts all producer configurations with their model variants
3. Looks up pricing and type info from the model catalog
4. Validates API token availability per provider
5. Displays all available models grouped by producer

**Example:**
```bash
renku producers:list --blueprint=image-audio.yaml
```

**Output:**
```
Producer model configurations:

VideoProducer (5 video models)
  Provider    Model                          Price
  replicate   bytedance/seedance-1-pro-fast  480p: $0.015/s, 720p: $0.025/s, 1080p: $0.06/s
  replicate   bytedance/seedance-1-lite      480p: $0.018/s, 720p: $0.036/s, 1080p: $0.072/s
  replicate   google/veo-3.1-fast            audio: $0.15/s, no-audio: $0.10/s
  fal-ai      veo3-1                         -

AudioProducer (2 audio models)
  Provider    Model                 Price
  replicate   minimax/speech-2.6-hd $0.0001/token
  replicate   elevenlabs/v3         $0.0001/token

⚠️  Missing API tokens:
  - replicate: REPLICATE_API_TOKEN not set
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
renku viewer:view --last
```

**Options:**
- `--movie-id` / `--id` (mutually exclusive with `--last`): Movie ID to open
- `--last` (mutually exclusive with `--movie-id`): Open the most recently generated movie
- `--viewerHost`, `--viewerPort` (optional): Override host/port

**Behavior:**
- Starts the bundled viewer server if not running, then opens the movie page.
- Displays timeline with images, audio, and composition.
- If neither `--movie-id` nor `--last` is provided, displays an error.

**Examples:**
```bash
# View a specific movie
renku viewer:view --movie-id=movie-q123456

# View the most recent movie
renku viewer:view --last
```

**Related commands:**
- `renku viewer:start` — start the server in the foreground.
- `renku viewer:stop` — stop the background server.

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

#### 3. Renku
Built-in providers for specialized tasks.

**Configuration:**
```yaml
producers:
  - name: TimelineComposer
    providerName: renku
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
│       ├── events/
│       │   ├── inputs.log   # Input events log (JSONL)
│       │   └── artefacts.log # Artifact events log (JSONL)
│       ├── runs/
│       │   └── {revision}-plan.json  # Execution plan
│       ├── manifests/
│       │   └── {revision}.json       # Manifest with artifact metadata
│       ├── blobs/
│       │   └── {hash-prefix}/        # Blob storage by hash prefix
│       └── current.json              # Pointer to current manifest
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

#### `events/inputs.log`
JSONL file containing input events. Each line is a JSON object with the input ID, value, and metadata.

#### `events/artefacts.log`
JSONL file containing artifact production events with status, blob references, and metadata.

#### `runs/{revision}-plan.json`
Execution plan with nodes, edges, and dependencies for a specific revision.

#### `manifests/{revision}.json`
Artifact metadata with types, blob references, and node IDs for a specific revision.

#### `blobs/`
Content-addressed blob storage. Files are stored under `{hash-prefix}/{hash}` paths.

#### `current.json`
Pointer to the current manifest revision.

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
   - Update your original inputs file or edit artifacts in the friendly `movies/movie-q123456/` folder.

3. **Re-run generation against the same movie:**
   ```bash
   renku generate --movie-id=movie-q123456 --inputs=./inputs.yaml
   ```

4. **Review:**
   - Friendly view is refreshed under `movies/movie-q123456/`.
   - Use `renku viewer:view --movie-id=movie-q123456` to open the viewer.

**Use Cases:**
- Fix LLM-generated script errors by editing inputs and rerunning.
- Replace unsatisfactory artifacts from friendly edits.
- Regenerate partial workflows with `--up-to-layer` to limit execution.

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
- Does not call OpenAI, Replicate, or Renku APIs

**Use Cases:**
- Test blueprint structure
- Validate input files
- Preview execution plan
- Check artifact output paths

### Non-Interactive Mode

Non-interactive mode skips confirmation prompts.

**Usage:**
```bash
renku generate --inputs=my-inputs.yaml --blueprint=./blueprints/audio-only.yaml --non-interactive
```

**Use Cases:**
- CI/CD pipelines
- Automated workflows
- Batch processing

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
renku producers:list --blueprint=my-blueprint.yaml
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
- **Blueprint Authoring:** See [Blueprint Authoring Guide](./blueprint-authoring.md)

For feature requests and bug reports, please open an issue in the Renku repository.
