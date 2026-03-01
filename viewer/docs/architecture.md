# Viewer App Architecture

This document describes the architecture, component patterns, data flow, and conventions used in the Renku Viewer application.

## Overview

The viewer is a browser-based blueprint workspace built with **Vite + React 19**, **Tailwind CSS v4**, **Remotion Player**, and **Shadcn UI** components. It is a private package in the Renku monorepo that depends on three workspace packages: `@gorenku/core`, `@gorenku/compositions`, and `@gorenku/providers`.

It provides a single-page workspace for viewing blueprint graphs, managing builds, editing inputs/models/outputs, previewing generated movies, and executing generation plans.

## Entry Points

- **`main.tsx`**: Creates the React root. Wraps `<App />` in `<StrictMode>` and `<ThemeProvider>`.
- **`app.tsx`**: The main `App` component delegates to `BlueprintApp`, which reads URL parameters, fetches blueprint data, and renders `<WorkspaceLayout>` when ready (or a landing/loading/error page).

## Routing

There is **no router library** (no React Router, no TanStack Router). The app uses a single URL path (`/blueprints`) parameterized by query strings:

```
/blueprints?bp=<name>&in=<filename>&movie=<id>&build=<id>&last=1
```

The custom `useBlueprintRoute` hook manages this:
- Uses `useSyncExternalStore` to subscribe to `popstate` events
- Parses URL search params for current blueprint, build, and movie IDs
- Exposes `switchBlueprint()`, `clearLastFlag()`, `updateBlueprintRoute()` which manipulate `window.history.pushState` and dispatch synthetic `popstate` events

## API / Service Layer

The app uses the **native `fetch` API** directly -- no axios, React Query, or SWR.

### Client Modules

**`data/blueprint-client.ts`** -- All blueprint-related API calls:
- Blueprint resolution and fetching (graph, input template, models, config schemas)
- Build lifecycle (list, create, delete, enable editing)
- Build data (inputs, manifest, prompts)
- Artifact operations (edit, restore, recheck)
- File upload (via FormData)
- URL builders for assets

**`data/generation-client.ts`** -- Execution/generation:
- `createPlan()` / `executePlan()` -- POST requests
- `getJobStatus()` / `cancelJob()` -- Job management
- `subscribeToJobStream()` -- SSE (Server-Sent Events) via `EventSource` for real-time execution progress

All requests target `/viewer-api/*` endpoints.

### Server-Side API

The API is served by a custom Vite middleware defined in `server/viewer-api.ts`. It routes requests to handler modules in `server/blueprints/`, `server/builds/`, and `server/generation/`. The middleware is registered as a Vite plugin via `configureServer()` in `vite.config.ts`.

### SSE Real-Time Updates

During execution, the `ExecutionContext` subscribes to SSE events. Named events include: `status`, `plan-ready`, `layer-start`, `layer-skipped`, `layer-complete`, `job-start`, `job-progress`, `job-complete`, `execution-complete`, `execution-cancelled`, `error`. When artifacts are produced, a debounced callback triggers a manifest refetch.

## State Management

The app uses **no global state library** (no Redux, Zustand, Jotai). State is managed through React's built-in primitives: `useState`, `useReducer`, `useContext`, `useSyncExternalStore`, `useMemo`, and `useCallback`.

### Context Providers

**`ThemeContext`** (`contexts/theme-context.tsx`):
- Manages `theme` (light/dark), `setTheme`, `toggleTheme`
- Persists to `localStorage`, respects system `prefers-color-scheme`
- Wraps the entire app at root level
- Consumed via `useTheme()` hook

**`ExecutionContext`** (`contexts/execution-context.tsx`):
- The most complex state manager. Uses `useReducer` with 24 action types.
- Manages: execution status (`idle`/`planning`/`confirming`/`executing`/`completed`/`failed`/`cancelled`), layer range, plan info, current job, progress, producer statuses, execution logs, artifact selections for regeneration, pinned artifacts, dialog visibility
- Wraps `WorkspaceLayout` via `<ExecutionProvider>`
- Consumed via `useExecution()` hook
- Manages SSE subscription lifecycle (subscribe on execute, unsubscribe on cancel/complete)

### Prop Drilling Pattern

The primary data flow is **prop drilling from WorkspaceLayout downward**. `WorkspaceLayout` is the central orchestrator:
- Calls all data-fetching hooks
- Computes derived state
- Passes everything down as props to `DetailPanel`, `BuildsListSidebar`, `BottomTabbedPanel`
- `DetailPanel` receives 25+ props and forwards to child panels

This is a deliberate choice: hooks are composed at the orchestrator level, and computed values flow downward.

## Custom Hooks

All hooks are barrel-exported from `hooks/index.ts`.

### Data Fetching Hooks

| Hook | Location | Purpose |
|------|----------|---------|
| `useBlueprintData` | `services/` | Resolves blueprint name, fetches graph + input template in parallel |
| `useBuildsList` | `services/` | Fetches builds for a blueprint folder, returns `refetch()` |
| `useBuildManifest` | `services/` | Fetches manifest for a specific build |
| `useMovieTimeline` | `services/` | Fetches timeline data for a build |
| `useProducerModels` | `hooks/` | Fetches available models per producer |
| `useProducerConfigSchemas` | `hooks/` | Fetches JSON schemas for config properties |
| `useBuildInputs` | `hooks/` | Fetches and saves build inputs and model selections |
| `useProducerPrompts` | `hooks/` | Fetches and manages prompts per producer |

### UI State Hooks

| Hook | Location | Purpose |
|------|----------|---------|
| `useBlueprintRoute` | `hooks/` | Parses URL params, provides navigation helpers |
| `usePanelResizer` | `hooks/` | Mouse drag for vertical resizable panels |
| `useBottomPanelTabs` | `hooks/` | Tab state with auto-switch to execution tab during runs |
| `usePreviewPlayback` | `hooks/` | Video playback state (currentTime, isPlaying, seek, reset) |
| `useDarkMode` | `hooks/` | Detects `.dark` class via MutationObserver + useSyncExternalStore |
| `useAutoSave` | `hooks/` | Generic debounced auto-save with dirty tracking and save-on-unmount |
| `useModelSelectionEditor` | `hooks/` | Draft state + debounced auto-save for model selections |
| `useProducerConfigState` | `hooks/` | Pure computation -- derives config properties/values from schemas |

### Hook Design Principles

- **Data hooks live in `services/`** for data fetching that maps directly to API calls
- **Logic hooks live in `hooks/`** for business logic, derived state, and UI behavior
- **Hooks prefer returning objects** with named properties (not arrays)
- **Auto-save hooks** (`useAutoSave`, `useModelSelectionEditor`) handle: debounced saves, dirty tracking, save-on-unmount, scope reset on key changes, and error state

## Component Directory Structure

```
components/
  blueprint/                    -- Domain components (the core workspace)
    workspace-layout.tsx        -- Top-level orchestrator (wraps with ExecutionProvider)
    detail-panel.tsx            -- Tabbed right panel (Inputs/Models/Outputs/Preview)
    bottom-tabbed-panel.tsx     -- Bottom panel (Blueprint/Execution/Timeline)
    blueprint-viewer.tsx        -- ReactFlow graph visualization
    blueprint-legend.tsx        -- Legend overlay for blueprint flow
    inputs-panel.tsx            -- Inputs tab
    models-panel.tsx            -- Models tab (master-detail)
    outputs-panel.tsx           -- Outputs tab (master-detail)
    preview-panel.tsx           -- Preview tab with Remotion player
    builds-list-sidebar.tsx     -- Left sidebar with build list
    run-button.tsx              -- Execution trigger
    plan-dialog.tsx             -- Plan confirmation dialog
    completion-dialog.tsx       -- Post-execution completion dialog
    switch-blueprint-dialog.tsx -- Blueprint switching dialog
    producer-details-dialog.tsx -- Producer detail info dialog
    execution-progress-panel.tsx-- Terminal-like execution log
    timeline-panel.tsx          -- Timeline editor container

    edges/                      -- Custom ReactFlow edges
      conditional-edge.tsx

    inputs/                     -- Input panel sub-components
      default-text-editor.tsx
      dropzone-area.tsx
      empty-media-placeholder.tsx
      file-preview.tsx
      file-upload-dialog.tsx
      input-card-footer.tsx
      input-registry.ts         -- Maps input types to components

    models/                     -- Model panel sub-components
      config-editors/           -- Specialized config editors
        index.ts                -- CONFIG_EDITOR_REGISTRY
        schema-defaults.ts
        subtitles-card.tsx
        text-card.tsx
        timeline-card.tsx
      config-properties-editor.tsx
      config-property-row.tsx
      config-utils.ts
      model-selector.tsx
      nested-model-selector.tsx
      producer-section.tsx
      stt-helpers.ts

    nodes/                      -- Custom ReactFlow nodes
      input-node.tsx
      output-node.tsx
      producer-node.tsx

    outputs/                    -- Output panel sub-components
      edited-badge.tsx
      object-array-section.tsx
      property-strip.tsx
      skipped-badge.tsx

    shared/                     -- Shared primitives across all panels
      audio-card.tsx
      card-actions-footer.tsx
      collapsible-section.tsx
      enable-editing-banner.tsx
      image-card.tsx
      media-card.tsx            -- Base card wrapper
      media-expand-dialog.tsx
      media-grid.tsx            -- Responsive grid layout
      property-row.tsx          -- 2-column property display
      read-only-indicator.tsx
      syntax-preview.tsx
      text-card.tsx
      text-editor-dialog.tsx
      video-card.tsx

  player/                       -- Remotion video player
    remotion-preview.tsx

  timeline/                     -- Timeline editor
    timeline-editor.tsx
    timeline-content.tsx
    timeline-tracks.tsx
    timeline-slider.tsx
    track-headers.tsx

  ui/                           -- Shadcn UI primitives
    button.tsx
    card.tsx
    collapsible.tsx
    dialog.tsx
    dropdown-menu.tsx
    input.tsx
    popover.tsx
    select.tsx
    slider.tsx
    switch.tsx
    textarea.tsx
    theme-toggle.tsx
    tooltip.tsx
```

### Supporting Directories

```
hooks/          -- 12 custom hooks (UI state, business logic)
contexts/       -- 2 React contexts (Theme, Execution)
services/       -- 4 data-fetching hooks (blueprint, builds, manifest, timeline)
data/           -- 2 API client modules (blueprint, generation)
lib/            -- 8 pure utilities (cn, panel-utils, input-utils, artifact-utils,
                   blueprint-layout, etc.)
styles/         -- Theme CSS, Prism syntax themes
```

## Component Hierarchy

```
App
  ThemeProvider
    BlueprintApp
      WorkspaceLayout
        ExecutionProvider
          WorkspaceLayoutInner
            BuildsListSidebar
            DetailPanel
              InputsPanel
              ModelsPanel (master-detail)
                ProducerSection
                  ModelSelector
                  ConfigPropertiesEditor
                  Config editor cards (subtitles/timeline/text)
              OutputsPanel (master-detail)
                ObjectArraySection
                MediaCard variants (image/video/audio/text)
              PreviewPanel
                RemotionPreview
            [ResizeHandle]
            BottomTabbedPanel
              BlueprintViewer (ReactFlow)
                ProducerNode / InputNode / OutputNode
                ConditionalEdge
              ExecutionProgressPanel
              TimelinePanel
                TimelineEditor
          PlanDialog
          CompletionDialog
```

## Shadcn UI Integration

Shadcn UI components live in `components/ui/` and are backed by Radix UI primitives:

| Component | Base |
|-----------|------|
| `dialog.tsx` | `@radix-ui/react-dialog` |
| `dropdown-menu.tsx` | `@radix-ui/react-dropdown-menu` |
| `collapsible.tsx` | `@radix-ui/react-collapsible` |
| `popover.tsx` | `@radix-ui/react-popover` |
| `select.tsx` | `@radix-ui/react-select` |
| `slider.tsx` | `@radix-ui/react-slider` |
| `switch.tsx` | `@radix-ui/react-switch` |
| `tooltip.tsx` | `radix-ui` tooltip |
| `button.tsx` | `class-variance-authority` (cva) |
| `card.tsx` | Plain div wrappers |
| `input.tsx` | Native `<input>` with styling |
| `textarea.tsx` | Native `<textarea>` with styling |

### Shadcn Customizations

The Shadcn components are customized to match the app's design language:

- **Dialog**: Uses semantic tokens (`bg-panel-bg`, `border-panel-border`, `rounded-[var(--radius-panel)]`). Header has `bg-panel-header-bg`. Footer has `bg-dialog-footer-bg`. Title uses 11px uppercase tracking. Added `showCloseButton` prop.
- **Switch**: Added `size='sm'` variant. Thumb color is `bg-amber-50`.
- **Button**: Standard variants, used as-is.
- **Card**: Standard styling, but most cards in the app use the custom `MediaCard` instead.

All Shadcn components use `cn()` from `lib/utils.ts` (clsx + tailwind-merge) for class composition.

## Key Architectural Patterns

### Registry Pattern

The `CONFIG_EDITOR_REGISTRY` in `models/config-editors/index.ts` maps property keys to specialized editor components:

```typescript
export const CONFIG_EDITOR_REGISTRY = {
  subtitles: SubtitlesCard,
  timeline: TimelineCard,
  text: TextCard,
};
```

This controls which complex properties get specialized UI. `isComplexProperty()` + `hasRegisteredEditor()` determines visibility in the Models panel. New editors follow the `SubtitlesCard` pattern.

Similarly, `inputs/input-registry.ts` maps input types to their rendering components.

### Master-Detail View

Both Models and Outputs panels use sidebar-within-panel master-detail:
- Left aside (`w-72`): scrollable list of selectable items
- Right section (`flex-1`): detail view for selected item
- Selection state: supports both manual click and external selection (e.g., clicking a graph node)

### Auto-Save Infrastructure

`useAutoSave` provides generic debounced persistence:
- Saves on change (1s debounce), on unmount, and via explicit `forceSave()`
- Tracks `isDirty`, `isSaving`, `lastError`
- Resets scope when key dependencies change

`useModelSelectionEditor` builds on this for model selections with Map-based draft state merged onto saved state.

### Custom Tab Implementation

The app uses custom `TabButton` components (not Shadcn Tabs) in `DetailPanel` and `BottomTabbedPanel`. These support:
- Controlled and uncontrolled modes
- Active indicator (2px primary bottom bar)
- Execution status indicator (animated ping dot)

### Fragment Returns

`CardActionsFooter` and `ImageCard` return React Fragments (`<>`) instead of wrapper divs. This preserves parent flex/grid layouts (e.g., `justify-between` in MediaCard footer).

### Polymorphic ProducerSection

`ProducerSection` renders different UI based on producer `category`:
- **prompt**: ModelSelector + TextCard prompts
- **asset**: ConfigPropertiesEditor with model selection
- **composition**: ConfigPropertiesEditor for registered complex properties only

Supports `hideSectionContainer` to skip the `CollapsibleSection` wrapper in master-detail mode.

## Remotion Player Integration

`components/player/remotion-preview.tsx` integrates `@remotion/player`:
- Renders `DocumentaryComposition` from `@gorenku/compositions/browser`
- Builds asset URL map using `buildBlueprintAssetUrl()`
- Auto-detects video/image dimensions from assets
- Uses `ResizeObserver` + `fitWithinBounds()` for responsive scaling
- Bidirectional playback sync with parent state via `seekTo()`/`play()`/`pause()` and event listeners
- Generates poster frames from first visual asset
- Prefetches all asset URLs to reduce playback stalls
- Runs at 30 FPS with `controls={false}` (external controls from timeline panel)

## Blueprint Flow Visualization

`blueprint-viewer.tsx` uses `@xyflow/react` (ReactFlow):
- Three custom node types: `InputNode`, `ProducerNode`, `OutputNode`
- One custom edge type: `ConditionalEdge`
- Layout computed by `layoutBlueprintGraph()` from `lib/blueprint-layout.ts`
- Producer status badges (success/error/running/pending/skipped) on nodes
- Clicking a producer opens `ProducerDetailsDialog`
- Dark mode: adjusts background color via `useDarkMode()`
- ReactFlow dark mode CSS overrides in `index.css`

## Build System

`vite.config.ts` configuration:
- `babel-plugin-react-compiler` for automatic memoization (React Compiler)
- `@tailwindcss/vite` for Tailwind CSS v4
- Server API middleware registered during dev via `configureServer()`
- `@` alias maps to `./src`
- Build target: `esnext`

## Key Dependencies

| Dependency | Purpose |
|-----------|---------|
| `react@19` / `react-dom@19` | UI framework |
| `remotion@4` / `@remotion/player` | Video composition + playback |
| `@xyflow/react` | Blueprint flow graph |
| `tailwindcss@4` / `@tailwindcss/vite` | CSS framework |
| `class-variance-authority` / `clsx` / `tailwind-merge` | Shadcn styling utilities |
| `lucide-react` | Icon library |
| `@radix-ui/react-*` (6 packages) | Accessible UI primitives |
| `@uiw/react-color` | Color picker |
| `prism-react-editor` | Code/syntax editor |
| `react-dropzone` | File drag-and-drop |
| `busboy` | Server-side multipart form parsing |
| `vite@7` | Build tool and dev server |
| `vitest` / `@testing-library/react` | Testing |
| `tw-animate-css` | Tailwind animation utilities |
| `babel-plugin-react-compiler` | React Compiler for auto memoization |

## File Naming Conventions

- **kebab-case** for all filenames: `workspace-layout.tsx`, `use-auto-save.ts`
- **Hooks**: `use-<name>.ts` prefix
- **Tests**: `<name>.test.ts` or `<name>.test.tsx` suffix
- **Barrel exports**: `index.ts` in hook/component directories
- **CSS**: `styles/theme.css`, `styles/prism-renku-{dark|light}.css`
- **Config editors**: Named after the property they edit (e.g., `subtitles-card.tsx` for the `subtitles` property)

## Data Flow Summary

```
URL params (useBlueprintRoute)
  -> BlueprintApp fetches blueprint data + builds + manifest
    -> WorkspaceLayout receives all data as props
      -> WorkspaceLayout calls data hooks (models, schemas, inputs, prompts, timeline)
      -> WorkspaceLayout passes computed data down to panels via props
        -> DetailPanel (Inputs / Models / Outputs / Preview)
        -> BuildsListSidebar
        -> BottomTabbedPanel (Blueprint / Execution / Timeline)
          -> ExecutionContext manages real-time SSE updates during execution
```
