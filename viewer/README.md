# Renku Viewer

> Full-featured blueprint workspace and generation IDE for Renku

The viewer is a React + Node.js application that serves as the main graphical interface for Renku. It is bundled with the CLI (served via `renku viewer`) and embedded in the desktop app. Despite the name, it is far more than a passive viewer — it is the primary UI for browsing blueprints, managing builds, editing inputs, running generation, monitoring execution, and inspecting artifacts.

**Note:** This is a private package. It is not published to npm independently.

## Features

### Blueprint Management
- **Browse blueprints** — lists all blueprints in the workspace with quick-access navigation
- **Catalog templates** — browse bundled templates and create new blueprints from them
- **DAG visualization** — ReactFlow-based graph showing producers, inputs, outputs, and dependency edges with status indicators (running, success, error, skipped, pending)
- **Conditional flow** — visualize conditional edges and producer-level routing

### Build Management
- **Build list** — scrollable list of builds per blueprint, showing timestamps, revisions, and display names
- **Create builds** — create a new execution context for any blueprint
- **Edit build metadata** — rename builds for easier identification
- **Auto-select** — automatically selects the newest build on navigation

### Inputs and Model Configuration
- **Inputs editor** — edit blueprint inputs (strings, numbers, media files) with auto-save
- **File upload** — upload and attach media files as inputs
- **Model selection** — pick AI models per producer from the bundled catalog, filterable by provider
- **Prompt inputs** — edit TOML prompt files for custom blueprint producers
- **Complex config editors** — specialized UI for structured producer configs:
  - **Subtitles** — font, size, colors, position, opacity, highlight effect
  - **Timeline** — clips, music, transitions, timing
  - **Text** — rich text with formatting

### Planning and Execution
- **Plan preview** — inspect the execution plan before running: job breakdown by layer, cost by producer, affected artifacts
- **Layer-limited execution** — run only up to a specific dependency layer for faster iteration
- **Artifact selection** — choose specific artifacts to regenerate; unselected artifacts are skipped
- **Real-time streaming** — SSE-based job events stream execution progress and logs to the UI
- **Terminal-style log panel** — live log output during generation
- **Cancellation** — cancel an in-flight execution mid-run
- **Completion summary** — dialog showing succeeded/failed/skipped counts and which producers failed

### Artifact Inspection and Editing
- **Outputs panel** — browse all generated artifacts organized by producer, with status, previews, and metadata
- **Media preview** — inline preview for images, video, and audio artifacts
- **Artifact editing** — edit text, images, video, and audio artifacts after generation
- **Restore** — restore an edited artifact back to its producer-generated original
- **Artifact pinning** — pin an artifact to exclude it from future regeneration runs
- **AI preview generation** — generate quick AI-powered previews for artifacts
- **Recovery info** — failed artifacts show provider request IDs and failure reasons for debugging
- **Open in Finder / download** — direct access to artifact files on disk

### Video Preview
- **Remotion Player** — frame-accurate video playback with play/pause/reset and timeline seeking
- **Timeline editor** — in-place editor for the Remotion video timeline structure

### Settings
- **Storage root** — change the workspace directory with optional content migration
- **Artifact output** — toggle artifact materialization mode (copy vs. symlink)
- **Concurrency** — set max parallel jobs (1–10)
- **API tokens** — store tokens for OpenAI, Replicate, ElevenLabs, fal.ai, Vercel Gateway; saved to `~/.config/renku/.env`

## Technology Stack

- **React 19** — UI framework
- **Remotion Player 4.0+** — video playback engine
- **ReactFlow** — DAG/graph visualization
- **Vite 7** — development server and build tool
- **Tailwind CSS v4** — styling
- **Shadcn UI** — UI component library
- **Lucide React** — icons
- **Node.js HTTP server** — production API server with SSE streaming

## Development Workflow

### Prerequisites

Make sure the CLI has a storage root initialized:

```bash
renku init --root=~/renku
```

The dev server reads `~/.config/renku/cli-config.json` automatically, so no environment variable is needed in most cases.

### Start Development Server

```bash
pnpm --filter viewer dev
```

To set the workspace root explicitly:

```bash
RENKU_VIEWER_ROOT=~/renku pnpm --filter viewer dev
```

Vite mounts the viewer API middleware (`createViewerApiMiddleware`), so the dev server behaves identically to production — including all `/viewer-api` endpoints and SSE streaming.

### Navigate to a Blueprint

Once the dev server is running, go to:

```
http://localhost:5173/
```

This opens the home page. Select a blueprint to enter the workspace, or create one from a catalog template.

## Building and Bundling for CLI

### Build and copy to CLI

```bash
pnpm bundle:viewer
```

This runs `scripts/prepare-viewer-bundle.mjs`, which:
1. Builds the viewer application (`tsc` + Vite client build + server build)
2. Wipes `cli/viewer-bundle/`
3. Copies `viewer/dist/` (static assets) and `viewer/server-dist/` (server bundle) into the CLI package

Run this before publishing or packaging the CLI.

### Package CLI with Viewer

```bash
pnpm package:cli
```

Produces a release tarball in `release/` that includes both the CLI binary and the viewer bundle.

### Custom Bundle Location

```bash
export RENKU_VIEWER_BUNDLE_ROOT=/absolute/path/to/viewer
```

The CLI expects `dist/` and `server-dist/bin.js` inside that folder.

## Production Usage (via CLI)

### Open the Blueprint Workspace

```bash
renku viewer
```

Auto-detects blueprints in the current directory, launches the viewer server in the background, and opens the browser.

Specify a blueprint directly:

```bash
renku viewer ./path/to/blueprint.yaml
```

Background server state is tracked in `<root>/config/viewer-server.json`.

### Stop the Background Server

```bash
renku viewer:stop
```

## Architecture

### Server API

All server-side logic is in `viewer/server/`. In production it runs as a Node.js HTTP server; in development it is mounted as Vite middleware. Endpoints are grouped under `/viewer-api`:

| Group | Endpoints |
|---|---|
| Blueprints | list, parse, resolve, templates, create from template |
| Producer config | models, config schemas, input schemas |
| Builds | list, create, inputs, manifest, timeline, metadata |
| Artifacts | blob streaming, edit, restore, preview, open folder |
| Generation | plan, execute, job status, SSE stream, cancel |
| Settings | storage root, API tokens, artifact mode, concurrency |
| Onboarding | status check, initialize |

### Frontend State

- **`execution-context.tsx`** — global execution state: plan info, job status, streaming logs, artifact selection, pinning
- **`use-blueprint-route.ts`** — URL-driven routing: blueprint name, build ID, and movie ID in query params
- **`theme-context.tsx`** — light/dark mode, persisted to localStorage

### Development vs Production Server

| | Development | Production |
|---|---|---|
| Server | Vite dev middleware | Standalone Node.js HTTP server |
| Hot reload | Yes (HMR) | No |
| Assets | Served by Vite | Served from `dist/` with cache headers |
| API | Same `createViewerApiMiddleware` | Same middleware, different mount point |

## Project Structure

```
viewer/
├── src/
│   ├── components/
│   │   ├── blueprint/           # Blueprint workspace UI
│   │   │   ├── models/          # Model selection and config editors
│   │   │   │   └── config-editors/  # Subtitles, Timeline, Text editors
│   │   │   ├── builds/          # Build list and management
│   │   │   ├── graph/           # ReactFlow DAG visualization
│   │   │   ├── inputs/          # Inputs panel and file upload
│   │   │   ├── outputs/         # Outputs/artifacts panel
│   │   │   └── execution/       # Run button, plan dialog, progress
│   │   ├── home/                # Home page (blueprint + template browser)
│   │   ├── settings/            # Settings page
│   │   └── shared/              # Shared UI primitives
│   ├── context/                 # React context providers
│   ├── hooks/                   # Custom React hooks
│   ├── services/                # API client functions
│   └── main.tsx                 # Entry point
├── server/                      # Node.js API server and middleware
├── server-dist/                 # Server build output
├── dist/                        # Client build output
├── public/                      # Static assets
└── vite.config.ts               # Vite configuration
```

## Development Commands

```bash
# Start dev server
pnpm --filter viewer dev

# Build (client + server)
pnpm --filter viewer build

# Build server only
pnpm --filter viewer build:server

# Preview production build
pnpm --filter viewer preview

# Type check
pnpm --filter viewer type-check

# Run tests
pnpm --filter viewer test
```

## Troubleshooting

### 404s from /viewer-api

Verify `RENKU_VIEWER_ROOT` points to your CLI root and the movie exists under `builds/<movieId>`.

### Port Conflicts

Change the port in `~/.config/renku/cli-config.json` or pass a flag:

```bash
renku viewer --viewerPort=8080
```

## License

Renku Source-Available License — see [LICENSE](./LICENSE).
