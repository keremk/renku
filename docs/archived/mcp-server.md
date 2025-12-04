# Tutopanda MCP Server – Research, Design, and Plan

## 1. Context & Goals
The Tutopanda CLI already orchestrates blueprint-driven movie generation (`tutopanda generate`, `inspect`, `viewer:*`). We now need to expose a Model Context Protocol (MCP) server so external LLM clients (e.g., Claude Desktop/Code) can:

- Invoke a **single tool** (`generate_story`) that mirrors the CLI workflow while accepting structured inputs.
- Browse **resources** (blueprints, movie inputs, timelines, artefacts) produced in the local CLI workspace.
- Keep using canonical node IDs (`Input:…`, `Artifact:…`) so downstream tooling can reason about plans/artefacts consistently.

The initial milestone must keep scope tight: one tool, a small set of resources, and stdio transport. Future iterations can add more tools (inspect/edit) or transports, but not now.

## 2. Research & Findings

### CLI & Storage
- `tutopanda init`/`install` (alias) creates a root folder (default `~/.tutopanda`) with `builds/`, bundled `config/blueprints`, and `cli-config.json` (`cli/src/commands/init.ts`, `cli/src/lib/config-assets.ts`, `cli/src/lib/cli-config.ts`).
- Every `generate` run writes `builds/<movieId>/inputs.yaml`, a prompt copy, plan logs under `runs/`, artefacts catalogued via manifests, and `movie-metadata.json` capturing the blueprint path (`cli/src/lib/planner.ts`, `core/src/storage.ts`, `cli/src/lib/movie-metadata.ts`).
- Viewer helper commands (`viewer:start`, `viewer:view`) spin up the Vite-based viewer that already reads manifests and exposes `/viewer-api/...` endpoints (`cli/src/commands/viewer.ts`, `viewer/server/viewer-api.ts`).

### Blueprint/Planner Pipeline
- `runGenerate` validates `--inputs`/`--blueprint`, builds a plan via `generatePlan` (which calls `loadBlueprintBundle`, validates inputs from YAML, persists them, and builds a provider catalog) (`cli/src/commands/generate.ts`, `cli/src/lib/planner.ts`).
- `executeBuild` then executes the plan, writes manifests (`cli/src/lib/build.ts`, `core/src/manifest.ts`).
- Canonical IDs are baked into the blueprint graph (`core/src/types.ts`, `core/src/planner.ts`); artefact IDs include producer namespaces (e.g., `Artifact:TimelineComposer.Timeline`).

### MCP SDK
- Tutopanda already depends on `@modelcontextprotocol/sdk@^1.22.0` (via `cli/package.json`). The SDK offers `McpServer`, `StdioServerTransport`, and an `InMemoryTransport` for tests.
- We can register resources (static or template URIs), tools (with Zod-validated params), and send logging events.

### Resource Candidates
Given the existing filesystem layout:
1. **Blueprints** – `.yaml` files under `<root>/config/blueprints/…`.
2. **Movie inputs** – `builds/<movieId>/inputs.yaml`.
3. **Timeline** – `Artifact:TimelineComposer.Timeline` entry stored inline or as a blob in the manifest.
4. **Artefacts** – All manifest artefacts, accessible by canonical ID for follow-up fetches or asset streaming.

These align with the viewer API logic, so we can reuse similar helpers.

## 3. Requirements for v1
1. **Single tool** (`generate_story`):
   - Accepts InquiryPrompt, Duration, NumOfSegments, ImageStyle, VoiceId, and optional inputs (NumOfImagesPerNarrative, Size, AspectRatio, Audience, Emotion).
   - Supports an optional `blueprint` override; otherwise uses a **configurable default** supplied via the MCP command flags when launching the server.
   - Optional `openViewer` flag (defaults to `true`) to keep the current UX of launching the viewer.
   - Produces a movie via the same pipeline as `tutopanda generate` (non-interactive, not a dry run).
   - Returns metadata (movieId, storage paths, timeline/artefact resource URIs, viewer URL if launched).

2. **Resources**:
   - Blueprint directory listing + file reads.
   - Per-movie inputs file.
   - Timeline JSON.
   - Artefact entries (inline or blob metadata with canonical IDs).

3. **Canonical IDs** must always propagate; no heuristic aliases.

4. **Docs**: Add a comprehensive “MCP Install” section to `cli/readme.md` covering Claude Desktop & Claude Code client setup (command strings, config pointers).

5. **Tests**: Use the SDK’s `InMemoryTransport` to cover resource listing and the tool flow.

## 4. Proposed Architecture

### CLI Integration
- Extend `cli/src/cli.tsx`:
  - Add `mcp` to the usage/help text.
  - Parse `--config`, `--blueprintsDir`, `--defaultBlueprint`, `--openViewer` (optional), and route the command to `runMcpServer`.

### Command Wrapper (`cli/src/commands/mcp.ts`)
- Responsibilities:
  - Read CLI config (fail fast if `tutopanda init` hasn’t run).
  - Resolve blueprint directory (`--blueprintsDir` > `<root>/config/blueprints` > bundled fallback).
  - Determine `defaultBlueprint` from the CLI flag (required).
  - Read `cli/package.json` to display `name/version` in the MCP banner.
  - Instantiate the MCP server factory with:
    - Storage root + base path.
    - Blueprint directory + default blueprint file path.
    - Default viewer host/port from CLI config.
  - Create `StdioServerTransport`, call `server.connect`, and hook SIGINT/SIGTERM to `server.close`.
  - Log startup/shutdown + critical errors with the existing console style.

### Server Factory (`cli/src/mcp/server.ts`)
Builds and configures `McpServer`:

1. **Instructions** – Document what the tool does (“Generate a Tutopanda movie using the configured blueprint; inspect resources under tutopanda://…”).

2. **Resources**:
   - `tutopanda://blueprints/{slug}`  
     - `slug` = relative path under the blueprint dir.  
     - `list` enumerates all `.yaml`.  
     - `read` returns the YAML contents.
   - `tutopanda://movies/{movieId}/inputs`  
     - Lists folders under `builds/`.  
     - Reads `inputs.yaml`.
   - `tutopanda://movies/{movieId}/timeline`  
     - Loads manifest pointer (`current.json`), then manifest JSON.  
     - Extracts `Artifact:TimelineComposer.Timeline` (inline → JSON parse; blob → read file, parse JSON).
   - `tutopanda://movies/{movieId}/artefacts/{canonicalId}`  
     - Enumerates manifest artefacts.  
     - `read` returns inline text or base64 for blob (with MIME + size metadata).  
     - Keeps canonical IDs as URIs.
   - After a successful tool invocation, call `server.sendResourceListChanged()` to notify clients.

3. **Tool**: `generate_story`
   - **Schema**: Zod object with the blueprint inputs + `blueprint?: string`, `openViewer?: boolean`.
   - **Execution path**:
     1. Resolve blueprint path (`request.blueprint ?? defaultBlueprint`), error if none.
     2. Serialize inputs to a temp YAML, or reuse provided `inputsPath`.
    3. Call `runGenerate` with `nonInteractive: true`, `dryRun: false`, passing the YAML path + blueprint path.
     4. After build, optionally invoke `runViewerView` if `openViewer !== false`.
     5. Return:
        - `movieId` (public), `storageMovieId`.
        - Plan path, manifest path, viewer URL (if launched).
        - Resource URIs for timeline (`tutopanda://movies/{id}/timeline`) and artefacts produced.
   - **Error handling**: Fail fast (missing blueprint, missing required input, CLI not initialized), log via `sendLoggingMessage`, and propagate structured MCP tool errors.

4. **Shared Helpers**:
   - Manifest loader (shared with resources/tool) that reads `current.json` and manifest files from storage root/base path.
   - Blueprint indexer (walks directories once per list call).
   - Movie lister (reads directories under `builds/`).

### Viewer Integration
- `runViewerView` already ensures the viewer server is running and opens a browser. `generate_story` toggles this via the `openViewer` flag (default `true`), so default behaviour matches existing CLI expectations but headless μclients can opt out.

### Logging & Signals
- Use `server.sendLoggingMessage` for high-level lifecycle events (start build, provider invocation, viewer launch).
- On process signals, close transport + server gracefully.

## 5. Implementation Plan
1. **CLI plumbing** – Update `cli/src/cli.tsx` to add the command/flags and type definitions.
2. **Command module** – Implement `cli/src/commands/mcp.ts` with config resolution, banner, transport wiring, and error reporting.
3. **Server factory** – Build `cli/src/mcp/server.ts` with:
   - Resource registration helpers.
   - `generate_story` handler and response formatting.
   - Storage/manifest utilities (reuse logic from `viewer/server/viewer-api.ts` where possible).
4. **Tests** – Add Vitest coverage under `cli/src/mcp/__tests__/` using the SDK’s `InMemoryTransport` to ensure resource listings behave and the tool wires through to mocked `runGenerate`.
5. **Docs** – Update:
   - `cli/docs/mcp-server.md` (this file) with implementation notes as the project evolves.
   - `cli/readme.md` with an “MCP Install” section describing:
     - Running `tutopanda init`/`install`.
     - Command to launch the server.
     - How to register it in Claude Desktop (JSON snippet + flags) and Claude Code (VS Code `claude.code` MCP entry).
6. **Manual QA** – Launch the MCP server locally, test from Claude Desktop/Code, verify viewer auto-opens (or not, depending on flag), and ensure resources show up immediately after a run.

## 6. Future Extensions (Out of Scope Now)
- Additional tools (inspect/edit), prompt export resources, plan/manifest resources.
- Alternate transports (WebSocket/socket path) and auth.
- Streaming build progress back to clients beyond basic logging messages.

This document will track any deviations as we implement the server. For now it captures the complete research, design, and plan for the `generate_story` MCP v1.
