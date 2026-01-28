# @gorenku/cli

> Command-line interface for generating AI-powered video content with Renku

[![npm version](https://img.shields.io/npm/v/@gorenku/cli.svg)](https://www.npmjs.com/package/@gorenku/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

The Renku CLI is the primary interface for generating AI-powered video content. It orchestrates multiple AI providers to transform text prompts into complete video productions with narration, images, audio, and effects.

## Installation

Install globally via npm:

```bash
npm install -g @gorenku/cli
```

Or use with npx without installing:

```bash
npx @gorenku/cli --version
```

## Quick Start

### Prerequisites

- **Node.js 18+** - Download from [nodejs.org](https://nodejs.org)
- **pnpm** (optional) - Install with `npm install -g pnpm`
- **API Keys** - You'll need keys for the AI providers used by your chosen blueprint

### 1. Initialize Your Workspace

```bash
renku init --root=~/my-videos
```

This creates:
- `~/.config/renku/cli-config.json` - Configuration file
- `~/my-videos/.gitignore` - Ignores `**/builds/` and `**/artifacts/`
- `~/my-videos/catalog/` - Catalog containing:
  - `models/` - Supported model configurations
  - `producers/` - Supported producer definitions
  - `blueprints/` - Example blueprints to get started
- `~/.config/renku/env.sh` - Placeholder for API keys

**Note:** Builds and artifacts are created in your **current working directory** when running `renku generate`, not in the workspace root.

### 2. Configure API Keys

Edit the generated `env.sh` file to add your API keys:

```bash
vim ~/.config/renku/env.sh
```

Add your keys for the providers you'll use:

```bash
export OPENAI_API_KEY="your-openai-api-key-here"
export REPLICATE_API_TOKEN="your-replicate-api-token-here"
export FAL_KEY="your-fal-api-key-here"
export WAVESPEED_API_KEY="your-wavespeed-api-key-here"
```

Then source the file:

```bash
source ~/.config/renku/env.sh
```

For detailed provider setup, see the [full documentation](https://gorenku.com/docs/quick-start#configure-api-keys).

### 3. Create an Inputs File

Navigate to your workspace and copy an input template:

```bash
cd ~/my-videos
cp ./catalog/blueprints/kenn-burns/input-template.yaml ./my-inputs.yaml
```

Edit `my-inputs.yaml` with your desired parameters:

```yaml
inputs:
  InquiryPrompt: "Tell me about the history of the Eiffel Tower."
  Duration: 20
  NumOfSegments: 2
  NumOfImagesPerNarrative: 1
  Style: "Ghibli"
  Size: "1K"
  AspectRatio: "16:9"
  Audience: "Adult"
  VoiceId: "Wise_Woman"
  Emotion: neutral

models:
  - model: gpt-4o-mini
    provider: openai
    producerId: ScriptProducer
  - model: gpt-4o-mini
    provider: openai
    producerId: ImagePromptProducer
  - model: google/nano-banana
    provider: replicate
    producerId: ImageProducer
  - model: minimax/speech-2.6-hd
    provider: replicate
    producerId: AudioProducer
```

### 4. Generate Your Video Content

Run the generation:

```bash
renku generate \
  --inputs=./my-inputs.yaml \
  --blueprint=./catalog/blueprints/kenn-burns/image-audio.yaml
```

The CLI will:
1. Generate a narration script using OpenAI
2. Create images for each segment
3. Generate audio narration
4. Compose the timeline
5. Save all artifacts to `builds/movie-{id}/` (in current directory)

### 5. View the Results

Open the viewer to preview your content:

```bash
renku viewer
```

This auto-detects your blueprint, starts a local server if needed, and opens your browser to preview the generated content.

## Key Commands

### Workspace Management

- `renku init --root=<path>` - Initialize a new workspace
- `renku update` - Update the catalog in the active workspace
- `renku use --root=<path>` - Switch to an existing workspace

### Content Generation

- `renku generate` - Generate video content from a blueprint
  - `--inputs=<file>` - Input parameters YAML file (required)
  - `--blueprint=<file>` - Blueprint definition file
  - `--dry-run` - Validate without making API calls
  - `--concurrency=<n>` - Number of parallel jobs (default: 1)
  - `--up-to-layer=<n>` - Stop after specified layer
  - `--re-run-from=<n>` / `--from=<n>` - Re-run from specified layer (skips earlier layers)

### Viewing Content

- `renku viewer [path]` - Open the blueprint viewer (auto-detects in current directory if no path provided)
- `renku viewer:stop` - Stop the background viewer server

### Blueprints

- `renku blueprints:validate <file>` - Validate a blueprint

### Producers & Models

- `renku producers:list --blueprint=<file>` - List available producers and models

### Utilities

- `renku list` - List builds in current project (shows dry-run vs completed)
- `renku clean` - Remove build artifacts (dry-runs only by default, `--all` for everything)
- `renku export` - Export movie to MP4/MP3 format
  - `--movie-id=<id>` / `--last` - Movie to export
  - `--inputs=<file>` - Export config YAML file (for advanced settings)
  - `--exporter=<type>` - Exporter backend: `remotion` or `ffmpeg`
  - `--width`, `--height`, `--fps` - Video dimensions and frame rate

For complete command documentation, see the [CLI Reference](https://gorenku.com/docs/cli-reference).

## Configuration

### Workspace Structure

After initialization, your workspace contains:

```
~/my-videos/                 # Workspace root (initialized with `renku init`)
├── .gitignore               # Auto-generated: ignores **/builds/ and **/artifacts/
└── catalog/
    └── blueprints/          # Blueprint templates
```

When you run `renku generate` from a project folder:

```
~/my-videos/my-project/      # Project folder (current working directory)
├── my-inputs.yaml           # Your inputs file (tracked in git)
├── builds/                  # GITIGNORED - build data
│   └── movie-{id}/
│       ├── blobs/           # Generated files (audio, images, etc.)
│       ├── manifests/       # Artifact metadata
│       ├── events/          # Execution logs
│       └── runs/            # Execution plans
└── artifacts/               # GITIGNORED - symlinks to build outputs
    └── movie-{id}/
        ├── Script.txt       # Symlink to generated script
        ├── Segment_0.mp3    # Symlink to audio segments
        └── ...
```

Use `renku list` to see builds in the current project and `renku clean` to remove dry-run builds.

### Config File

The CLI configuration is stored at `~/.config/renku/cli-config.json`:

```json
{
  "storageRoot": "/Users/you/my-videos",
  "viewerHost": "127.0.0.1",
  "viewerPort": 3456
}
```

## Learn More

- **[Full Documentation](https://gorenku.com/)** - Complete guides and references
- **[Quick Start Guide](https://gorenku.com/docs/quick-start)** - Detailed getting started tutorial
- **[CLI Reference](https://gorenku.com/docs/cli-reference)** - All commands and options
- **[Blueprint Authoring](https://gorenku.com/docs/blueprint-authoring)** - Create custom workflows
- **[Usage Guide](https://gorenku.com/docs/usage-guide)** - Advanced features and tips

## Troubleshooting

### Missing API Credentials

```
Error: OPENAI_API_KEY not found
```

**Solution:** Export your API keys or add them to the `env.sh` file in `~/.config/renku/` and source it.

### Blueprint Not Found

```
Error: Blueprint file not found
```

**Solution:** Use the full path to the blueprint file. After `renku init`, blueprints are in `{workspace}/catalog/blueprints/`.

### Provider Rate Limits

Providers have rate limits that may depend on your tier. Setting `--concurrency` higher than 1 may trigger these limits. If you hit rate limits, try lowering concurrency or upgrading your plan with the provider.

### Dry Run Works, Real Run Fails

Check that:
1. All required API keys are set
2. Your API accounts have sufficient credits
3. The model names in the inputs file are valid

Run `renku producers:list --blueprint=<path>` to see available models and check for missing tokens.

For more troubleshooting help, see the [documentation](https://gorenku.com/docs/quick-start#troubleshooting).

## License

MIT
