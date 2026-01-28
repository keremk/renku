# Renku Viewer

> Browser-based viewer for Renku generated content with Remotion Player

The viewer is a standalone React + Remotion UI served by Vite in development and by a bundled Node server in production. It loads movie artifacts from the CLI storage root (`<root>/builds/<movieId>`) and exposes the same viewer API that the CLI depends on.

**Note:** This is a private package bundled with the CLI. It's not published independently to npm.

## Overview

The Renku Viewer is a browser-based application for inspecting and playing back AI-generated video content. It provides:

- **Timeline visualization** - View the complete timeline with all tracks and clips
- **Remotion Player** - High-quality video playback with frame-accurate seeking
- **Asset inspection** - Browse generated images, audio, video, and other artifacts
- **Real-time preview** - See changes as you iterate on your content

The viewer is automatically bundled with `@gorenku/cli` and served via `renku viewer` commands.

## Technology Stack

- **React 19** - UI framework
- **Remotion Player 4.0+** - Video playback engine
- **Vite 7** - Development server and build tool
- **Tailwind CSS v4** - Styling
- **Shadcn UI** - UI component library
- **Lucide React** - Icons

## Development Workflow

### Prerequisites

Make sure the CLI has a storage root initialized:

```bash
renku init --root=~/renku
```

The dev server will auto-read `~/.config/renku/cli-config.json`, so you usually don't need an environment variable.

### Start Development Server

```bash
pnpm --filter viewer dev
```

If you prefer explicit configuration, set `RENKU_VIEWER_ROOT`:

```bash
RENKU_VIEWER_ROOT=~/renku pnpm --filter viewer dev
```

Vite mounts the filesystem middleware via `createViewerApiMiddleware`, so the dev server behaves like production (hot reload, proxy endpoints under `/viewer-api`).

### Navigate to Movies

Once the viewer is running, navigate to:

```
http://localhost:5173/movies/<movieId>
```

Replace `<movieId>` with the ID of a generated movie from your workspace.

## Building + Bundling for CLI

### 1. Build and Copy to CLI

Build the viewer and copy assets to the CLI package:

```bash
pnpm bundle:viewer
```

This script (defined in `scripts/prepare-viewer-bundle.mjs`):
- Builds the viewer application
- Wipes `cli/viewer-bundle/`
- Copies `viewer/dist` (static assets) and `viewer/server-dist` (server bundle)

**Important:** Run this before publishing or packaging the CLI so the assets ship alongside the binary.

### 2. Package CLI with Viewer

To produce a release tarball (viewer + CLI):

```bash
pnpm package:cli
```

The output lands in `release/` and can be published to npm or shared directly.

### 3. Custom Bundle Location

If the viewer assets live elsewhere (e.g., a pre-packaged archive), set `RENKU_VIEWER_BUNDLE_ROOT` before invoking the CLI:

```bash
export RENKU_VIEWER_BUNDLE_ROOT=/absolute/path/to/viewer
```

The CLI expects `dist/` and `server-dist/bin.js` inside that folder.

## Production Usage (via CLI)

### Open Blueprint Viewer

```bash
renku viewer
```

This command:
- Auto-detects blueprints in the current directory
- Launches the viewer server in the background if needed
- Opens the browser to the blueprint viewer

You can also specify a blueprint path:

```bash
renku viewer ./path/to/blueprint.yaml
```

Background servers are tracked in `<root>/config/viewer-server.json`.

### Stop Background Server

```bash
renku viewer:stop
```

Stops the background server spawned by `renku viewer`.

## Configuration

The CLI caches the chosen host/port inside `~/.config/renku/cli-config.json`:

```json
{
  "storageRoot": "/Users/you/renku",
  "viewerHost": "127.0.0.1",
  "viewerPort": 3456
}
```

Override temporarily via CLI flags:

```bash
renku viewer --viewerHost=localhost --viewerPort=8080
```

## Architecture

### Development Server

- Vite dev server with HMR (hot module replacement)
- Filesystem middleware serves viewer API endpoints
- Assets loaded from CLI storage root

### Production Server

- Node.js server serves static bundle
- API endpoints under `/viewer-api`
- Health check endpoint: `/viewer-api/health`
- Cache headers for immutable assets
- `index.html` fallback for client routing

### Filesystem Access

All filesystem access is scoped to `<root>/builds`. If the viewer returns 404s from `/viewer-api`, verify:
1. `RENKU_VIEWER_ROOT` points to your CLI root
2. The movie ID exists under `builds/`

## Project Structure

```
viewer/
├── src/
│   ├── components/          # React components
│   │   ├── timeline/        # Timeline editor components
│   │   └── player/          # Remotion Player components
│   ├── hooks/               # React hooks
│   ├── lib/                 # Utility libraries
│   ├── services/            # Services layer
│   ├── data/                # Data layer
│   ├── assets/              # Static assets
│   ├── types/               # Type definitions
│   ├── styles/              # CSS/styling
│   └── main.tsx             # Entry point
├── server/                  # Production server code
├── server-dist/             # Server build output
├── dist/                    # Client build output
├── public/                  # Public static files
└── vite.config.ts           # Vite configuration
```

## Development Commands

```bash
# Start dev server
pnpm --filter viewer dev

# Build for production
pnpm --filter viewer build

# Build server only
pnpm --filter viewer build:server

# Preview production build
pnpm --filter viewer preview
```

## Troubleshooting

### 404s from /viewer-api

**Problem:** Viewer API endpoints return 404 errors.

**Solution:** Verify `RENKU_VIEWER_ROOT` environment variable points to your CLI root directory. Check that the movie exists under `builds/<movieId>`.

### Movie Not Found

**Problem:** "Movie not found" error when opening a movie.

**Solution:**
1. Verify the movie ID is correct
2. Check that files exist in `<root>/builds/<movieId>`
3. Ensure you've run `renku generate` successfully

### Port Conflicts

**Problem:** Viewer server fails to start due to port conflict.

**Solution:** Change the port in `~/.config/renku/cli-config.json` or use the `--viewerPort` flag:

```bash
renku viewer --viewerPort=8080
```

## Contributing

When contributing to the viewer:

- Follow Shadcn UI component patterns
- Use Tailwind CSS for styling (no custom CSS unless necessary)
- Ensure TypeScript strict mode compliance
- Test in both development and production modes
- Follow the conventions in [CLAUDE.md](../CLAUDE.md)

## License

MIT
