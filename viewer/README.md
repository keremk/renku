## Tutopanda Viewer

The viewer is a standalone React + Remotion UI served by Vite in development and by a bundled Node server in production. It loads movie artefacts from the CLI storage root (`<root>/builds/<movieId>`) and exposes the same viewer API that the CLI depends on.

### Development workflow

- Make sure the CLI has a storage root (`tutopanda init`). The dev server will auto-read `~/.tutopanda/cli-config.json`, so you usually don't need an env var at all.
- If you prefer explicit configuration, set `TUTOPANDA_VIEWER_ROOT` (or `VITE_TUTOPANDA_ROOT`) to that root:

  ```bash
  TUTOPANDA_VIEWER_ROOT=~/tuto pnpm --filter viewer dev
  ```

- Vite still mounts the filesystem middleware via `createViewerApiMiddleware`, so the dev server behaves exactly like before (hot reload, proxy endpoints under `/viewer-api`).
- Navigate to `http://localhost:5173/movies/<movieId>` once the viewer is running.

### Building + bundling for the CLI

1. Build + copy the viewer bundle into the CLI package:

   ```bash
   pnpm bundle:viewer
   ```

   That script (defined in `scripts/prepare-viewer-bundle.mjs`) builds the viewer, wipes `cli/viewer-bundle/`, and copies `viewer/dist` plus `viewer/server-dist`. Whenever you publish or package the CLI, run this so the assets ship alongside the binary.

2. To produce a release tarball (with viewer + CLI), run:

   ```bash
   pnpm package:cli
   ```

   The output lands in `release/` and can be published to npm or shared directly.

3. If the viewer assets live elsewhere (e.g. a pre-packaged archive), set `TUTOPANDA_VIEWER_BUNDLE_ROOT=/absolute/path/to/viewer` before invoking the CLI. The CLI expects `dist/` and `server-dist/bin.js` inside that folder.

### CLI commands (production usage)

- `tutopanda viewer:start` – starts the bundled server in the foreground, using the stored host/port (defaults to `127.0.0.1:<available port>`). Hit `Ctrl+C` to stop it.
- `tutopanda viewer:view --movieId movie-123` – pings the server, launches it in the background if needed, and opens the browser at the correct `/movies/<id>` URL (no hardcoded port). Background servers are tracked in `<root>/config/viewer-server.json`.
- `tutopanda viewer:stop` – stops the background server that `viewer:view` spawned.

The CLI caches the chosen host/port inside `cli-config.json`. Override them temporarily via `--viewerHost` / `--viewerPort` when running the commands.

### Notes

- The production server exposes `/viewer-api/health` for liveness checks and serves the static bundle with cache headers (immutable assets, `index.html` fallback for client routing).
- All filesystem access is scoped to `<root>/builds`. If the viewer returns 404s from `/viewer-api`, verify `TUTOPANDA_VIEWER_ROOT` points to your CLI root and that the movie id exists under `builds/`.
