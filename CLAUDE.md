# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Renku is a pnpm workspace monorepo with 5 packages:

### Published Packages
- **@renku/core** (`core/`): Core library for planning, managing, and running movie generation flows. Includes blueprint loading, planning engine, manifest management, and event logging.
- **@renku/cli** (`cli/`): Command-line interface for movie generation. Built with Ink (React for terminals) and MCP (Model Context Protocol) integration.
- **@renku/compositions** (`compositions/`): Shared Remotion compositions and renderers for video generation. Supports both browser and Node.js environments.
- **@renku/providers** (`providers/`): AI provider integrations (OpenAI, Replicate, ElevenLabs). Includes producer implementations and provider registry.

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

# Type checking and linting
pnpm check                           # TypeScript validation for all packages
pnpm type-check                      # Type checking for all packages
pnpm type-check:core                 # Type check core only
pnpm type-check:cli                  # Type check CLI only
pnpm type-check:compositions         # Type check compositions only
pnpm lint                            # Lint core, providers, and CLI
pnpm lint:core                       # Lint core only
pnpm lint:cli                        # Lint CLI only
pnpm lint:providers                  # Lint providers only

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
- Type checking is essential - run `pnpm check` before committing

## Important Notes

- Always run `pnpm check` to validate TypeScript before committing
- Each package is independently published - maintain semantic versioning
- The core package is the foundation for all other packages
- Use existing patterns from core/ as reference for new code