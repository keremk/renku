# Renku

> AI-powered build system for video content generation

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)

<div align="center">
  <img src="./web/public/logo.svg" alt="Renku Logo" width="300">
</div>

**[Documentation](https://gorenku.com/)** • **[Quick Start](https://gorenku.com/docs/quick-start)** • **[Examples](./catalog)**

## What is Renku?

Renku is a powerful build system for generating video content using AI models. It enables you to create narrated documentaries, educational videos, and multimedia presentations from simple text prompts by orchestrating multiple AI providers (OpenAI, Replicate, fal.ai, ElevenLabs) into cohesive production pipelines.

Unlike monolithic AI video tools, Renku gives you fine-grained control over every step of the generation process through **blueprints** - declarative YAML workflows that define how content flows from text prompts to final rendered videos. The system handles dependency resolution, parallel execution, state tracking, and artifact versioning automatically, letting you focus on creative direction rather than infrastructure.

Key features include:
- **Multi-provider orchestration**: Mix and match AI services (text, image, audio, video) in a single workflow
- **Incremental generation**: Layer-by-layer execution with dirty checking - only regenerate what changed
- **State management**: Built-in manifest system tracks all artifacts and their dependencies
- **Parallel execution**: Automatic job parallelization within dependency layers
- **Local-first**: All artifacts stored locally with optional S3 cloud storage support
- **Video composition**: Uses [Remotion](https://www.remotion.dev/) to compose the final video with multiple tracks and segments per track from the AI generated artifacts.
- **MP4 export**: Exports your generated final video to MP4, so you can upload to anywhere you want.  

## Packages

### User-Facing

- **[@gorenku/cli](./cli/README.md)** - Command-line interface for video generation

  The main user-facing tool. Install globally to start generating AI videos from your terminal. Includes workspace management, blueprint execution, and a built-in viewer for previewing results.

### Developer Packages

- **[@gorenku/core](./core/README.md)** - Core workflow orchestration engine

  The foundation of Renku. Handles blueprint loading, execution planning, job orchestration, manifest management, and event logging. Use this package if you're building custom tooling on top of Renku.

- **[@gorenku/providers](./providers/README.md)** - AI provider integrations

  Integrations with OpenAI, Replicate, fal.ai, Wavespeed AI, and other AI services. Includes producer implementations, model catalogs, and a unified provider registry system.

- **[@gorenku/compositions](./compositions/README.md)** - Remotion video compositions

  Remotion-based video rendering components and timeline document format. Supports both browser and Node.js environments for video playback and export.

- **[viewer](./viewer/README.md)** - Browser-based content viewer

  React + Remotion viewer application for inspecting generated content. Bundled with the CLI and served via `renku viewer:view` commands.

## Quick Start

Install the Renku CLI globally:

```bash
npm install -g @gorenku/cli
```

Initialize a workspace:

```bash
renku init --root=~/my-videos
```

Configure your API keys:

```bash
# Edit the generated env.sh file
vim ~/.config/renku/env.sh

# Source the API keys
source ~/.config/renku/env.sh
```

Run your first blueprint:

```bash
cd ~/my-videos

# Copy an input template
cp ./catalog/blueprints/kenn-burns/input-template.yaml ./my-inputs.yaml

# Edit inputs with your desired parameters
vim ./my-inputs.yaml

# Generate content
renku generate \
  --inputs=./my-inputs.yaml \
  --blueprint=./catalog/blueprints/kenn-burns/image-audio.yaml
```

View the results:

```bash
renku viewer:view --last
```

For more detailed instructions, see the [full quick start guide](https://gorenku.com/docs/quick-start).

## Development

This is a pnpm workspace monorepo. To contribute:

```bash
# Clone the repository
git clone https://github.com/yourusername/renku.git
cd renku

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type checking
pnpm check
```

See [CLAUDE.md](./CLAUDE.md) for detailed development conventions, architecture notes, and coding standards.

## Documentation

Full documentation is available at [gorenku.com](https://gorenku.com/):

- [Quick Start Guide](https://gorenku.com/docs/quick-start) - Get up and running in minutes
- [CLI Reference](https://gorenku.com/docs/cli-reference) - Complete command documentation
- [Blueprint Authoring](https://gorenku.com/docs/blueprint-authoring) - Create custom workflows
- [Usage Guide](https://gorenku.com/docs/usage-guide) - Advanced features and tips

## Contributing

We are not yet open for contributions, but it will be coming very soon. 

## License

MIT
