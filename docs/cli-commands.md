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
renku init --root=/path/to/storage
```

This creates:
- `~/.config/renku/cli-config.json` with storage settings (fixed location)
- `{rootFolder}/.gitignore` with patterns for `**/builds/` and `**/artifacts/`
- `{rootFolder}/catalog/` containing:
  - `models/` - Supported model configurations
  - `producers/` - Supported producer definitions
  - `blueprints/` - Example blueprints to get started

Required flags:
- `--root`: Storage root directory (mandatory)

**Note:** Builds and artifacts are created in the **current working directory** when you run `renku generate`, not in the root folder. This allows project-based organization where each project has its own builds.

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
renku init --root=/path/to/storage
```

**Options:**
- `--root` (required): Storage root directory for builds and blueprints

**Creates:**
- `~/.config/renku/cli-config.json` with storage settings
- `{rootFolder}/.gitignore` with patterns for `**/builds/` and `**/artifacts/`
- `{rootFolder}/catalog/` containing:
  - `models/` - Supported model configurations
  - `producers/` - Supported producer definitions
  - `blueprints/` - Example blueprints to get started

**Note:** Builds and artifacts are created in your **current working directory** when running `renku generate`. This supports project-based workflows where each project folder has its own `builds/` and `artifacts/` directories.

**Example:**
```bash
renku init --root=/Users/alice/renku-storage
```

---

### `renku update`

Update the catalog in the active workspace.

**Usage:**
```bash
renku update
```

**Behavior:**
- Reads the active workspace from CLI config
- Copies bundled catalog files, overwriting existing ones
- Users can revert changes using git

**Example:**
```bash
renku update
```

---

### `renku use`

Switch to an existing Renku workspace.

**Usage:**
```bash
renku use --root=/path/to/workspace
```

**Options:**
- `--root` (required): Path to an existing Renku workspace

**Behavior:**
- Validates the folder is a valid Renku workspace
- Updates CLI config to point to the specified workspace

**Example:**
```bash
renku use --root=~/other-workspace
```

---

### `renku new:blueprint`

Create a new blueprint project, either from scratch or by copying an existing blueprint from the catalog.

**Usage:**
```bash
# Create from scratch (scaffold)
renku new:blueprint <name>

# Copy from catalog blueprint
renku new:blueprint <name> --using=<catalog-blueprint>
```

**Arguments:**
- `<name>` (required): Name for the new blueprint (kebab-case, e.g., `my-video-project`)

**Options:**
- `--using` (optional): Name of an existing blueprint in the catalog to copy from

**Behavior:**

Without `--using` (scaffold mode):
- Creates a new folder with the blueprint name
- Generates a skeleton blueprint YAML with all required sections
- Generates an input-template.yaml with example structure
- The blueprint ID is auto-generated as PascalCase from the name

With `--using` (copy mode):
- Copies the entire blueprint folder from the catalog
- Renames the blueprint YAML file to match the new name
- Preserves all files including prompt producers, schemas, etc.

**Examples:**
```bash
# Create a new blueprint from scratch
renku new:blueprint my-video-project

# Create a project based on an existing blueprint
renku new:blueprint my-ken-burns --using=ken-burns

# Create a documentary-style project
renku new:blueprint history-series --using=documentary-talkinghead
```

**Output Structure:**
```
my-video-project/
├── my-video-project.yaml    # Blueprint definition
├── input-template.yaml      # Input template
└── (additional files if copied from catalog)
```

**Notes:**
- Always use this command instead of directly referencing catalog blueprints
- Blueprint names must be kebab-case (lowercase with hyphens)
- The blueprint ID in the YAML is automatically converted to PascalCase

---

### `renku generate`

Create a new movie or continue an existing one.

**Usage (new run):**
```bash
renku generate [<inquiry-prompt>] --inputs=<path> --blueprint=<path> [--dry-run] [--non-interactive] [--up-to-layer=<n>] [--re-run-from=<n>]
```

**Usage (continue an existing movie):**
```bash
renku generate --movie-id=<movie-id> --inputs=<path> [--dry-run] [--non-interactive] [--up-to-layer=<n>] [--re-run-from=<n>]
renku generate --last --inputs=<path> [--dry-run] [--non-interactive] [--up-to-layer=<n>] [--re-run-from=<n>]
```

**Options:**
- `--inputs` / `--in` (required): Path to inputs YAML file (contains model selections)
- `--blueprint` / `--bp` (required for new runs): Path to blueprint YAML file
- `--movie-id` / `--id` (mutually exclusive with `--last`): Continue a specific movie
- `--last` (mutually exclusive with `--movie-id`): Continue the most recent movie (fails if none recorded)
- `--dry-run`: Execute a mocked run without calling providers
- `--non-interactive`: Skip confirmation prompt
- `--up-to-layer` / `--up`: Stop execution after the specified layer (live runs only)
- `--re-run-from` / `--from`: Re-run from specified layer (0-indexed), skipping earlier layers

**Behavior:**
1. New runs: validate inputs/blueprint, generate a new movie id, create `builds/movie-{id}/`, and execute the workflow.
2. Continuing runs: load the existing manifest, apply any artifact edits, regenerate the plan, and execute with the stored blueprint (or an explicit override).
3. Artifacts view under `artifacts/<id>` stays in sync after successful runs.
4. The CLI records the latest movie id so `--last` can target it explicitly; if missing, the command fails with an error.

**Examples:**
```bash
# New run with inline prompt
renku generate "Explain black holes" --inputs=~/inputs.yaml --blueprint=~/.renku/blueprints/audio-only.yaml

# Continue a specific movie
renku generate --movie-id=movie-q123456 --inputs=./inputs.yaml --up-to-layer=1

# Continue the most recent movie
renku generate --last --inputs=./inputs.yaml --dry-run

# Re-run from layer 2 (skips layers 0-1, uses existing artifacts)
renku generate --last --inputs=./inputs.yaml --from=2

# Re-run layers 2-3 only
renku generate --movie-id=movie-q123456 --inputs=./inputs.yaml --from=2 --up-to-layer=3
```

---

### `renku list`

List all builds in the current project directory.

**Usage:**
```bash
renku list
```

**Behavior:**
- Scans `builds/` in the current working directory
- Shows which builds have artifacts (completed runs) vs. dry-run only builds
- Suggests running `renku clean` to remove dry-run builds

**Example Output:**
```
Builds in current project:

  ✓ movie-abc123 (has artifacts)
  ○ movie-def456 (dry-run, no artifacts)
  ○ movie-ghi789 (dry-run, no artifacts)

Run `renku clean` to remove 2 dry-run build(s).
```

---

### `renku clean`

Remove build artifacts from the current project. By default, only removes dry-run builds (builds without artifacts).

**Usage:**
```bash
renku clean [--movie-id=<id>] [--all] [--dry-run]
```

**Options:**
- `--movie-id`, `--id`: Clean a specific movie by ID
- `--all`: Clean all builds including those with artifacts (requires confirmation)
- `--dry-run`: Show what would be cleaned without actually deleting
- `--non-interactive`: Skip confirmation prompts

**Behavior:**
- Without options: Removes all dry-run builds (builds without corresponding `artifacts/` folder)
- With `--movie-id`: Removes only the specified build (protected if it has artifacts unless `--all` is used)
- With `--all`: Removes all builds including those with artifacts

**Examples:**
```bash
# Clean only dry-run builds (safe default)
renku clean

# Preview what would be cleaned
renku clean --dry-run

# Clean a specific movie
renku clean --movie-id=movie-abc123

# Clean everything including completed builds
renku clean --all
```

---

### `renku export`

Export a previously generated movie to MP4/MP3 format.

**Usage:**
```bash
renku export --movie-id=<movie-id> [options]
renku export --last [options]
renku export --last --inputs=<config.yaml>
```

**CLI Options:**
- `--movie-id` / `--id` (mutually exclusive with `--last`): Export a specific movie by ID
- `--last` (mutually exclusive with `--movie-id`): Export the most recently generated movie
- `--inputs` / `--in` (optional): Path to export config YAML file (for advanced settings)
- `--exporter` (optional): Exporter backend - `remotion` (default) or `ffmpeg`
- `--width` (optional): Video width in pixels (default: 1920)
- `--height` (optional): Video height in pixels (default: 1080)
- `--fps` (optional): Frames per second (default: 30)

**Exporter Backends:**

| Exporter | Description | Requirements |
|----------|-------------|--------------|
| `remotion` | Docker-based Remotion renderer (default) | Docker Desktop |
| `ffmpeg` | Native FFmpeg renderer | FFmpeg installed |

The FFmpeg exporter is faster and requires no Docker. It also supports karaoke-style subtitles and produces MP3 for audio-only timelines.

**Export Config File:**

For advanced settings (FFmpeg encoding options, subtitles), use a YAML config file:

```yaml
# Basic settings (can also be set via CLI flags)
width: 1920
height: 1080
fps: 30
exporter: ffmpeg

# FFmpeg-specific encoding settings
preset: medium      # x264 preset: ultrafast, fast, medium, slow
crf: 23             # Quality (0-51, lower = better quality)
audioBitrate: 192k  # Audio bitrate

# Subtitle settings (requires TranscriptionProducer in blueprint)
subtitles:
  font: Arial                    # Font name (system fonts)
  fontSize: 48                   # Font size in pixels
  fontBaseColor: "#FFFFFF"       # Default text color (hex)
  fontHighlightColor: "#FFD700"  # Karaoke highlight color (hex)
  backgroundColor: "#000000"     # Background box color (hex)
  backgroundOpacity: 0.5         # Background opacity (0-1, 0 = no box)
  bottomMarginPercent: 10        # Position from bottom (% of height)
  maxWordsPerLine: 4             # Words displayed at once
  highlightEffect: true          # Enable karaoke-style highlighting
```

**Requirements:**
- The blueprint must include a `TimelineComposer` producer
- The movie must have a Timeline artifact
- For `remotion`: Docker Desktop running
- For `ffmpeg`: FFmpeg installed and in PATH
- For subtitles: Blueprint must include a `TranscriptionProducer`

**Behavior:**
1. Validates the blueprint has a TimelineComposer producer
2. Validates the manifest contains a Timeline artifact
3. Invokes the selected exporter with specified settings
4. Saves output to `builds/{movieId}/FinalVideo.mp4` (or `FinalAudio.mp3` for audio-only)
5. Creates a symlink in `artifacts/{movieId}/` for easy access

**Error Messages:**
- "A TimelineComposer producer is required in the blueprint to export video." — Blueprint missing TimelineComposer
- "No timeline found. Please run the generation first to create a timeline." — No Timeline artifact in manifest
- "Docker render failed: ..." — Remotion rendering error
- "FFmpeg render failed: ..." — FFmpeg rendering error

**Examples:**
```bash
# Export with defaults (1920x1080 @ 30fps, remotion exporter)
renku export --movie-id=movie-q123456

# Export the most recent movie
renku export --last

# Export with custom resolution
renku export --last --width=3840 --height=2160 --fps=24

# Use FFmpeg exporter (faster, no Docker required)
renku export --last --exporter=ffmpeg

# Use config file for advanced settings (subtitles, encoding)
renku export --last --inputs=./export-config.yaml
```

**Output:**
```
Export completed successfully.
  Movie: movie-q123456
  Output: /path/to/project/artifacts/movie-q123456/FinalVideo.mp4
  Resolution: 1920x1080 @ 30fps
  Exporter: ffmpeg
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

Workspace root (initialized with `renku init`):
```
{rootFolder}/
├── .gitignore               # Auto-generated: ignores **/builds/ and **/artifacts/
└── catalog/
    └── blueprints/
        └── *.yaml           # Blueprint files
```

Project directory (current working directory when running `renku generate`):
```
{project}/
├── builds/                  # GITIGNORED - build data
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
└── artifacts/               # GITIGNORED - symlinks to build outputs
    └── movie-{id}/
        ├── Script.txt       # Symlink to blobs/
        ├── Segment_0.mp3    # Symlink to blobs/
        └── ...
```

**Key Concepts:**
- **Workspace root**: Contains catalog/blueprints (tracked in git)
- **Project directory**: Where you run `renku generate` - contains builds/ and artifacts/ (gitignored)
- **artifacts/**: Human-friendly symlinks to generated content - presence indicates a "real" build (not dry-run)

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
   - Update your original inputs file or edit artifacts in the `artifacts/movie-q123456/` folder.

3. **Re-run generation against the same movie:**
   ```bash
   renku generate --movie-id=movie-q123456 --inputs=./inputs.yaml
   ```

4. **Review:**
   - Artifacts are refreshed under `artifacts/movie-q123456/`.
   - Use `renku viewer:view --movie-id=movie-q123456` to open the viewer.

**Use Cases:**
- Fix LLM-generated script errors by editing inputs and rerunning.
- Replace unsatisfactory artifacts by editing files in `artifacts/`.
- Regenerate partial workflows with `--up-to-layer` to limit execution.
- Re-run from a specific layer with `--from` to retry failed layers without regenerating earlier content.

### Re-Running from a Specific Layer

When you need to regenerate content from a specific layer onwards (e.g., after changing model settings or fixing an issue), use `--re-run-from`:

```bash
# Re-run from layer 2 (skips layers 0-1, uses existing artifacts)
renku generate --last --inputs=./inputs.yaml --from=2
```

The `--from` flag:
- Takes a 0-indexed layer number
- Skips all layers before the specified layer (uses existing artifacts)
- Forces all jobs at the specified layer and above to re-run
- Requires `--inputs` to be specified (for model selections)

Combine with `--up-to-layer` to re-run a specific range:

```bash
# Re-run only layers 2 and 3
renku generate --last --inputs=./inputs.yaml --from=2 --up-to-layer=3
```

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
