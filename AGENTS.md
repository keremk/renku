# Repository Guidelines

## Project Structure & Module Organization
Renku is a pnpm workspace with 5 packages:

### Published Packages
- `core/` (`@tutopanda/core`) is the foundation TypeScript library for orchestrating AI-based movie asset generation and planning. Source lives under `src/`, with published entry points in `src/index.ts`. Build artifacts go to `dist/`. All other packages depend on core.
- `cli/` (`@tutopanda/cli`) provides a command-line workflow for generating movies, backed by the core package. Built with Ink (React for terminals) and MCP SDK. Keep the main entry point in `src/cli.tsx` and organise reusable UI under `src/`.
- `compositions/` (`@tutopanda/compositions`) contains shared Remotion compositions and renderers for video output. Supports browser and Node.js execution. Source in `src/`, build artifacts in `dist/`.
- `providers/` (`@tutopanda/providers`) integrates external AI services (OpenAI, Replicate, ElevenLabs). Implements producer interfaces backed by the core package. Source in `src/`, build artifacts in `dist/`.

### Private Packages
- `viewer/` is a browser-based viewer application built with Vite + React. Uses Remotion Player, Tailwind CSS v4, and Shadcn UI. Source in `src/`, server middleware in `src/server/`.

Consult `design_guidelines.md` before adjusting visuals in the client, and keep shared logic inside `core/` whenever possible to avoid duplication across the API and CLI surfaces.

## Build, Test, and Development Commands
Run `pnpm install` once to hydrate the workspaces. Use `pnpm dev:core`, `pnpm dev:cli`, or `pnpm dev:viewer` for focused development. Build artifacts either via `pnpm build` or per-package scripts such as `pnpm build:core`. Linting and type checks run through the package names: e.g. `pnpm lint:core`, `pnpm type-check:cli`, `pnpm lint:providers`. Vitest is wired the same way: `pnpm test:core`, `pnpm test:cli`, `pnpm test:providers`, etc. Use the actual package names with `--filter` when invoking commands from the repo root (e.g., `pnpm --filter @tutopanda/core build`).

> **EXTREMELY IMPORTANT** DO NOT JUST ADD default fallbacks just to make sure that you have something, especially for inputs that are expected. Than you are silently failing and making some random assumptions. Always throw, fail fast and so those can be fixed.

> **EXTREMELY IMPORTANT** Absolutely no fallbacks: never quietly substitute defaults or best guesses when inputs or mappings are missing. Fail fast, surface the missing value, and stop before calling any SDK so issues can be fixed explicitly.

> **EXTREMELY IMPORTANT** When running vitest, make sure to cd into the project and run it there, here is how to do for CLI for example.
```bash
cd cli && pnpm vitest run --pool=threads --poolOptions.threads.singleThread
```

> **VERY IMPORTANT** Do not add “extra defensive” guards (e.g. `typeof source.durationMultiplier === 'number' ? ...` as a silent fallback). Trust the defined schema/mapping; if a value is absent or malformed, throw immediately instead of guessing or defaulting.

> **Important**: Do not write overly defensive code. Do production quality checking but do not write it in an overly defensive way. Clear and readable code is the key. Don’t add speculative guards, elaborate null checks, or fallback branches that handle scenarios we don’t actually expect today. Stick to the known contract, keep control flow straightforward, and only handle concrete failure modes we already understand (e.g., validation errors that truly happen).

> **Important**: Do **not** run `pnpm install` as a build step or during routine development tasks—only run it when specifically instructed to hydrate dependencies.

> **Agent Rule**: Never run package-management commands (`pnpm add`, `pnpm install`, etc.) without explicit user approval. Always surface the dependency request to the user instead.

> **Agent Rule**: Never use `git checkout` or other destructive git commands to reset files. Always coordinate with the user if a revert is needed.

> **Agent Rule**: When you see an /* eslint-disable no-unused-vars */ Do NOT delete it. It is there for a reason to turn off an overeager rule trying it on Interfaces.

> **Agent Rule**: Providers Vitest runs must stay on the threads pool; run `pnpm --filter tutopanda-providers test` from the repo root (the config already pins `pool: 'threads'`). If you need to run it manually inside the package use:
```bash
cd providers && pnpm vitest run --config vitest.config.ts --pool=threads
```

> **Agent Rule**: Never run `git restore`, `git checkout`, `git clean`, or any other destructive git command without explicit user consent. Confirm with the user before invoking any command that might drop local changes.

> **Agent Rule**: Never generate build artefacts (e.g. `.js`, `.d.ts`, `.map`) inside `core/src` or other source directories. Keep generated output inside the designated `dist/` folders by running the appropriate package build.

> **Agent Rule**: When cross-package types or builds are needed, rely on the workspace packages' documented build outputs (`dist/`) or ask the user for guidance. Do not create ad-hoc shims or shortcuts; pause and ask if unsure.

> **Agent Rule**: Never delete files without explicit confirmation from the user.

> **Agent Rule**: Always propagate and consume the canonical node IDs (`Input:…`, `Artifact:…`, `Producer:…`). Do not introduce alias-based fallbacks or heuristic lookups—if a canonical binding is missing, throw a descriptive error so the blueprint or plan can be fixed explicitly.

> **Agent Rule**: Canonical IDs must flow end-to-end. The planner emits a single canonical artefact/input ID (e.g. `Artifact:MusicPromptGenerator.MusicPrompt`). The runner copies those exact IDs into each job’s context (`job.context.inputs`, `inputBindings`, `fanIn`, and `resolvedInputs`). Providers must read only that canonical ID (via `runtime.sdk.buildPayload`, `runtime.inputs.getByNodeId`, or fan-in descriptors) and never look up aliases or “best guesses”. If a canonical ID is missing, fail immediately so the upstream blueprint/plan can be fixed instead of synthesizing a fallback. This applies to every artefact, prompt variable, and attachment across the CLI/core/provider boundary.

> **Agent Rule**: When resolving blueprint/config paths (e.g., locating `config/blueprints`), use the shared helpers in `cli/src/lib/config-assets.ts` (`getBundledBlueprintsRoot`, `getCliConfigRoot`, `resolveBlueprintSpecifier`, etc.) instead of hardcoded paths.

## Coding Style & Naming Conventions
Write strict TypeScript and prefer functional components with kebab-case filenames. Use configured path aliases: `@core/*` for core package imports, `@cli/*` for CLI imports, and `@assets/*` for attached assets. Reuse existing helpers and patterns before adding new utilities. Keep new files two-space indented to match the existing style. For viewer (which uses Tailwind), use Tailwind utilities and design tokens instead of ad-hoc CSS.

- Optimise for clarity first: avoid adding defensive guards or nested ternaries that obscure intent unless there is a concrete bug being handled. Prefer small helper functions or straightforward control flow.
- Avoid overly defensive TypeScript patterns (e.g., repeatedly checking `foo && typeof foo === 'object' && !Array.isArray(foo)`). Trust the known contract and let bad inputs surface as real errors instead of speculative guards.

## Testing Guidelines
The repo relies on linting and type checks as the baseline gate, and all packages are wired for Vitest. Add tests for new behaviour (`.test.ts`/`.test.tsx` next to the code) in core, CLI, and providers packages. Ensure each package exposes `test` scripts and use `pnpm test:core`, `pnpm test:cli`, or `pnpm test:providers` from the root. Document fixture data inside its package and keep runs deterministic.

## Commit & Pull Request Guidelines
Follow the `<type>: <summary>` pattern seen in history (example `init: first version that runs on Next.js`). Keep subjects imperative and scope commits to one concern. Pull requests should explain the change, link tracking issues, and include screenshots or clips for UI updates. Add a testing note listing the commands you ran (at minimum `pnpm check`). Call out required follow-ups such as database pushes or environment changes before requesting review.
