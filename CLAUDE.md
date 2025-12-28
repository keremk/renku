# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Renku is a pnpm workspace monorepo with 5 packages:

### Published Packages
- **@gorenku/core** (`core/`): Core library for planning, managing, and running movie generation flows. Includes blueprint loading, planning engine, manifest management, and event logging.
- **@gorenku/cli** (`cli/`): Command-line interface for movie generation. Built with Ink (React for terminals) and MCP (Model Context Protocol) integration.
- **@gorenku/compositions** (`compositions/`): Shared Remotion compositions and renderers for video generation. Supports both browser and Node.js environments.
- **@gorenku/providers** (`providers/`): AI provider integrations (OpenAI, Replicate, ElevenLabs). Includes producer implementations and provider registry.

### Private Packages
- **viewer** (`viewer/`): Browser-based viewer application built with Vite + React. Uses Remotion Player and Tailwind CSS with Shadcn UI components.

## Development Commands

```bash
# Setup
pnpm install

# Development (package-specific)
pnpm dev:core      # Watch core package
pnpm dev:cli       # Watch CLI package
pnpm dev:viewer    # Start viewer dev server

# Building
pnpm build                    # Build all packages
pnpm build:core              # Build core only
pnpm build:cli               # Build CLI only
pnpm build:compositions      # Build compositions only
pnpm build:providers         # Build providers only
pnpm build:viewer            # Build viewer only

# Type checking and linting (from root)
pnpm check                           # Full validation: type-check + test:typecheck
pnpm type-check                      # Type-check production code (all packages)
pnpm test:typecheck                  # Type-check test files (all packages)
pnpm lint                            # Lint all packages (includes test files)

# Type checking and linting (per package)
pnpm --filter @gorenku/core check:all       # Full check for core
pnpm --filter @gorenku/providers check:all  # Full check for providers
pnpm --filter @gorenku/cli check:all        # Full check for CLI

# Testing
pnpm test                            # Run tests for core, providers, and CLI
pnpm test:core                       # Test core only
pnpm test:cli                        # Test CLI only
pnpm test:providers                  # Test providers only

# Bundling and Packaging
pnpm bundle:viewer                   # Bundle viewer for distribution
pnpm package:cli                     # Package CLI for distribution
```

## Key Technologies

- **CLI**: Ink (React for terminals), MCP SDK, TypeScript
- **Core**: TypeScript, Vitest (testing), event-driven architecture
- **Compositions**: Remotion 4.0+, React 19, TypeScript
- **Providers**: AI provider SDKs (OpenAI, Replicate, ElevenLabs), TypeScript
- **Viewer**: Vite, React 19, Remotion Player, Tailwind CSS v4, Shadcn UI
- **Package Manager**: pnpm workspaces
- **Build**: TypeScript compilation (tsc) and Vite

## Coding Conventions

- Use kebab-case for filenames
- TypeScript strict mode enabled
- Functional components and pure functions
- 2-space indentation
- Import aliases: `@core/*`, `@cli/*`, `@assets/*`
- Follow existing patterns and architecture

## Path Aliases

- `@core/*`: Maps to `core/src/*`
- `@cli/*`: Maps to `cli/src/*`
- `@assets/*`: Maps to `attached_assets/*`

## Testing

Use Vitest for unit and integration tests:
- Core, providers, and CLI packages have Vitest configured
- Test files use `.test.ts` or `.test.tsx` suffix
- Run `pnpm test` to execute tests

## Testing Requirements

- **Always write tests for new functionality** - Unit tests for new modules, integration tests for complex flows
- New source files should have corresponding `.test.ts` files
- Test all exported functions and edge cases
- Run `pnpm test` to verify tests pass before finishing

## Validation Workflow

**IMPORTANT: Always run these checks after making changes:**

1. **After modifying code in a specific package:**
   ```bash
   pnpm --filter @gorenku/<package> check:all
   ```

2. **Before finishing any task, run full validation:**
   ```bash
   pnpm check    # Type-checks both production and test files
   pnpm lint     # Lints all files including tests
   pnpm test     # Runs all tests
   ```

3. **What each check covers:**
   - `type-check`: Production code only (excludes test files)
   - `test:typecheck`: Test files only (uses separate tsconfig.vitest.json)
   - `check`: Runs BOTH type-check and test:typecheck
   - `lint`: Lints all files including test files
   - `check:all` (per package): type-check + lint + test:typecheck

**Note:** The main `tsconfig.json` excludes test files intentionally (for builds). Test files have separate `tsconfig.vitest.json` configs. Always run `pnpm check` (not just `pnpm type-check`) to validate everything.

## Important Notes

- **NEVER commit changes on behalf of the user** - always let them handle commits
- **Always run `pnpm check` AND `pnpm lint`** to validate all code before finishing
- Each package is independently published - maintain semantic versioning
- The core package is the foundation for all other packages
- Use existing patterns from core/ as reference for new code