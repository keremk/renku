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
- `~/my-videos/builds/` - Directory for generated content
- `~/my-videos/catalog/blueprints/` - Bundled blueprint templates
- `~/.config/renku/env.sh` - Placeholder for API keys

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
5. Save all artifacts to `builds/movie-{id}/`

### 5. View the Results

Open the viewer to preview your content:

```bash
renku viewer:view --last
```

This starts a local server and opens your browser to preview the generated content.

## Key Commands

### Workspace Management

- `renku init --root=<path>` - Initialize a new workspace
- `renku update` - Update the catalog in the active workspace
- `renku use --root=<path>` - Switch to an existing workspace

### Content Generation

- `renku generate` - Generate video content from a blueprint
  - `--inputs=<file>` - Input parameters YAML file
  - `--blueprint=<file>` - Blueprint definition file
  - `--dry-run` - Validate without making API calls
  - `--concurrency=<n>` - Number of parallel jobs (default: 1)

### Viewing Content

- `renku viewer:start` - Start the viewer server
- `renku viewer:view` - View generated content
  - `--last` - View the most recent generation
  - `--movieId=<id>` - View a specific movie
- `renku viewer:stop` - Stop the viewer server

### Blueprints

- `renku blueprints:list` - List available blueprints
- `renku blueprints:describe <file>` - Show blueprint details
- `renku blueprints:validate <file>` - Validate a blueprint

### Producers & Models

- `renku producers:list --blueprint=<file>` - List available producers and models

### Utilities

- `renku clean` - Remove build artifacts
- `renku export` - Export movie to MP4 format

For complete command documentation, see the [CLI Reference](https://gorenku.com/docs/cli-reference).

## Configuration

### Workspace Structure

After initialization and generation, your workspace contains:

```
~/my-videos/
├── builds/
│   └── movie-{id}/
│       ├── blobs/           # Generated files (audio, images, etc.)
│       ├── manifests/       # Artifact metadata
│       ├── events/          # Execution logs
│       └── runs/            # Execution plans
├── movies/
│   └── movie-{id}/          # Friendly view with symlinks
│       ├── Script.txt       # Generated script
│       ├── Segment_0.mp3    # Audio segments
│       └── ...
└── catalog/
    └── blueprints/          # Blueprint templates
```

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
