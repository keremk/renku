## Remotion Viewer Design (Draft)

### Goals
- Mirror the client’s Remotion experience inside the standalone viewer (Vite + React) using the *same* Ken Burns/audio components instead of placeholders.
- Consume real movie builds produced by the CLI from a configurable `rootFolder` (`<root>/builds/<movieId>`).
- Follow the new array-based timeline schema from `TimelineProducer`.
- For phase 1, fully support Image + Audio tracks (Ken Burns + narration/music). Architecture must allow future clip kinds without rewrites.

### Source of truth & filesystem
- CLI `init` ensures `${root}/builds`. Each movie run writes under `builds/<movieId>` (see `core/src/storage.ts`).
- `current.json` → `manifests/<revision>.json` (hash + pointer).
- Timeline artifact (e.g. `Artifact:TimelineComposer.Timeline`) captures the JSON. Verified via `/home/keremk/tuto/builds/movie-6bc50f83`:
  - Entry stores `inline` JSON **and** a blob reference (`blobs/02/<hash>`). We can parse the inline payload immediately and optionally fall back to blobs for very large files.
- Workspaces hold user edits but aren’t the source of truth; viewer always reads from `builds/`.

### Runtime configuration & routes
1. **Configuration**
   - Env var `VITE_TUTOPANDA_ROOT=/absolute/path/to/root` (set by CLI or developer) tells the viewer where `builds/` lives.
   - Vite `server.fs.allow` includes that root so middleware can read manifests/blobs during dev. For the production bundle we mount the same middleware inside a lightweight Node server.
2. **Routes**
   - `/movies/:movieId` renders the viewer for a specific manifest/timeline.
   - `/` may later list movies; for now it can instruct users to navigate directly.

### Viewer server APIs
Browser code never touches the filesystem directly; Vite middleware exposes a scoped API:

| Endpoint | Description |
| --- | --- |
| `GET /viewer-api/movies/:movieId/manifest` | Reads `current.json`, loads the manifest, returns relevant sections (artifacts, metadata). |
| `GET /viewer-api/movies/:movieId/timeline` | Convenience endpoint that pulls `Artifact:TimelineComposer.Timeline` (inline or blob) and returns parsed `TimelineDocument`. |
| `GET /viewer-api/movies/:movieId/assets/:canonicalId` | Resolves canonical artifact IDs to either inline text (for prompts) or a streamed blob. |
| `GET /viewer-api/movies/:movieId/files/:hash` | Direct blob access when we already know the hash (e.g., from manifest entry). |

Guardrails:
- All paths are resolved under `<rootFolder>/builds/<movieId>`; anything outside that tree is rejected.
- Middleware handles canonical ID resolution once so the browser never needs to be aware of manifest internals.

### Layered architecture

1. **Data layer (`viewer/src/data/`)**
   - Pure functions for talking to the viewer API: `fetchManifest(movieId)`, `fetchTimeline(movieId)`, `fetchAsset(movieId, canonicalId)`, etc.
   - Defines domain types (`TimelineDocument`, `TimelineTrack`, `TimelineClip`, `ResolvedAsset`) that reflect the provider schema.
   - Handles canonical asset resolution: given `properties.assetId` or `properties.effects[].assetId`, map to blob URLs.

2. **Services (`viewer/src/services/`)**
   - React hooks/context wrappers around the data layer.
   - Example: `useMovieData(movieId)` returns `{ manifest, timeline, assets, status }`.
   - `useAssetResolver()` exposes memoized lookups + preloading to Remotion components. Cleans up object URLs when clips change.

3. **UI components (`viewer/src/components/`)**
   - Timeline slider/tracks, player chrome, layout containers. Receive data via props/context; no fetch logic.
   - Keep track rendering generic (map over `timeline.tracks`) so new clip kinds require zero UI restructure.

4. **Remotion layer (`viewer/src/remotion/`)**
   - Port `client/src/components/remotion/*` into this folder:
     - `KenBurnsComponent` handles pan/zoom animations per effect preset.
     - `VideoClipRenderer` (later) for video tracks.
     - `SubtitleDisplay` for captions (future extension).
   - Build `VideoComposition` that mirrors the client’s version: iterates over tracks, renders `<Sequence>`s and `<Audio>` components with proper start/duration and `volume`.
   - Composition only consumes normalized data (timeline + asset map) provided by services.

### Timeline schema alignment
- According to `providers/docs/timeline-schema.md` & the manifest sample:
  - `tracks` is an array. Each track has `kind` (e.g., `Image`, `Audio`, `Music`, `Video`, `Captions`).
  - Clips already include `startTime`/`duration`; we no longer compute offsets based on segments.
  - Image clip `properties` contain `effects: Array<{ assetId, startX, … }>`. Each effect corresponds to an image asset.
  - Audio clip `properties` contain `assetId`, `volume`, optional `fadeIn/out`.
- Update viewer type definitions to reflect this shape and create type guards per clip kind so Remotion & timeline UI can branch safely without excessive null checks.

### Remotion playback mapping
- **Image/Ken Burns**
  - For each image clip, iterate over `properties.effects`.
  - Resolve each `assetId` via the asset service, feed into `KenBurnsComponent` with correct coordinates/scales/durations. Sequence multiple effects back-to-back inside the clip.
- **Audio**
  - Each audio clip becomes a `<Sequence>` with nested `<Audio src={resolvedUrl} volume={clip.properties.volume ?? 1} />`.
  - Support fade-in/out using Remotion volume interpolation if properties specify them.
- **Composition orchestration**
  - Determine total frames from `timeline.duration` and chosen fps (30).
  - Preload all assets similar to `client/src/components/remotion/video-composition.tsx`.
  - Ensure asset resolution is asynchronous but occurs before playback (services load assets and pass ready-to-use URLs into the composition).

### Launch flow
1. **Dev**
   - Set `VITE_TUTOPANDA_ROOT`.
   - Run `pnpm --filter viewer dev`; Vite reads the env, allows FS access, registers middleware, and hot reloads UI/remotion code.
   - Navigate to `/movies/<movieId>`.
2. **CLI “launch” command**
   - CLI reads its config (`cli-config.json`), determines root, and spawns the viewer (either via `pnpm dev` or Node server serving `dist`).
   - Passes `VITE_TUTOPANDA_ROOT` via env.
   - Optionally opens the browser automatically.

### Incremental implementation plan
1. **Data/model groundwork**
   - Replace legacy timeline types with provider schema equivalents.
   - Build manifest/timeline fetcher + asset resolver services with caching and cleanup.
2. **Viewer API middleware**
   - Implement the FS-backed endpoints described above with strict path checking.
   - Expose helper utilities for canonical ID resolution (`formatResolvedKey`, etc.).
3. **UI refactor**
   - Update timeline renderer to consume array-based tracks (Icons/titles derived from `kind`), no more hard-coded `visual/voice/music`.
   - Hook up services via React context so components receive normalized data.
4. **Remotion integration**
   - Port `KenBurnsComponent`, `VideoComposition`, and related helpers from the client; adapt to new types + service outputs.
   - Ensure audio playback uses `<Audio>` with `volume` and sequences align to clip timing.
5. **End-to-end wiring**
   - Player uses real `VideoComposition` + resolved assets; timeline controls stay in sync via existing slider/tracks.
   - Validate with sample movie (`movie-6bc50f83`) to confirm Ken Burns animations play with narration audio.
6. **Future extensions**
   - Add support for Music, Video, Captions tracks by extending services + Remotion components without touching the data/UI layers.
