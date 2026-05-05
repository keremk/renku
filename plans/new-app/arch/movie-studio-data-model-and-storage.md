# Movie Studio Data Model And Storage Architecture

Date: 2026-05-05

Status: architecture decision draft

## Purpose

This document captures the current architecture direction for Movie Studio's data
model, storage boundaries, domain vocabulary, future series support, and first
domain areas: language/localization, budget/cost, visual language, and casting.

It should be treated as the current working decision for the new Movie Studio
implementation.

Earlier documents explored both file-first metadata and SQLite-as-cache designs.
Those explorations remain useful context, but this document records the updated
decision:

> SQLite is the source of truth for durable Movie Studio metadata and
> relationships.

The filesystem remains essential, but it owns content files and generated media,
not metadata relationships.

## Domain Vocabulary

Movie Studio needs one shared vocabulary across documentation, database schema,
core APIs, CLI commands, and UI copy.

The rule:

> Use the same domain word for the same concept everywhere.

There can still be implementation-specific file names such as `workflow.yaml`,
but those should not create competing product terms.

### Naming Rules

- Use **Generation Recipe** for the editable generation setup users and agents
  work with.
- Use **Catalog Recipe Template** for reusable system-provided starting points.
- Use **Recipe Workflow File** when referring specifically to the executable
  `workflow.yaml` file inside a recipe.
- Avoid using "workflow", "blueprint", "preset", "style", "lineage", or
  "provenance" as casual synonyms for core Movie Studio concepts.
- UI labels may be adapted later for a production template, but the model,
  commands, documentation, and core APIs should keep the canonical domain term.
- File and folder names are user-facing labels. They are not IDs and must never
  be parsed to recover relationships.

### Production Structure

| Canonical term | Use for | Notes |
| --- | --- | --- |
| Project | The top-level local Movie Studio project folder and its project-local database. | Code and UI should generally say "project". |
| Production workspace | An architectural description of what a project database represents. | Useful when explaining that one project can contain a standalone movie or a future series. It does not need to be a separate user-facing object in v1. |
| Standalone movie | A project shape with one movie-like production unit. | This can be the only project type implemented in the first slice. |
| Series | A project shape with multiple episodes sharing cast, visual language, and reusable assets. | A future feature, but the schema should not block it. |
| Episode | A movie-like production unit inside a series project. | Episodes can have their own sequences, scenes, clips, exports, tasks, and takes while sharing project-level cast and visual language. |

### Narrative Structure

Movie Studio should use this canonical hierarchy for v1:

```text
Standalone movie project
  -> Sequence
    -> Scene
      -> Clip

Series project
  -> Episode
    -> Sequence
      -> Scene
        -> Clip
```

`Sequence` is a valid film and screenwriting term. It usually means a meaningful
group of scenes that form a larger dramatic or production beat.

Related terms should be scoped carefully:

- **Act** is a higher-level story structure. It can be added later if Movie
  Studio needs screenplay-style act planning, but it should not replace
  `sequence` in the v1 hierarchy.
- **Chapter** is a friendly presentation label for some formats, especially
  documentaries, courses, serialized web videos, or exports. It can be a display
  label later, but it should not be the canonical schema term.
- **Shot** is usually a lower-level camera/editing unit inside a scene. Since
  the current UI and generation model are organized around clips, `clip` should
  stay the v1 production unit. A future shot model can be introduced below clips
  if needed.

### Creative Direction

| Canonical term | Use for | Avoid |
| --- | --- | --- |
| Visual Language | The top-level creative direction system for AI generation. | Do not use "style" as the top-level domain name. |
| Visual Language Profile | A reusable package of visual guidance, references, constraints, and notes. | Do not call this a style profile in schema, code, or docs. |
| Visual Language Asset | A registered asset attached to a visual language profile. | The asset type can still be `style_sheet`, `look_reference`, etc. |
| Style Sheet | A visual language asset type, usually an image or board that demonstrates a desired look. | This is an asset type, not the name of the whole creative-direction system. |

### Language And Localization

Language support is a core Movie Studio value proposition, not an export-only
feature.

Product copy can usually say **Language** because it is friendly. The stored
technical value should be a **locale tag**, preferably a BCP 47 tag such as
`en-US`, `tr-TR`, `es-MX`, or `pt-BR`.

| Canonical term | Use for | Notes |
| --- | --- | --- |
| Language | The user-facing language target. | Example: Turkish, Mexican Spanish, Brazilian Portuguese. |
| Locale Tag | The precise stored language/region/script identifier. | Use BCP 47-style values. Do not parse meaning from display names. |
| Base Language | The primary language for the movie or episode. | Used for original narration, dialog, voice design, and first-pass subtitles. It must be explicit. |
| Supported Language | A language the project or episode is configured to produce. | Supporting a language does not mean every localization level is enabled. |
| Localization Level | The production depth for a supported language. | Initial levels: `standard_subtitles`, `dubbed_audio`, `localized_lipsync`. |
| Localized Version | A deliverable version of a movie, episode, clip, audio track, or subtitle track for one supported language and localization level. | Example: Turkish subtitle-only export, Spanish dubbed export, Japanese lip-sync export. |
| Subtitle Track | A first-class timed text asset. | Cue-level timing, may be in a different language than the audio. |
| Karaoke Caption Track | A word-synced subtitle/caption track where text appears or highlights word by word. | Requires audio language and subtitle language to match. Requires word-level timing. |
| Timed Transcript | A transcript of an audio asset with timestamps. | Segment-level timing can support standard subtitles. Word-level timing is required for karaoke captions. |
| Dubbed Audio Track | A localized narration or dialog audio asset. | Same visual clip, different language audio. |
| Lip-Sync Take | A localized video take where mouth movement matches the target-language audio. | Expensive level; usually clip-specific. |
| Voice Variant | A cast voice profile or sample for a specific supported language. | Lets a cast member keep the same voice identity across languages when the provider supports it. |

The important distinction:

- **Standard subtitles** are translated timed text. They can be in a different
  language from the audio, and cue timing can be approximate.
- **Karaoke caption tracks** are audio-synchronized text. The text language must
  match the audio language, and word-level timing is required.

### Casting

| Canonical term | Use for | Notes |
| --- | --- | --- |
| Cast | The workspace section and collection of reusable production subjects. | This stays broad enough for characters, narrators, locations, objects, groups, or recurring emblems. |
| Cast Member | One reusable production subject. | Use `cast_member` in schema names. |
| Cast Asset | A registered asset associated with a cast member. | Examples: portrait, character sheet, costume reference, voice sample, research note. |
| Reference Set | A named set of cast assets intended to be used together. | Example: "Mehmed II / Campaign armor" containing portrait, character sheet, and costume references. |
| Pin | A cast-level curated favorite or useful asset. | Pins help the cast UI. They are not the same as clip usage. |
| Binding | An explicit relationship between two domain objects. | Example: a clip binds to a cast member through a reference set. |

Use **selection** only for ephemeral UI state or for a deliberately modeled
active choice. Do not use "selected asset" when the durable meaning is really a
pin or a clip-specific binding.

### Assets And Files

| Canonical term | Use for | Notes |
| --- | --- | --- |
| Asset | A registered content item in Movie Studio metadata. | SQLite owns its identity, type, owner, status, and relationships. |
| Asset File | A concrete file on disk that belongs to an asset. | One asset can have one file or several files. |
| Compound Asset | An asset that needs a folder because several files belong together. | Example: a video take folder with `video.mp4`, `thumbnail.png`, and captions. |
| Take | A generated candidate output. | Cast takes can initially just be cast assets. Clip video generation may later use a richer `clip_take` model. |

### Generation

| Canonical term | Use for | Notes |
| --- | --- | --- |
| Generation Type | A category of generation work, such as `cast.character-sheet` or `clip.video-take`. | This usually appears as a stable recipe key. |
| Generation Recipe | The editable setup for one generation type. | Contains prompt files, system prompt files, model config, notes, and a recipe workflow file. |
| Recipe Key | The stable key identifying a generation type. | Example: `cast.character-sheet`. |
| Recipe Override | A scoped replacement for a project-level recipe. | Example: Mehmed II can override `cast.character-sheet`. |
| Recipe File | Any source file inside a recipe folder. | Examples: `prompt.md`, `system-prompt.md`, `model.yaml`, `notes.md`. |
| Recipe Workflow File | The executable step definition inside a recipe, usually `workflow.yaml`. | This is where the lower-level generation steps live. |
| Catalog Recipe Template | A reusable system-provided recipe starter. | Agents can instantiate one into a project recipe folder. |
| Task | A queued or running unit of work. | Example: generate a character sheet for one cast member. |
| Generation Record | A lightweight durable record that connects a generated output to the task and recipe binding that produced it. | It is not a full historical copy of recipe files. |
| Generation Packet | A system-generated execution snapshot of resolved inputs for one task. | Useful for debugging and execution repeatability, but not the user-facing recipe history model. |
| Provider Run | A lower-level record of a call to an external or local generation provider. | Useful for diagnostics, cost, retries, and error reporting. |

### Budget And Cost

Movie Studio should make generation cost visible before and after work runs.

| Canonical term | Use for | Notes |
| --- | --- | --- |
| Budget | A user-defined planned spending limit for a scope. | Example scopes: project, episode, sequence, clip, cast member, supported language, localization level, generation recipe. |
| Cost Estimate | The predicted cost before a generation task runs. | This is not the same as actual cost. It can be a range when provider pricing is approximate. |
| Actual Cost | The provider-reported final cost after work runs. | If the provider does not report actual cost, do not silently substitute the estimate. |
| Accrued Cost | The sum of actual cost events for a scope. | Used by UI projections such as "spent so far". |
| Pending Estimated Cost | The sum of estimates for queued/running work that has not produced actual cost yet. | Helps users understand likely near-term spend. |
| Cost Event | A durable record of an actual charge, refund, adjustment, or unknown final cost. | The event log is the source for accrued cost rollups. |
| Cost Rollup | A query/projection that summarizes cost estimates and cost events by scope. | Useful for UI, but should be recomputable from estimate and event records. |
| Cost Approval | A user or agent decision allowing a task to run when it has a non-trivial estimated cost. | Especially important for expensive localization levels such as lip-sync. |

Recommended money storage:

- store currency explicitly, such as `USD`;
- store amounts as integer micros or another fixed-precision integer unit;
- do not store money as floating point values;
- keep estimates and actual costs as separate records.

### Catalog And Models

| Canonical term | Use for | Notes |
| --- | --- | --- |
| Catalog | System-level definitions bundled with Renku or Movie Studio. | Includes providers, models, model schemas, and catalog recipe templates. |
| Provider | A service or runtime that supplies a model. | Example: OpenAI, Replicate, ElevenLabs, local runtime. |
| Model | A provider-specific generation model. | Provider/model selection belongs in recipe files, not as canonical SQLite-authored text. |
| Model Schema | A JSON Schema describing valid parameters for a provider model. | Lives in the catalog. Project recipe files choose concrete values. |

### Terms To Avoid Or Scope Carefully

| Term | Recommendation |
| --- | --- |
| Workflow | Do not use as the user-facing name for generation setup. Use Generation Recipe. Use Recipe Workflow File only for `workflow.yaml` or the lower-level step graph inside a recipe. Generic phrases like "Git workflow" are fine when not naming a Movie Studio domain object. |
| Blueprint | Avoid for Movie Studio product vocabulary. It can remain a legacy/current Renku or Viewer term where that system already uses it, but Movie Studio should say Catalog Recipe Template or Generation Recipe. |
| Preset | Avoid because it is vague. Use Generation Recipe, Recipe Override, or Catalog Recipe Template. |
| Style | Avoid as the top-level domain concept. Use Visual Language. `style_sheet` is acceptable as a visual language asset type. |
| Selection | Avoid for durable relationships unless the model truly represents an active selected value. Use Pin for cast favorites and Binding for scoped usage. |
| Lineage / Provenance | Avoid for the v1 data model. Use Generation Record for the lightweight output/task/recipe link and Generation Packet for the resolved execution snapshot. |
| Act / Chapter | Do not use as canonical v1 schema terms. Use Sequence for the movie hierarchy, with future display labels if needed. |

## 1. General Architecture

Movie Studio should be built around a shared movie domain core.

The product has several interfaces:

- the Movie Studio UI;
- the local Movie Studio server used by the UI;
- the Movie CLI used by humans and agents;
- future autonomous agent loops;
- background generation workers.

Those interfaces should not each implement their own model logic.

The architectural center should be:

```text
movie-core/
  owns domain model
  owns SQLite schemas
  owns migrations
  owns validation
  owns mutation commands
  owns projections for UI and CLI
  owns filesystem path allocation for project assets
```

Then:

```text
movie-studio UI
  calls local server APIs
  renders projections
  sends user actions

movie-studio server
  thin HTTP/SSE wrapper
  opens project database
  calls movie-core commands
  streams projection changes

movie-cli
  thin command wrapper
  opens project database
  calls movie-core commands
  returns machine-readable output for agents

agents
  inspect project files when useful
  call renku movie CLI commands for metadata mutations
```

The practical rule:

> UI actions and CLI actions must go through the same `movie-core` command
> handlers.

For example, if the UI can bind a clip to a cast reference set, the CLI should
expose the same operation. Both should call the same core mutation.

This is important because Movie Studio is expected to collaborate with coding
agents. Agents should not need a running UI server, and the UI server should not
be the only place where business rules exist.

## Core Design Principles

- Keep all durable metadata in one source of truth.
- Use SQLite for metadata, relationships, pins, bindings, task state, and
  generation records.
- Store content files and generated media on the filesystem.
- Store agent-editable production source files on the filesystem, including
  prompts, system prompts, model configs, and recipe workflow YAML.
- Do not store metadata in Markdown frontmatter or sidecar YAML files.
- Do not ask agents to hand-edit system-owned state.
- Mutate metadata only through Renku commands or Renku services.
- Keep `movie-cli` and `movie-studio/server` thin.
- Keep domain logic in `movie-core`.
- Use explicit IDs and declared relationships.
- Do not infer relationships from names, slugs, paths, or partial matches.
- Treat IDs as opaque values.

## Why SQLite Is The Source Of Truth

The earlier file-first metadata direction was attractive because files are easy
to inspect and friendly to Git.

However, for Movie Studio, the project metadata will include many relationships
that must stay consistent:

- movie structure;
- cast members;
- scene and clip relationships;
- generated assets;
- generated takes;
- pinned references and explicit usage bindings;
- per-clip cast/reference usage;
- generation tasks;
- provider run records;
- generation records;
- queue state;
- validation diagnostics;
- approval and rejection state;
- stale-state calculations.

If this metadata is spread across Markdown frontmatter, sidecar YAML files, and
folder conventions, agents can accidentally create inconsistent state.

For example, an agent might update a character sheet binding in one file but
forget to update:

- the clip reference binding;
- the generated take record;
- the stale-state marker;
- the queue event that explains the mutation;
- the UI projection record;
- the validation diagnostic that should now disappear.

SQLite gives us:

- transactional updates;
- one canonical metadata graph;
- deterministic command handlers;
- strong validation before mutation;
- fast queries for UI projections;
- a natural home for Drizzle schema definitions;
- clear boundaries for agent interaction.

The command boundary matters most:

```bash
renku movie cast asset import ...
renku movie cast reference-set create ...
renku movie clip cast bind ...
renku movie task queue ...
renku movie take approve ...
```

Agents can call those commands instead of editing metadata files directly.

This keeps the system deterministic and prevents silent state drift.

## What This Gives Up

SQLite as source of truth is a good fit, but it has real costs.

The biggest tradeoffs are:

- SQLite is a binary file, so Git diffs are not naturally reviewable.
- Git merges can conflict at the database-file level.
- Git branch usage needs more discipline than plain text files.
- Schema migrations need care and backup behavior.
- SQLite journal files need clear rules.
- External manual database edits can break invariants unless discouraged.

These are acceptable tradeoffs if we design around them.

Recommended mitigations:

- Provide CLI inspection commands for agents and humans.
- Provide machine-readable JSON output from CLI commands.
- Provide optional diagnostic/export commands for review, such as
  `renku movie dump --format json`.
- Treat those dumps as generated review artifacts, not the source of truth.
- Use migrations owned by `movie-core`.
- Back up the database before destructive migrations.
- Keep all writes inside explicit transactions.
- Keep generated SQLite journal files out of Git.
- Checkpoint or close the database cleanly before asking the user to commit.
- Avoid long-running write transactions.
- Use command-level validation before every mutation.

This means we are choosing determinism and command-owned consistency over
hand-editable metadata.

That is the right tradeoff for an agent-assisted production tool.

## 2. Layers Of Responsibility

### `movie-core`

`movie-core` owns the Movie Studio domain.

It should contain:

- Drizzle schema definitions;
- SQLite migrations;
- repository/query helpers;
- domain command handlers;
- validation rules;
- projection builders;
- queue and task state logic;
- generation record logic;
- filesystem path allocation for assets;
- import/export helpers;
- shared DTOs for UI and CLI.

`movie-core` should be the only package that knows how to apply a metadata
mutation correctly.

Examples:

- add a cast member;
- rename a cast member;
- import a cast portrait;
- generate a character sheet take;
- create a named cast reference set;
- bind a clip to a specific cast reference set;
- queue a generation task;
- mark a task completed;
- register generated media files;
- compute whether a clip is stale.

### Browser-Safe Core Contracts

The browser should be able to import shared types without pulling in Node-only
dependencies such as `better-sqlite3`.

The core package should eventually expose separate entry points:

```text
@gorenku/movie-core
  browser-safe contracts, DTOs, constants, pure validation helpers

@gorenku/movie-core/node
  filesystem access, SQLite driver setup, Drizzle database, migrations,
  command handlers that touch disk
```

This keeps the frontend clean while still allowing type sharing.

The separate entry points solve an import-graph problem.

They do not mean `movie-core` should become an application package.

The root entry point should stay browser-safe. The Node entry point may expose
programmatic project operations. Neither entry point should own terminal
argument parsing, command help text, process exit behavior, or CLI-specific
formatting.

### `movie-studio/server`

The server is an adapter.

It should:

- open the selected project;
- call `movie-core/node`;
- expose HTTP endpoints;
- stream events or projection updates to the UI;
- translate errors into API responses;
- avoid duplicating business rules.

The server should not own:

- schema definitions;
- project mutation logic;
- validation rules;
- cast pinning or clip binding behavior;
- queue transition rules.

### `movie-studio/src`

The frontend is a projection consumer.

It should:

- fetch project projections;
- render workspace state;
- send user actions to the server;
- subscribe to updates;
- keep only local ephemeral UI state in React.

The UI should not:

- write SQLite directly;
- infer relationships from folder paths;
- encode domain mutation rules;
- own long-running task state.

### `movie-cli`

`movie-cli` should remain a separate package.

Technically, the CLI could be placed inside `movie-core` behind another export
path and package `bin` entry. That is not the recommended design.

The better split is:

```text
movie-core
  reusable domain library
  schemas
  migrations
  validation
  command handlers
  projections
  Node-side storage implementation

movie-cli
  binary package
  argument parsing
  command help text
  terminal output
  JSON output formatting
  process exit codes
```

The CLI should be very thin, but it should still be its own package.

Reasons:

- `movie-core` remains a reusable library instead of becoming a product binary.
- CLI dependencies do not become part of the core package's public personality.
- Terminal UX can evolve without churning the domain package.
- CLI packaging, versioning, and binary naming stay explicit.
- Tests can clearly separate domain behavior from command-line behavior.
- The server and CLI can depend on the same core API without one depending on the
  other.

The key rule:

> CLI behavior is separate. CLI business logic is not.

For example:

```text
movie-cli parses:
  renku movie cast add --name "Mehmed II"

movie-cli calls movie-core:
  createCastMember(project, input)

movie-core validates and mutates:
  cast_member rows
  folder allocation
  projection events
```

If the UI can perform a mutation, the CLI should be able to perform the same
mutation through the same core command handler.

### Movie Studio Distribution

Movie Studio should support two distribution methods.

Both methods should use the same underlying built app:

- a Vite browser UI build;
- a local Node server build;
- `movie-core` domain/storage code;
- provider/runtime dependencies needed by generation;
- native SQLite support for the Node side.

The `movie-studio` package should remain the product/application package. It
should produce:

```text
movie-studio/
  dist/
    browser UI build

  server-dist/
    local server build
```

Those build outputs can then be embedded into different outer distributions.

At runtime:

```text
browser UI
  imports browser-safe contracts from @gorenku/movie-core
  calls the local Movie Studio server

local server
  imports @gorenku/movie-core/node
  opens the project SQLite database
  calls core command handlers and projections
```

The browser build must never import:

- `@gorenku/movie-core/node`;
- `better-sqlite3`;
- Drizzle's `better-sqlite3` driver;
- Node filesystem modules.

The server build may import all of those.

#### Distribution Method 1: CLI-Launched Movie Studio

The first distribution method is the same style as the current Viewer app:

```text
npm package
  installs a Renku CLI
  includes embedded Movie Studio UI/server assets
  user runs:
    renku movie-studio launch
```

This mode is browser-based, not Electron-based.

The CLI command should:

1. Locate the embedded Movie Studio bundle.
2. Start the local Movie Studio server.
3. Pass the server the selected project path, config paths, and runtime options.
4. Open the user's browser to the local server URL.
5. Store enough process state to support shutdown/relaunch.

The embedded bundle should include:

- the browser UI build;
- the local server build;
- `@gorenku/movie-core` compiled output;
- Node-side runtime dependencies used by the server;
- the native `better-sqlite3` binding for the target platform;
- any provider/runtime packages needed for generation.

Conceptually:

```text
movie-cli/
  dist/
    cli.js

  movie-studio-bundle/
    dist/
      index.html
      assets/

    server-dist/
      bin.js
      movie-studio-api.js
      ...
```

The exact folder name can differ, but the pattern should mirror the current
Viewer packaging approach:

```text
build movie-studio
copy movie-studio/dist into the CLI package bundle
copy movie-studio/server-dist into the CLI package bundle
publish the CLI package with those assets included
```

This mode is important because:

- it works naturally from npm;
- it is friendly for agents and terminal use;
- it does not require a desktop app install;
- it keeps the CLI as the command surface for metadata mutations;
- it matches the current Viewer launch model.

Whether the command lives under the existing umbrella `renku` binary or the
new `movie-cli` package's binary is a packaging decision.

The product-level command can still be:

```bash
renku movie-studio launch
```

The important architecture rule is that this command launches bundled
Movie Studio assets and calls `movie-core` through the local server and CLI
surfaces.

#### Distribution Method 2: Electron Desktop App

The second distribution method is an Electron app, like the current `desktop`
package.

The desktop app should bundle:

- the Movie Studio browser UI build;
- the Movie Studio local server build;
- `movie-core` and Node-side dependencies;
- native `better-sqlite3` support for Electron's target platform;
- the Renku CLI or Movie CLI binary for agent and terminal use;
- provider/runtime resources needed for generation.

At runtime, Electron can:

1. Start the local Movie Studio server from bundled resources.
2. Open the Movie Studio UI in an Electron window.
3. Manage app lifecycle, updates, and OS integration.
4. Install or expose a CLI wrapper for agent use.

Conceptually:

```text
desktop/
  resources/
    movie-studio-dist/
      index.html
      assets/

    movie-studio-server/
      runtime.mjs or server entry

    cli/
      renku or renku-movie entrypoint
```

The Electron app is a richer packaged product.

The CLI-launched app is the lightweight npm distribution.

They should not fork the Movie Studio implementation.

Both should consume the same `movie-studio` build outputs and the same
`movie-core` APIs.

#### Distribution Responsibility Split

```text
movie-studio
  owns the app UI and local server source
  produces dist/ and server-dist/

movie-core
  owns domain logic, SQLite schema, migrations, command handlers

movie-cli or umbrella renku CLI
  owns terminal commands
  may embed movie-studio build assets for npm launch
  starts/stops the local Movie Studio server

desktop
  owns Electron packaging
  embeds movie-studio build assets
  embeds and installs/exposes CLI support for agents
```

The exact packaging scripts can follow the Viewer pattern, with added native
SQLite requirements.

Important packaging rules:

- Native SQLite dependencies must be included only in the Node/server side of the
  app distribution, never in the Vite browser bundle.
- The npm CLI distribution must include or install a `better-sqlite3` build that
  works in the user's Node runtime.
- The Electron distribution must include a native `better-sqlite3` build that
  works in Electron's runtime for each packaged platform.
- The Electron distribution must also distribute and install or expose a CLI
  command, because agent skills need a command-line surface even when the user
  installed Renku as a desktop app.
- The browser UI should keep importing only browser-safe contracts from
  `@gorenku/movie-core`.
- The local server and CLI may import `@gorenku/movie-core/node`.
- Both distribution methods should run the same validation and migration code
  before opening a project.

### Agents

Agents may inspect project folders and artifact files.

Agents may directly edit content files when the user asks them to edit content,
for example:

- a research note;
- a narration draft;
- a prompt note;
- a subtitle file;
- a timed transcript file;
- a localization glossary;
- a freeform Markdown brief;
- an image or audio file produced outside Renku.

Agents must call Renku commands when they need to mutate metadata.

Examples:

- registering a new file as an asset;
- changing which cast assets a clip uses;
- approving a take;
- adding a cast member;
- changing a cast member's role;
- adding or enabling a supported language;
- registering a subtitle track or timed transcript;
- setting a budget;
- approving an estimated cost;
- queueing a generation task.

If an agent creates a new file directly, that file is not project metadata until
it is registered through a Renku command.

## 3. Top-Level Data Approach

## Storage Stack Decision

Movie Studio should use:

- SQLite for project metadata storage;
- `better-sqlite3` as the Node.js SQLite driver;
- Drizzle as the typed schema, query, and migration layer.

The `better-sqlite3` dependency should stay on the Node-side entry point of
`movie-core`. It should not leak into browser imports.

Drizzle schemas should live in `movie-core` so the CLI, server, tests, and future
workers all use the same table definitions and migrations.

## Project-Level SQLite

The canonical project metadata database should be per project.

Recommended path:

```text
movie-project/
  .renku/
    movie.sqlite
```

This database owns durable metadata for that movie project.

It should include:

- project identity;
- movie metadata;
- series and episode metadata, when the project is a series;
- supported language records;
- localization level records;
- subtitle track and timed transcript records;
- visual language records;
- sequence, scene, and clip records;
- cast records;
- asset records;
- asset file records;
- relationship records;
- pin and reference binding records;
- generation task records;
- provider run records;
- generation records;
- budget records;
- cost estimate and cost event records;
- validation records;
- migration records.

This makes each project portable as a folder.

It also makes it possible to version the metadata database together with the
project assets in Git, if we choose that versioning path.

## Standalone Movies And Series

The data model should not assume that every project is only one standalone
movie.

Movie Studio should support two project shapes:

```text
standalone_movie
  one project
  one movie
  shared cast, languages, visual language, budgets, and assets belong to that movie

series
  one project
  many episodes
  each episode is produced like a movie
  cast, languages, visual language, locations, budgets, and shared assets can be reused across episodes
```

For a series, the recommended source of truth is still one project-local
database:

```text
series-project/
  .renku/
    movie.sqlite
```

The series database should own:

- series identity;
- supported language configuration;
- shared cast;
- shared visual language assets;
- shared locations, objects, and reusable production references;
- shared budget/cost policy;
- episode records;
- per-episode sequence, scene, clip, task, take, and generation records.

This avoids splitting one creative world across several metadata databases.

If each episode had its own independent SQLite database plus another shared
series database, we would immediately have cross-database relationship and
transaction problems:

- Which database owns a shared character?
- Which database owns a visual language asset used in five episodes?
- How do we atomically update a shared cast reference and an episode clip
  binding?
- What happens when an agent updates an episode but not the shared database?

For that reason, the better long-term shape is:

> A project database represents a production workspace.
>
> A production workspace may contain one standalone movie or a series with many
> episodes.

In this model, an "episode" is a movie-like production unit inside the same
project database.

The first implementation can still create only standalone movie projects.

But the schema should leave room for:

```text
project
  id
  project_type
  title

episode
  id
  project_id
  episode_number
  title
  status
```

For standalone movies, there may be one implicit or explicit episode/movie unit.
The important point is that cast, supported language, visual language, budget,
and cost records should be scoped to the project or a reusable production
library, not hard-coded as children of a single movie file.

## Global Studio Database

Movie Studio may also have an app-local database outside the project.

That database can store:

- recently opened project paths;
- window state;
- app preferences;
- local thumbnail caches;
- machine-specific UI state;
- credentials references or provider environment hints, if needed.

It must not store project-owned metadata.

If the global app database is deleted, the project should still open from its
own folder and `.renku/movie.sqlite`.

The global database is a convenience index, not the project source of truth.

## Runtime State

There are two reasonable options for runtime state:

1. Store runtime tables in `.renku/movie.sqlite`.
2. Store local runtime tables in a second project-local database, such as
   `.renku/runtime.sqlite`.

The initial recommendation is:

```text
movie-project/
  .renku/
    movie.sqlite       durable project metadata
    runtime.sqlite     local in-flight runtime state, if separation is needed
    tmp/               temporary generation outputs
```

The distinction:

- `movie.sqlite` owns durable movie metadata and relationships.
- `runtime.sqlite` can own machine-local execution machinery.

Examples of runtime machinery:

- process leases;
- currently active worker ownership;
- temporary provider polling cursors;
- local retry locks;
- temporary output paths;
- UI focus state.

Completed task history, completed artifact metadata, pins, reference bindings,
and generation records should be durable project metadata and belong in
`movie.sqlite`.

Short-lived process state can live in `runtime.sqlite` if keeping it in the
canonical database would make Git versioning noisy or unsafe.

This preserves the main rule:

> Durable project metadata has one source of truth: `.renku/movie.sqlite`.

## Filesystem Content Model

The filesystem owns content and media.

Examples:

- authored Markdown notes;
- research notes;
- narration drafts;
- dialog drafts;
- localization glossaries;
- pronunciation notes;
- image files;
- video files;
- audio files;
- music files;
- subtitle files;
- timed transcript and word-timing files;
- generated thumbnails;
- prompt templates;
- system prompts;
- generated prompt drafts;
- model configuration YAML files;
- recipe workflow YAML files;
- exported movie files.

The filesystem does not own metadata relationships.

No required metadata should live in:

- Markdown frontmatter;
- sidecar YAML;
- file names;
- folder names;
- inferred path conventions.

The database records what each file means.

For example, this file:

```text
Cast/001-mehmed-ii/Character Sheets/002-armor-campaign-sheet.png
```

is just a file on disk.

The database records:

- its asset ID;
- which cast member owns it;
- that it is a character sheet;
- its title;
- its file path;
- its media type;
- its generation task, if generated;
- the generation record that created it, if generated;
- which clips use it.
- which supported language it belongs to, if localized.

The file and folder names help the user browse.

The file and folder names are not the relationship.

## User-Friendly Folder Structure

The project folder should be understandable in Finder, Explorer, a terminal, or
an editor.

Generated and authored assets should live near the thing they belong to.

Recommended shape:

```text
constantinople-movie/
  .renku/
    movie.sqlite
    runtime.sqlite
    tmp/

  Narrative/
    narrative.md
    research-notes.md

  Languages/
    en-US/
      language-notes.md
      pronunciation.md
    tr-TR/
      glossary.md
      pronunciation.md
      Recipe Overrides/
        localization.standard-subtitles/
          workflow.yaml
          system-prompt.md
          prompt.md
          model.yaml

  Visual Language/
    001-ottoman-court-miniature/
      Style Sheets/
        001-painted-miniature-reference.png
        002-muted-court-lighting.png
    Look Notes/
      overall-visual-direction.md
      camera-and-lighting-language.md

  Generation Recipes/
    cast.character-sheet/
      workflow.yaml
      system-prompt.md
      prompt.md
      model.yaml
      notes.md
    cast.portrait/
      workflow.yaml
      system-prompt.md
      prompt.md
      model.yaml
    clip.video-take/
      workflow.yaml
      system-prompt.md
      prompt.md
      model.yaml
    localization.standard-subtitles/
      workflow.yaml
      system-prompt.md
      prompt.md
      model.yaml
    localization.dubbed-audio/
      workflow.yaml
      system-prompt.md
      prompt.md
      model.yaml
    localization.lipsync-clip/
      workflow.yaml
      system-prompt.md
      prompt.md
      model.yaml
    visual-language.style-sheet/
      workflow.yaml
      system-prompt.md
      prompt.md
      model.yaml

  Cast/
    001-mehmed-ii/
      Notes/
        character-brief.md
      Recipe Overrides/
        cast.character-sheet/
          workflow.yaml
          system-prompt.md
          prompt.md
          model.yaml
      Portraits/
        001-young-sultan-portrait.png
        002-stern-campaign-portrait.png
      Character Sheets/
        001-court-kaftan-sheet.png
        002-armor-campaign-sheet.png
      Voices/
        001-controlled-formal-voice/
          sample.wav
          transcript.md

    002-constantine-xi/
      Notes/
      Portraits/
      Character Sheets/
      Voices/

  Sequences/
    01-logistics/
      sequence-notes.md

      Scenes/
        01-foundry-at-night/
          scene-notes.md

          Clips/
            001-cannon-inspection/
              clip-brief.md
              Recipe Overrides/
                clip.video-take/
                  workflow.yaml
                  system-prompt.md
                  prompt.md
                  model.yaml

              References/
                001-foundry-lighting-reference.png

              Takes/
                001-wide-sparks-take/
                  video.mp4
                  thumbnail.png

              Narration/
                001-draft-narration/
                  narration.md
                  narration.wav

              Localization/
                tr-TR/
                  Subtitles/
                    001-standard-subtitles.vtt
                  Audio/
                    001-dubbed-dialog.wav
                  Karaoke/
                    001-word-timing.json
                  Takes/
                    001-lipsync-take/
                      video.mp4
                      thumbnail.png

  Shared/
    Music/
    Sound Effects/

  Exports/
    review-cuts/
      Localization/
        tr-TR/
          Subtitles/
            constantinople-review.tr-TR.vtt
    final/
```

A future series project can use the same principle, with shared assets at the
top level and episode-specific production folders below `Episodes/`:

```text
constantinople-series/
  .renku/
    movie.sqlite

  Visual Language/
  Languages/
  Generation Recipes/
  Cast/
  Shared/

  Episodes/
    01-the-cannon-founder/
      Narrative/
      Sequences/
      Exports/

    02-the-walls/
      Narrative/
      Sequences/
      Exports/
```

This folder structure is for humans.

Simple single-file assets should usually be stored as flat files inside their
category folder.

Examples:

```text
Generation Recipes/cast.character-sheet/workflow.yaml
Generation Recipes/cast.character-sheet/prompt.md
Generation Recipes/cast.character-sheet/model.yaml
Generation Recipes/localization.standard-subtitles/workflow.yaml
Cast/001-mehmed-ii/Recipe Overrides/cast.character-sheet/prompt.md
Visual Language/001-ottoman-court-miniature/Style Sheets/001-painted-miniature-reference.png
Cast/001-mehmed-ii/Portraits/001-young-sultan-portrait.png
Cast/001-mehmed-ii/Character Sheets/002-armor-campaign-sheet.png
Sequences/01-logistics/.../References/001-foundry-lighting-reference.png
Sequences/01-logistics/.../Localization/tr-TR/Subtitles/001-standard-subtitles.vtt
```

Per-asset folders are not mandatory.

Use a per-asset folder only when the asset is a compound bundle that benefits
from keeping several files together.

Examples:

- a video take with `video.mp4`, `thumbnail.png`, and captions;
- a voice asset with `sample.wav`, `transcript.md`, and analysis files;
- a localized lip-sync take with video, thumbnail, audio, and timing files;
- an image asset with source layers, masks, or multiple variants;
- a reference board with several images that should act as one registered asset.

Important rules:

- Folder names should be readable.
- File and folder names should be unique within their parent folder.
- File and folder names may include a short ordinal or slug for clarity.
- The database stores the actual identity and relationships.
- The system must not infer IDs or relationships from folder names.
- Renames should go through Renku commands so the database path stays correct.
- If a user externally renames a file or folder, validation should report the missing
  path explicitly.

This lets users browse the project naturally without making the folder tree the
metadata source of truth.

## Agent-Editable Generation Recipes

Prompts, system prompts, model configuration, and recipe workflow YAML files are
production source files.

They should live on the filesystem and be directly editable by agents.

They should be grouped by **generation type**, not by individual generated take.

Examples of generation types:

```text
cast.character-sheet
cast.portrait
cast.voice
clip.video-take
clip.reference-image
localization.standard-subtitles
localization.timed-transcript
localization.karaoke-captions
localization.dubbed-audio
localization.lipsync-clip
visual-language.style-sheet
```

Each generation recipe folder can contain:

```text
workflow.yaml
system-prompt.md
prompt.md
negative-prompt.md
model.yaml
notes.md
```

The recipe owns the technical setup for that generation type:

- recipe workflow steps;
- prompt and system prompt files;
- provider/model selection;
- model-specific parameters;
- reusable notes for agents and users.

Provider and model selection belong in the recipe files, usually in
`workflow.yaml` or `model.yaml`.

SQLite should not store provider/model choices as the authored source of truth.

SQLite may cache extracted provider/model values for fast UI filtering or queue
resource scheduling, but that cache must be treated as derived data.

The default project recipes should live under:

```text
Generation Recipes/
  cast.character-sheet/
  cast.portrait/
  clip.video-take/
  localization.standard-subtitles/
  localization.dubbed-audio/
  localization.lipsync-clip/
  visual-language.style-sheet/
```

Project sections normally use those defaults.

Specific scopes may override a recipe for the same generation type:

```text
Cast/001-mehmed-ii/Recipe Overrides/cast.character-sheet/
Sequences/01-logistics/Scenes/01-foundry-at-night/Clips/001-cannon-inspection/Recipe Overrides/clip.video-take/
Sequences/01-logistics/Scenes/01-foundry-at-night/Clips/001-cannon-inspection/Recipe Overrides/localization.lipsync-clip/
```

The override is still for the generation type.

It is not for a single take.

This means a user can say:

```text
Use the default character sheet recipe for most cast members.
For Mehmed II, use this adjusted character sheet prompt.
For this one clip, use Nano Banana instead of GPT Image.
For Turkish lip-sync, use a more expensive provider only for this close-up.
```

SQLite should store registrations and scope bindings:

```text
generation_recipe
  id
  project_id
  recipe_key
  folder_path
  catalog_recipe_template_ref
  status
  created_at
  updated_at

generation_recipe_file
  id
  generation_recipe_id
  kind
  path
  content_hash
  validation_status
  created_at
  updated_at

generation_recipe_binding
  id
  recipe_key
  generation_recipe_id
  target_type
  target_id
  priority
  created_at
  updated_at
```

For a default project recipe, `target_type` can be `project`.

For an override, `target_type` can be:

```text
episode
sequence
scene
clip
cast_member
visual_language_profile
```

When resolving a recipe, Movie Studio should use explicit bindings.

It should not infer overrides from folder names.

No per-take recipe version tree should be created in v1.

Generated takes remember which recipe key and resolved recipe binding were used,
but they do not own immutable copies of the prompt, recipe workflow, or model
files.

## Catalog-Level Recipe Templates

The catalog remains the right place for system-level reusable definitions.

Existing model and provider definitions live under the catalog, for example:

```text
catalog/
  models/
    openai/
    fal-ai/
    replicate/
    elevenlabs/
```

Those catalog model definitions include provider/model metadata and JSON Schema
files for model inputs and outputs.

Movie Studio should reuse that pattern.

Reusable Movie Studio catalog recipe templates can also live at the catalog
level, separate from per-project recipe edits:

```text
catalog/
  movie-studio/
    recipe-templates/
      cast.character-sheet/
        workflow.yaml
        README.md
      clip.video-take/
        workflow.yaml
        README.md
      localization.standard-subtitles/
        workflow.yaml
        README.md
      localization.dubbed-audio/
        workflow.yaml
        README.md
      localization.lipsync-clip/
        workflow.yaml
        README.md
      visual-language.style-sheet/
        workflow.yaml
        README.md
```

Catalog recipe templates are reusable starting points.

Project generation recipes are the editable instance used by a concrete movie,
series, supported language, visual language profile, cast member, sequence,
scene, or clip.

An agent can start from a catalog recipe template by copying or instantiating it
into a project recipe bundle.

Once copied into the project, the recipe bundle is normal project source and can
be edited directly by agents.

The catalog remains the system-level source for:

- provider definitions;
- model metadata;
- JSON Schema files;
- reusable catalog recipe templates;
- reusable producer/runtime definitions, where applicable.

The project database should not copy catalog JSON Schema bodies into SQLite.

It should reference catalog provider, model, and recipe template identifiers and
record the resolved catalog version or content hash used for
validation/execution.

## Prompt, Config, Context, And Recipe Boundary

There is a gray line between prompts and context.

The recommended boundary is:

- a generation recipe owns the editable recipe workflow, prompt, system prompt,
  and model config files for one generation type;
- context comes from explicit inputs, such as cast records, supported language
  records, visual language bindings, clip summaries, reference assets, narration
  notes, subtitle tracks, timed transcripts, and user-authored briefs;
- generated prompts are outputs of a recipe workflow step and can be saved as
  files if the user or an agent wants to edit/reuse them later;
- catalog model schemas describe what provider/model parameters are valid;
- project recipe `model.yaml` files choose values for those parameters.

For example, the default project character-sheet recipe may live here:

```text
Generation Recipes/cast.character-sheet/
  workflow.yaml
  system-prompt.md
  prompt.md
  model.yaml
  notes.md
```

Mehmed II may override it here:

```text
Cast/001-mehmed-ii/Recipe Overrides/cast.character-sheet/
  workflow.yaml
  system-prompt.md
  prompt.md
  model.yaml
```

The resolved recipe may use context from:

- the cast member record in SQLite;
- the supported language record, if the recipe is language-specific;
- visual language profiles explicitly bound to the cast member;
- cast reference assets;
- user-authored notes under the cast folder;
- subtitle tracks or timed transcripts if the recipe declares those inputs;
- optional sequence or clip context if the recipe declares those inputs.

The recipe workflow file should declare required inputs explicitly.

If required context is missing, validation must fail.

No source file, context value, model config, or prompt should be silently
substituted.

## Recipe Workflow File References

Inside a generation recipe folder, the recipe workflow file can reference
sibling files by explicit relative path.

Example:

```yaml
kind: renku.recipeWorkflow
version: 0.1.0

id: character_sheet_from_cast_context
name: Character sheet from cast context

files:
  systemPrompt: ./system-prompt.md
  prompt: ./prompt.md
  modelConfig: ./model.yaml

steps:
  generateCharacterSheet:
    kind: image
    model:
      provider: openai
      id: gpt-image-2

inputs:
  castMember:
    type: castMember
    required: true

  visualLanguageProfiles:
    type: visualLanguageProfile[]
    required: true
```

Those paths are explicit authored recipe workflow configuration.

They are not inferred relationships.

When the recipe is validated, `movie-core` should resolve those paths, validate
the selected provider/model against catalog definitions, validate `model.yaml`
against the selected catalog model schema, compute content hashes, and update
SQLite registration/link rows.

If a referenced file is missing, validation should fail.

## Generation Records

A generation record is a lightweight operational record.

It records that a task generated an output using a resolved recipe binding.

It does not preserve an immutable copy of every prompt, recipe workflow, and
model configuration file used for that take.

This is intentional for v1.

The user mental model should stay simple:

```text
Edit the current recipe for this generation type.
Generate another take.
Pick the takes you like.
```

Do not make users reason about per-take recipe version trees.

Recommended shape:

```text
generation_record
  id
  output_asset_id
  generation_task_id
  recipe_key
  generation_recipe_id
  target_type
  target_id
  supported_language_id
  localization_level
  generation_packet_path
  status
  created_at
```

The generation record can answer:

```text
Which recipe type generated this take?
Which scoped recipe binding was used?
Which task created it?
Which provider request failed or succeeded?
What output asset was produced?
Which supported language and localization level did it target, if any?
```

It should not promise exact historical reconstruction of the recipe workflow
files after those files have changed.

If exact history is needed later, Git can provide that in a future feature.

## Generation Packets

Before execution, `movie-core` should compile a generation packet.

A generation packet is a system-generated snapshot of the exact resolved inputs
for one task.

It may include:

- resolved prompt text;
- resolved system prompt text;
- resolved model config;
- selected provider/model;
- supported language and localization level, if applicable;
- catalog model schema reference and schema hash;
- resolved context values;
- resolved budget approval or cost estimate reference;
- resolved asset file paths and hashes;
- resolved recipe folder path.

Generation packets should be stored as files, not as large SQLite text blobs.

Recommended location:

```text
.renku/generation-packets/
  task-2026-05-04-001-character-sheet.generation-packet.yaml
```

Generation packets are system-owned generated files.

Agents should edit generation recipes, not completed generation packets.

In v1, generation packets are primarily execution/debug artifacts.

They are not the product's long-term recipe history mechanism.

SQLite can link tasks and generated assets to generation packet paths for
debugging, but Renku should not require users or agents to navigate generation
packet history during normal creative work.

## File Path Allocation

`movie-core` should own path allocation for registered assets.

When creating a new asset, core should:

1. Determine the asset owner.
2. Determine the asset category.
3. Decide whether the asset should be a flat file or a compound folder.
4. Generate a readable unique file or folder name.
5. Create or reserve the target path.
6. Register the file path or paths in SQLite.

Example file names:

```text
001-court-kaftan-sheet.png
002-armor-campaign-sheet.png
003-night-court-closeup.png
```

These names are allowed to be human-readable.

They must not become IDs.

The database should store opaque IDs separately from paths.

The default should be the simplest browsable path that works.

For single-file assets, that means a flat file.

For compound assets, that means a readable folder containing the related files.

## File And Database Consistency

SQLite and the filesystem cannot be updated with one true atomic transaction.

Movie Studio should handle this with explicit materialization states.

Recommended generated-asset flow:

```text
estimate cost when the task uses a paid provider
record cost estimate and required approval state
create task record in SQLite
write generated output to .renku/tmp/task-id
validate generated files
allocate final user-friendly asset path
move/copy files into the final flat file or compound folder
insert or update durable asset metadata in SQLite transaction
record provider run and actual cost event, if available
mark task completed
emit projection update
```

If a crash leaves unregistered files on disk, those files are orphans.

Because SQLite is the source of truth, orphan files should not silently become
project assets. A repair/import command may offer to register or remove them.

If SQLite points to a missing file, validation should fail with a clear error.

No fallback should silently substitute another file.

If the provider does not return final cost, the task should record that actual
cost is unknown. The estimate should not be silently treated as actual spend.

## Git Versioning Decision

Per-project SQLite can be stored with the project and versioned together with
assets.

This is desirable because:

- the project remains portable;
- the metadata travels with the assets;
- a checked-out project can be opened without a central service;
- the CLI can operate directly in the project folder.

But there are important Git implications:

- SQLite diffs are binary.
- Concurrent branch edits can produce merge conflicts.
- Review needs CLI-generated summaries or dumps.
- WAL and SHM files should not be committed.

Recommended rules:

- Commit `.renku/movie.sqlite` when using Git versioning for a project.
- Do not commit `.renku/*.sqlite-wal`.
- Do not commit `.renku/*.sqlite-shm`.
- Avoid committing `.renku/runtime.sqlite` unless we later decide it contains
  durable project history.
- Add CLI review commands before relying on database diffs.
- Prefer command-generated summaries in pull requests.

Example review commands:

```bash
renku movie status
renku movie validate
renku movie diff --from main
renku movie dump --format json
```

The exact commands can be designed later.

The key point is that human review should happen through purpose-built views,
not raw binary diffs.

## Future Git-Backed Generation History

Git should not be required for v1 generation history.

However, Git can become the future mechanism for reconstructing the exact recipe
used for a generated take.

The future flow could be:

```text
validate project
create generation task
optionally create a structured Git commit/checkpoint
run generation
write output asset
record generation_record.git_commit_sha
```

A structured commit message could include fields such as:

```text
renku-generation-id: gen_abc123
renku-output-id: asset_xyz789
renku-recipe-key: cast.character-sheet
renku-scope: cast:cast_mehmed_ii
renku-language: tr-TR
renku-localization-level: localized_lipsync
```

Then a future UI could answer:

```text
What exact recipe workflow, prompt, and model config created this take?
What language/localization target was it produced for?
```

by reading the recipe files from the recorded commit.

This avoids inventing a custom per-take recipe version tree.

It also keeps the v1 model simple:

- takes remember the recipe key and resolved recipe binding;
- takes do not preserve immutable recipe snapshots;
- exact historical reconstruction is a future Git-backed feature, not a v1
  requirement.

## 4. Data Model Discussions

This section will grow as Movie Studio adds more domain areas.

The first top-level domain areas are language/localization, budget/cost, visual
language, and casting.

Language and budget should be first-class because they affect nearly every
generation decision. Visual language should also be modeled before casting
because it can inform cast design, sequence design, and clip generation.

Conceptually:

```text
Language
  -> Cast voice
  -> Narration and dialog
  -> Subtitles, dubbed audio, and localized clip takes

Budget
  -> Generation task approval
  -> Take count and localization level decisions
  -> Accrued project cost

Visual Language
  -> Cast design
  -> Sequence and clip generation
```

## Language And Localization

Movie Studio should make language variation a central production path.

The user should be able to decide which languages a movie supports and how deep
the localization should go for each language.

The rough cost ladder is:

```text
standard_subtitles
  cheapest
  translated timed text only
  can be in a different language than the audio

dubbed_audio
  mid-level
  translated narration or dialog audio
  same video, localized audio

localized_lipsync
  expensive
  localized audio plus video take where mouth motion matches that language
```

Supporting a language should not imply that every level is enabled.

For example:

```text
English
  base language
  standard subtitles
  karaoke captions
  dubbed audio
  localized lip-sync

Turkish
  supported language
  standard subtitles
  dubbed audio

Japanese
  supported language
  standard subtitles only
```

### Supported Languages

The project should have explicit supported language records.

For a standalone movie, those records apply to the movie.

For a series, the project can define shared supported languages, while episodes
can enable or disable language support as needed.

Recommended initial shape:

```text
supported_language
  id
  project_id
  locale_tag
  display_name
  is_base_language
  status
  created_at
  updated_at

episode_supported_language
  id
  episode_id
  supported_language_id
  status
  created_at
  updated_at

supported_language_capability
  id
  supported_language_id
  target_type
  target_id
  localization_level
  status
  budget_id
  created_at
  updated_at
```

Possible `localization_level` values:

```text
standard_subtitles
dubbed_audio
localized_lipsync
karaoke_captions
```

Notes:

- `locale_tag` is the durable locale identifier.
- `display_name` is human-facing text.
- `is_base_language` must be explicit.
- each standalone movie or episode should have exactly one base language for
  voice and audio generation once language-aware generation is enabled;
- `target_type` allows future scoping to project, episode, sequence, scene, or
  clip if a language level is only enabled for part of the production.
- `budget_id` lets the user put a budget around a language or localization
  level.
- The system should not infer supported languages from folders or export files.

## Subtitle Tracks

Subtitles should be first-class domain objects.

The filesystem owns the actual subtitle file, such as `.vtt`, `.srt`, or a
structured JSON timing file.

SQLite owns the subtitle track metadata and relationships.

Recommended initial shape:

```text
subtitle_track
  id
  project_id
  supported_language_id
  target_type
  target_id
  mode
  timing_granularity
  audio_language_id
  asset_id
  timed_transcript_id
  status
  created_at
  updated_at
```

Possible `mode` values:

```text
standard
karaoke
```

Possible `timing_granularity` values:

```text
cue
word
```

Possible `target_type` values:

```text
project
episode
sequence
scene
clip
export
```

Standard subtitle tracks:

- can be translated into a language different from the audio language;
- can use approximate cue-level timing;
- can be authored, imported, generated, edited, and approved like other assets.

Karaoke caption tracks:

- require subtitle language and audio language to match;
- require word-level timing;
- should be generated from a timed transcript or provider output with word
  timestamps;
- should fail validation if word timings are missing.

No generation should silently downgrade a requested karaoke caption track into a
standard subtitle track.

## Timed Transcripts

A timed transcript describes an audio asset with timestamps.

Recommended initial shape:

```text
timed_transcript
  id
  project_id
  audio_asset_id
  supported_language_id
  timing_granularity
  asset_id
  status
  created_at
  updated_at
```

The transcript body should live on the filesystem.

Examples:

```text
Localization/en-US/Karaoke/001-word-timing.json
Localization/en-US/Subtitles/001-dialog-transcript.vtt
```

SQLite should record which audio asset the timed transcript describes.

If karaoke captions require word timing and the linked transcript only has
cue-level timing, validation should fail.

## Localized Audio And Lip-Sync Takes

Localized audio should be represented as registered assets linked to a supported
language.

Recommended shape:

```text
localized_audio_track
  id
  project_id
  supported_language_id
  target_type
  target_id
  asset_id
  source_audio_asset_id
  cast_member_id
  status
  created_at
  updated_at
```

For narration, `cast_member_id` may point to the narrator.

For dialog, `cast_member_id` may point to the speaking cast member.

Localized lip-sync should be represented as a generated take for a clip and
language.

Recommended shape:

```text
localized_clip_take
  id
  clip_id
  supported_language_id
  localized_audio_track_id
  video_asset_id
  generation_task_id
  generation_record_id
  status
  created_at
  updated_at
```

This makes the cost/quality ladder explicit:

- a clip can have a base video take;
- a supported language can have a subtitle track only;
- a supported language can add a dubbed audio track;
- a supported language can add a localized lip-sync take.

## Cast Voice And Language

Cast voice design should be language-aware.

A cast member can have:

- a base voice profile in the base language;
- voice variants for supported languages;
- provider-specific voice identity references, when supported;
- localized voice samples or generated dialog/narration examples.

Recommended shape:

```text
cast_voice_profile
  id
  cast_member_id
  base_supported_language_id
  asset_id
  provider_voice_ref
  status
  created_at
  updated_at

cast_voice_variant
  id
  cast_voice_profile_id
  supported_language_id
  asset_id
  provider_voice_ref
  generation_task_id
  status
  created_at
  updated_at
```

The user goal is:

```text
Keep the same character voice identity.
Render that voice in English, Turkish, Spanish, Japanese, etc.
```

The implementation should still be provider-aware because not every provider can
preserve voice identity across languages.

If a recipe requires a voice variant for a target language and none exists,
validation should fail with a clear error.

## Language-Aware Generation Recipes

Localization should use the same generation recipe model as the rest of Movie
Studio.

Project-level defaults can define:

```text
Generation Recipes/localization.standard-subtitles/
Generation Recipes/localization.timed-transcript/
Generation Recipes/localization.karaoke-captions/
Generation Recipes/localization.dubbed-audio/
Generation Recipes/localization.lipsync-clip/
```

Specific scopes may override them:

```text
Languages/tr-TR/Recipe Overrides/localization.standard-subtitles/
Sequences/01-logistics/Scenes/01-foundry-at-night/Clips/001-cannon-inspection/Recipe Overrides/localization.lipsync-clip/
```

Language-aware recipes should declare required inputs explicitly.

Examples:

- source subtitle language;
- target supported language;
- source audio track;
- target voice variant;
- timed transcript;
- clip video take;
- budget approval or cost estimate.

No recipe should infer target language from folder names.

## Initial Language Commands

Illustrative CLI shape:

```bash
renku movie language list
renku movie language add --locale tr-TR --name "Turkish"
renku movie language set-base en-US
renku movie language enable-level tr-TR --level standard-subtitles
renku movie language enable-level tr-TR --level dubbed-audio
renku movie subtitle import --language tr-TR --target clip:<clip-id> --file subtitles.vtt
renku movie subtitle generate --language tr-TR --target episode:<episode-id> --mode standard
renku movie subtitle generate --language en-US --target clip:<clip-id> --mode karaoke
renku movie audio dub --language tr-TR --target clip:<clip-id>
renku movie clip lipsync --language tr-TR <clip-id>
```

These are examples, not final command syntax.

The important rule is that every language/localization mutation maps to a
`movie-core` mutation.

## Budget And Cost

Movie Studio should make spending visible and controllable.

This matters especially for localization because the cost can multiply by:

- number of supported languages;
- number of generated takes;
- selected localization level;
- provider/model choice;
- clip duration;
- audio duration;
- video resolution and duration.

The UI should be able to show:

- budget for the current project or scope;
- actual accrued cost so far;
- pending estimated cost for queued/running work;
- estimated cost before a user queues a task;
- final provider-reported cost after the task completes.

## Budgets

A budget is user-authored project metadata.

Recommended shape:

```text
budget
  id
  project_id
  scope_type
  scope_id
  supported_language_id
  localization_level
  currency
  amount_micros
  status
  created_at
  updated_at
```

Possible `scope_type` values:

```text
project
episode
sequence
scene
clip
cast_member
generation_recipe
supported_language
localization_level
```

Notes:

- `supported_language_id` can be null for a general budget.
- `localization_level` can be null for a general budget.
- Use integer micros or another fixed-precision integer unit for money.
- Budgets should be mutated through commands or UI actions, not by editing
  files.

## Cost Estimates And Cost Events

Pre-generation estimates and post-generation actual costs are different facts.

They should not overwrite each other.

Recommended shape:

```text
cost_estimate
  id
  project_id
  generation_task_id
  recipe_key
  provider
  model
  supported_language_id
  localization_level
  currency
  estimated_min_micros
  estimated_max_micros
  pricing_source
  status
  created_at

cost_event
  id
  project_id
  generation_task_id
  provider_run_id
  cost_estimate_id
  kind
  currency
  amount_micros
  provider_cost_ref
  usage_units_json
  created_at
```

Possible `cost_event.kind` values:

```text
actual
refund
adjustment
unknown_actual
```

Rules:

- If a provider gives a pre-run estimate, store it as a `cost_estimate`.
- If a provider gives a final cost, store it as an `actual` cost event.
- If a provider does not return final cost, record `unknown_actual`; do not copy
  the estimate into actual cost.
- `amount_micros` should be null for `unknown_actual`, not zero, because zero
  would mean the task was free.
- `provider` and `model` in cost records are resolved execution facts, not the
  authored source of truth for recipe configuration.
- Accrued cost should sum actual/refund/adjustment events, not estimates.
- Pending estimated cost should sum estimates for queued/running tasks that do
  not have actual cost yet.
- Cost rollups should be projections that can be recomputed from cost events.

## Cost-Aware Task Flow

Before queueing paid generation, `movie-core` should:

1. Resolve the generation recipe.
2. Resolve supported language and localization level, if any.
3. Validate required inputs.
4. Estimate cost from provider/model pricing when available.
5. Compare the estimate with the relevant budget scopes.
6. Require approval if the task exceeds policy or needs explicit cost approval.
7. Create the generation task, cost estimate, and generation packet.

After execution, `movie-core` should:

1. Record provider run details.
2. Record actual provider-reported cost when available.
3. Record `unknown_actual` when actual cost is unavailable.
4. Update cost rollup projections.
5. Emit projection updates for UI and CLI.

The system should not silently run expensive tasks without a clear cost estimate
or approval policy.

If a provider cannot estimate cost before execution, that should be explicit in
the task state and approval flow.

## Initial Budget Commands

Illustrative CLI shape:

```bash
renku movie budget list
renku movie budget set --scope project --amount 500 --currency USD
renku movie budget set --language tr-TR --level dubbed-audio --amount 100 --currency USD
renku movie cost estimate --recipe localization.lipsync-clip --target clip:<clip-id> --language tr-TR
renku movie cost status
renku movie cost events --target project:<project-id>
```

These are examples, not final command syntax.

The important rule is that cost and budget state belongs in SQLite and is
mutated through `movie-core`.

## Visual Language

Movie Studio needs a top-level place for artistic direction.

The recommended product language is **Visual Language**.

It is broader and more film-native than "design guidelines", and it is less
narrow than "style" as a visual filter.

Related movie-industry concepts include:

- creative direction;
- art direction;
- visual development;
- look development;
- style bible or look bible.

Recommended product language:

> Visual Language
>
> Contains reusable visual language profiles, style sheets, look references, and
> prompt guidance for AI generation.

For AI-generated movies, visual language is production guidance that can include:

- reference images;
- style sheets;
- color and lighting direction;
- camera language;
- costume and material language;
- environment look;
- prompt descriptions;
- negative style constraints;
- model-specific guidance;
- notes about what must remain consistent across generations.

## Visual Language Profiles

A visual language profile is a reusable creative direction package.

Examples:

- Ottoman court miniature influence;
- muted siege documentary realism;
- anime episode house style;
- night foundry lighting;
- battlefield armor and smoke treatment;
- diplomatic chamber look;
- series-wide character rendering style.

Initial metadata:

```text
visual_language_profile
  id
  project_id
  name
  description
  intent
  status
  default_folder_path
  created_at
  updated_at
```

Notes:

- `id` is opaque.
- `name` is display text.
- `intent` is the human-readable creative direction summary.
- `default_folder_path` points to the user-friendly visual language folder or
  category.
- The folder path is not identity.

Possible `status` values:

```text
draft
approved
archived
```

## Visual Language Assets

A visual language asset is a registered piece of content attached to a visual
language profile.

Examples:

- style sheet image;
- color palette image;
- lighting reference;
- camera language note;
- costume/material reference;
- prompt description;
- negative prompt note;
- model-specific prompt guide;
- reference board.

Initial metadata:

```text
visual_language_asset
  id
  visual_language_profile_id
  asset_type
  title
  status
  origin
  generation_task_id
  created_at
  updated_at
```

Possible `asset_type` values:

```text
style_sheet
look_reference
color_palette
lighting_reference
camera_language
costume_material_reference
prompt_description
negative_prompt
reference_board
model_guidance
other
```

Visual language assets should use the same asset-file principles as cast assets:

- single-file images should usually be flat files;
- prompt descriptions, negative prompts, and model guidance should be Markdown
  or YAML files, not SQLite text fields;
- compound reference boards or bundles may use folders;
- SQLite owns the metadata;
- the filesystem owns the content files.

## Visual Language Scope And Bindings

Visual language should be top-level, but it must be usable at different scopes.

The first important scopes are:

- project or series;
- episode;
- sequence;
- scene;
- clip;
- cast member.

This lets a user express:

- a series-wide anime look;
- an episode-specific palette;
- a sequence-specific lighting language;
- a cast-specific rendering language;
- a clip-specific reference override.

Recommended binding model:

```text
visual_language_binding
  id
  visual_language_profile_id
  target_type
  target_id
  purpose
  sort_order
  created_at
  updated_at
```

Possible `target_type` values:

```text
project
episode
sequence
scene
clip
cast_member
```

Possible `purpose` values:

```text
overall_look
character_design
environment_design
costume_design
lighting
camera_language
clip_generation
reference_only
```

The key point:

> Visual language relationships are explicit database rows.

The system should not infer visual language from folder names, sequence titles,
cast names, or nearby files.

## Visual Language Resolution For Generation

When Movie Studio compiles inputs for generation, it should gather visual
language profiles through explicit bindings.

For example, a clip generation packet may include:

- project or series visual language bindings;
- episode visual language bindings, for a series;
- sequence visual language bindings;
- scene visual language bindings, if any;
- clip-specific visual language bindings;
- cast-member visual language bindings for the cast members used in the clip.

This supports the hierarchy:

```text
Visual Language
  -> Cast
  -> Clips within the movie or episode hierarchy
```

It also supports:

```text
Visual Language
  -> Sequence
  -> Scenes
  -> Clips
```

There should be no silent fallback when a recipe workflow requires visual
language guidance.

If a recipe workflow requires a visual language profile for character design or
clip generation and none is explicitly bound at the required scope, validation
should fail with a clear error.

If a recipe workflow allows visual language to be optional, that optional
behavior should be part of the recipe contract, not an accidental default.

## Visual Language And Cast

Cast design should be able to use visual language profiles.

Example:

```text
Cast member: Mehmed II
Visual language profile: Ottoman court miniature influence
Purpose: character_design
```

This means generated portraits, costume references, and character sheets can all
consume the same visual language guidance.

The visual language profile is not copied into the cast member.

The cast member has an explicit visual language binding.

## Visual Language And Sequences

Sequences should also be able to use visual language profiles.

Example:

```text
Sequence: Edirne foundry preparations
Visual language profile: night foundry lighting
Purpose: lighting
```

This lets the user define a visual language for a sequence without editing every
clip individually.

Clip generation can then include the sequence visual language binding when
compiling the generation packet.

## Series Visual Language

For a series, visual language profiles become even more important.

The project may have:

- series-wide visual language profiles;
- episode-specific visual language profiles;
- recurring cast visual language profiles;
- sequence-specific visual language profiles inside each episode.

Example:

```text
Series visual language: house anime look
Episode visual language: winter festival palette
Cast visual language: protagonist school uniform design
Sequence visual language: night market lighting
Clip visual language: close-up emotional intensity
```

These can all coexist as explicit bindings.

The UI can present them as layered visual language, but the database should store
them as concrete relationships.

## Initial Visual Language Commands

Illustrative CLI shape:

```bash
renku movie visual-language list
renku movie visual-language add --name "Ottoman court miniature influence"
renku movie visual-language asset import <profile-id> --type style-sheet --file style-sheet.png
renku movie visual-language bind <profile-id> --target cast:<cast-id> --purpose character-design
renku movie visual-language bind <profile-id> --target sequence:<sequence-id> --purpose lighting
renku movie visual-language bindings --target clip:<clip-id>
```

These are examples, not final command syntax.

The important rule is that every visual language mutation maps to a `movie-core`
mutation.

## Casting Goals

The casting section must support:

- cast members such as characters, narrators, locations, objects, or recurring
  visual subjects;
- many generated takes per cast member;
- many asset categories per cast member;
- user-authored notes and generated media;
- multiple useful character sheets or portraits for one cast member;
- different clips using different references for the same cast member;
- visual language bindings that influence cast generation without being copied
  into the cast record;
- base voice language and localized voice variants for narration/dialog;
- CLI and UI mutations using the same core commands;
- no direct metadata editing by agents.

The UI currently has mock concepts for:

- description;
- character sheets;
- voice design;
- selected assets, which should become pins or explicit bindings depending on
  what the user is choosing;
- generated takes.

The real model should preserve that flexibility without assuming one global
active portrait, one global active character sheet, or one global active voice.

## Cast Member

A cast member is a reusable production subject.

Examples:

- Mehmed II;
- Constantine XI;
- the narrator;
- the Theodosian Walls;
- Urban the cannon founder;
- a recurring cannon;
- a recurring map or emblem.

Initial metadata:

```text
cast_member
  id
  project_id
  name
  kind
  role
  short_description
  base_voice_supported_language_id
  default_folder_path
  created_at
  updated_at
```

Notes:

- `id` is opaque.
- `name` is display text.
- `base_voice_supported_language_id` should be explicit when the cast member has
  a voice profile.
- `default_folder_path` points to the user-friendly cast folder.
- The folder path is not identity.
- Relationships to clips or assets must be explicit database rows.

Possible `kind` values:

```text
character
narrator
location
object
group
other
```

These values should stay product-facing and plain.

## Cast Assets

A cast asset is a registered piece of content associated with a cast member.

Examples:

- description text;
- portrait image;
- costume reference;
- character sheet;
- full-body image;
- voice sample;
- voice profile;
- localized voice sample;
- pronunciation note;
- reference board;
- research note.

Initial metadata:

```text
cast_asset
  id
  cast_member_id
  asset_type
  title
  status
  origin
  generation_task_id
  created_at
  updated_at
```

Possible `asset_type` values:

```text
description
portrait
costume_reference
character_sheet
full_body_reference
voice_sample
voice_profile
localized_voice_sample
pronunciation_note
reference_board
research_note
other
```

Possible `origin` values:

```text
user_imported
agent_authored
generated
derived
```

Possible `status` values:

```text
candidate
approved
archived
failed
```

These values should not imply that only one asset can be pinned or used.

Approval means the asset is acceptable for use.

Usage is modeled separately.

## Asset Files

An asset may contain one or more files.

For example, a simple character sheet asset may be one file:

```text
Cast/001-mehmed-ii/Character Sheets/002-armor-campaign-sheet.png
```

A compound asset may include several files:

- `video.mp4` or `sample.wav`;
- `thumbnail.png`;
- `prompt.md`;
- `notes.md`.
- `subtitles.vtt`;
- `word-timing.json`.

Initial metadata:

```text
asset_file
  id
  asset_id
  role
  path
  media_type
  mime_type
  size_bytes
  content_hash
  width
  height
  duration_seconds
  created_at
```

Possible `role` values:

```text
primary
thumbnail
source
prompt
notes
transcript
subtitle
timing
audio
video
image
other
```

The file content lives on disk.

The metadata describing what the file means lives in SQLite.

## Takes

The UI language currently uses "takes" for generated options.

There are two possible modeling choices:

1. Treat every generated option as an asset.
2. Add a separate `take` table and link takes to assets.

Recommended initial direction:

> Treat generated cast takes as cast assets.

Reason:

- a generated portrait take is still a portrait asset;
- a generated character sheet take is still a character sheet asset;
- an imported reference and a generated reference need similar UI treatment;
- pinning and usage binding should work the same way regardless of origin.

If clip motion generation later needs richer take semantics, we can introduce a
specific `clip_take` model for video takes without complicating cast assets.

## Multiple Pins And Clip-Specific Usage

There should not be a single global active character sheet for a cast member.

A user may want:

- one Mehmed II sheet in a court kaftan;
- one Mehmed II sheet in campaign armor;
- one close-up portrait for diplomatic scenes;
- one harsher battlefield portrait for siege scenes;
- one voice sample for narration;
- another voice sample for younger dialog.

Different clips may use different references.

Therefore, the data model needs a layer between "asset exists" and "clip uses
asset."

Recommended concepts:

```text
cast_reference_set
  id
  cast_member_id
  name
  description
  created_at
  updated_at

cast_reference_set_item
  id
  reference_set_id
  asset_id
  usage_role
  sort_order

clip_cast_binding
  id
  clip_id
  cast_member_id
  reference_set_id
  created_at
  updated_at
```

Example reference sets:

```text
Mehmed II / Court kaftan
  portrait: young-sultan-portrait
  character_sheet: court-kaftan-sheet
  costume_reference: court-fabric-reference

Mehmed II / Campaign armor
  portrait: stern-campaign-portrait
  character_sheet: armor-campaign-sheet
  costume_reference: armor-detail-reference
```

Then a clip can explicitly bind:

```text
clip: cannon-inspection
cast: Mehmed II
reference set: Campaign armor
```

Another clip can bind:

```text
clip: court-planning
cast: Mehmed II
reference set: Court kaftan
```

This gives flexibility without ambiguity.

No generation should infer which character sheet to use from the cast member
alone unless the user has explicitly configured a default policy.

If a recipe workflow requires a character sheet and the clip has no explicit
binding, validation should fail with a clear error.

## Pinned Assets Versus Clip Usage

The cast workspace may still need a "pinned assets" or "favorites" section.

That should be understood as a cast-level pin or curated set, not as the only
source of truth for clip generation.

Possible model:

```text
cast_asset_pin
  id
  cast_member_id
  asset_id
  pin_role
  sort_order
```

Examples:

- pin a favorite portrait;
- pin a useful base character sheet;
- pin a preferred voice sample;
- pin a research note.

Pinned assets help the cast UI.

Clip generation should use `clip_cast_binding` or another explicit scoped
binding.

This avoids the problem where changing a cast-level favorite silently changes
every clip.

## Cast Generation Recipes

The cast workspace should use the same generation recipe model as the rest of
Movie Studio.

Project-level defaults can define:

```text
Generation Recipes/cast.character-sheet/
Generation Recipes/cast.portrait/
Generation Recipes/cast.voice/
Generation Recipes/cast.voice-variant/
```

A specific cast member can override one of those generation types:

```text
Cast/001-mehmed-ii/Recipe Overrides/cast.character-sheet/
```

That override remains the current recipe for Mehmed II character sheets.

It is not a version for one individual take.

Notes:

- prompt text should live in prompt files;
- system prompts should live in system prompt files;
- provider/model selection should live in the recipe YAML files;
- model parameters should live in recipe YAML/model YAML files;
- recipe workflow steps should live in recipe workflow YAML files;
- SQLite records which recipe is the default and which scoped override applies;
- voice recipes should declare the target supported language explicitly;
- validation checks that every required recipe file exists and is valid;
- providers should receive inputs only after validation and generation packet
  compilation.

No defaults should be silently invented when a required source file, recipe, or
generation setting is missing.

## Cast Task Flow

Example: generate a character sheet for Mehmed II.

```text
UI or CLI calls movie-core command
validate cast member exists
resolve cast.character-sheet recipe for this cast member
validate generation recipe files exist
estimate cost and check relevant budget policy
compile recipe workflow inputs into a generation packet
create generation task in SQLite
execute recipe workflow
write generated files into temporary folder
allocate readable final asset path
move generated files into the final flat file or compound folder
register cast_asset and asset_file rows
link asset to the generation task and generation record
record actual provider cost, if reported
update projection
```

The resulting generated sheet is a cast asset.

It is not automatically used by any clip unless a command creates the explicit
binding.

The UI may offer a follow-up action:

```text
Use this sheet in current clip
```

That action should create or update a `clip_cast_binding`.

## Initial Casting Queries

The first UI projection likely needs:

```text
list cast members
get cast member detail
list cast assets by cast member and asset type
list pinned cast assets
list reference sets for cast member
list voice profiles and voice variants by supported language
list clips that explicitly bind a cast member or reference set
get resolved generation recipes for cast workspace tabs
list queued/running/completed cast generation tasks
list cast generation cost estimates and actual costs
```

These should be exposed through `movie-core` projection functions and then
served through the Studio server.

## Initial Casting Commands

Illustrative CLI shape:

```bash
renku movie cast list
renku movie cast add --name "Mehmed II" --kind character --role "Sultan"
renku movie cast update <cast-id> --name "Mehmed II"
renku movie cast asset import <cast-id> --type portrait --file portrait.png --title "Young sultan portrait"
renku movie cast asset list <cast-id>
renku movie cast asset pin <asset-id> --role portrait
renku movie cast reference-set create <cast-id> --name "Campaign armor"
renku movie cast reference-set add-asset <reference-set-id> <asset-id> --role character_sheet
renku movie clip cast bind <clip-id> <cast-id> --reference-set <reference-set-id>
renku movie cast generate <cast-id> --type character-sheet
renku movie cast voice generate <cast-id> --language tr-TR
renku movie recipe override cast.character-sheet --target cast:<cast-id>
```

These are examples, not final command syntax.

The important rule is that every command maps to a `movie-core` mutation.

## Open Questions For The Casting Schema

The first implementation should answer these before writing too much code:

- Should visual language bindings be implemented before cast generation, or can
  the first cast slice create visual language tables and defer generation-time
  visual language resolution?
- Should `supported_language` be created in the first database migration so cast
  voice work can declare a base voice language from the beginning?
- Which localization level should be implemented first: standard subtitles,
  timed transcripts/karaoke captions, dubbed audio, or lip-sync takes?
- Should the first paid generation flow enforce budgets as a hard gate, or
  record estimates and show warnings until explicit approval UI exists?
- Should `cast_reference_set` be required for clip usage, or can a clip bind
  directly to individual assets?
- Should cast-level pins be implemented immediately, or should the first UI show
  approved assets grouped by type?
- Which cast asset types are required for v1 generation recipes?
- Should generation recipe overrides be implemented immediately, or should the
  first slice only support project-level default recipes?
- How should imported external files be copied into the project versus linked
  from outside the project?
- Should the first database include task/history tables, or should casting begin
  with asset registration, pins, and explicit usage bindings only?

The safest initial slice is:

1. Project database and migrations.
2. Supported language table with explicit base language.
3. Generation recipe registry table.
4. Generation recipe binding table.
5. Minimal budget table.
6. Cost estimate and cost event tables for paid generation.
7. Visual language profile table.
8. Visual language asset table.
9. Visual language binding table.
10. Cast member table.
11. Cast asset table.
12. Asset file table.
13. Cast voice profile and voice variant tables, if voice generation is in the
    first slice.
14. Cast reference set table.
15. Clip cast binding table.
16. Lightweight generation record table.
17. Read projections for the current casting UI.
18. CLI and server mutations that call the same core functions.

## Final Decision Summary

Movie Studio will use SQLite as the source of truth for durable metadata.

The project database should represent a production workspace, which can be a
standalone movie now and a series with many episode-like movie units later.

The filesystem will store user-friendly content and generated media.

The filesystem will also store agent-editable production source files such as
prompts, system prompts, model configuration YAML, and recipe workflow YAML.

The folder structure should be pleasant to browse, but it must not define
relationships.

`movie-core` will own schemas, migrations, validation, mutation commands, and
projections.

`movie-studio/server` and `movie-cli` will be thin adapters over `movie-core`.

Agents should call CLI commands for metadata mutations instead of editing
metadata files.

Agents may directly edit prompt, system prompt, model config, recipe workflow,
note, and other production source files. SQLite should register and link those
files by path and hash, not store their bodies as canonical text.

Language and localization should be top-level domain concepts. Projects should
have explicit supported languages, explicit localization levels, first-class
subtitle tracks, timed transcripts for word-level captions, localized audio
tracks, and localized lip-sync takes when that expensive production level is
chosen.

Budget and cost should be top-level domain concepts. Movie Studio should store
budgets, pre-generation cost estimates, provider-reported actual costs, and
cost events separately so the UI can show both expected spend and accrued spend
without confusing the two.

Visual language should be a top-level domain concept. Visual language profiles
can contain style sheets, look references, prompt guidance, and other AI-facing
creative direction, then bind explicitly to cast members, sequences, scenes,
clips, episodes, or the whole project.

Casting should support many reusable assets per cast member and explicit
clip-specific reference bindings, rather than one global active character sheet
or portrait. Cast voice design should also support a base language and localized
voice variants.

## Future Cloud Versioning Direction

Movie Studio should remain a local-first production workspace.

The future paid cloud direction should not turn Movie Studio into a traditional
browser SaaS app where the UI edits remote backend state directly.

The intended long-term model is:

```text
working copy
  local project folder
  local SQLite metadata database
  local media files
  local recipes, prompts, configs, and recipe workflow files

remote
  versioning backend
  media object storage
  collaboration and review surface
```

Humans and agents should work against a local checkout.

The cloud service should behave like a movie-native remote, similar in spirit to
GitHub plus Git LFS, but eventually specialized for generated media and film
production work.

## Local-First Rule

The app should open and mutate a local project folder.

That local folder contains:

- `.renku/movie.sqlite`;
- project-relative media files;
- language, cast, visual language, sequence, scene, and clip folders;
- generation recipes;
- prompts;
- system prompts;
- model config YAML;
- recipe workflow YAML;
- subtitles, timed transcripts, localized audio, and localized lip-sync takes;
- budget and cost metadata in SQLite;
- local runtime/cache data.

The local project should remain usable without a cloud account.

Cloud services can add sync, backup, versioning, review, collaboration, and
hosted-agent work later, but they should not become required for normal
local editing.

## Cloud As Remote, Not Live Editing Backend

Future cloud storage should be treated as a remote versioning and asset storage
system.

It may support commands such as:

```bash
renku sync status
renku sync push
renku sync pull
renku sync history
renku sync restore
```

Or it may integrate with Git directly:

```bash
git push renku-cloud main
git pull renku-cloud main
```

The important boundary:

> Movie Studio edits the local working copy.
>
> Cloud stores and exchanges versions of that working copy.

The UI should not be designed around direct remote object editing.

The local server and CLI should keep reading and writing local files and the
local project database.

## Agent Model

Agents should use the same contract everywhere:

```text
local project folder + renku CLI
```

For desktop usage:

```text
agent runs on the user's machine
agent edits local project files
agent calls renku movie CLI commands
agent commits or prepares changes locally
```

For a future hosted agent system:

```text
cloud creates a sandbox VM
cloud clones the project
agent runs inside the sandbox
agent edits local files in that clone
agent calls renku movie CLI commands
agent commits changes
agent pushes a branch, review, or proposed change
```

This avoids having two different agent programming models.

Cloud agents and local agents both operate on a local checkout.

## Future-Friendly MVP Fields

The MVP should not build a cloud sync system yet.

However, the data model should avoid choices that would make cloud-backed
versioning difficult later.

Asset files should use stable logical IDs and project-relative paths.

Recommended shape:

```text
asset_file
  id
  asset_id
  role
  project_relative_path
  content_hash
  size_bytes
  mime_type
  media_kind
  sync_provider
  remote_object_key
  sync_status
  created_at
  updated_at
```

Initial values can be simple:

```text
sync_provider: null
remote_object_key: null
sync_status: local_only
```

These fields do not mean the app reads from cloud storage during normal editing.

They only leave room for future sync state.

Possible future values:

```text
sync_provider: git_lfs
sync_provider: renku_cloud
sync_provider: s3_compatible

sync_status: local_only
sync_status: synced
sync_status: modified
sync_status: missing_local
sync_status: missing_remote
```

The local file remains the working copy.

Remote object keys are sync metadata, not primary identity.

## Avoid These Couplings

To keep the future cloud remote possible, avoid:

- using filesystem paths as primary IDs;
- storing absolute local paths in project metadata;
- making the browser UI depend on `file://` URLs;
- assuming every project is hosted on GitHub;
- assuming every large media file is committed directly to normal Git;
- requiring a cloud account to open or edit a project;
- storing provider credentials inside the project;
- mixing temporary runtime outputs with durable project assets;
- letting UI/server/CLI mutate metadata through separate code paths;
- making remote URLs the canonical asset location.

The safe rule is:

> SQLite stores project metadata and sync metadata.
>
> Files store local working-copy content.
>
> Cloud stores remote versions and media objects.
>
> The local project remains the editing surface.
