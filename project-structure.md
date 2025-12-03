# Tutopanda Project Structure

This is a pnpm workspace monorepo with four main packages.

```
tutopanda/
├── cli/                          # tutopanda-cli - Command-line interface
│   ├── blueprints/               # Blueprint definitions for CLI workflows
│   ├── dist/                     # Build output (gitignored)
│   ├── docs/                     # CLI documentation
│   ├── src/
│   │   ├── commands/             # CLI command implementations
│   │   ├── lib/                  # Shared CLI utilities
│   │   ├── app.tsx               # Main Ink app component
│   │   └── cli.tsx               # CLI entry point
│   ├── inputs-default.yaml       # Sample input configuration
│   ├── tutosettings.json         # CLI settings
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── core/                         # tutopanda-core - Shared orchestration library
│   ├── dist/                     # Build output (gitignored)
│   ├── docs/                     # Core architecture documentation
│   ├── plans/                    # Planning documents
│   ├── src/
│   │   ├── blueprint-loader/     # Blueprint loading and parsing
│   │   ├── planning/             # Planning engine
│   │   ├── schema/               # JSON schemas and validation
│   │   ├── artifact-resolver.ts  # Artifact resolution logic
│   │   ├── canonical-expander.ts # Canonical node expansion
│   │   ├── canonical-graph.ts    # Canonical graph operations
│   │   ├── event-log.ts          # Event logging system
│   │   ├── hashing.ts            # Content-addressing utilities
│   │   ├── index.ts              # Main entry point
│   │   ├── json-path.ts          # JSON path utilities
│   │   ├── manifest.ts           # Manifest management
│   │   ├── planner.ts            # Planning orchestration
│   │   ├── provider-context.ts   # Provider context management
│   │   ├── revisions.ts          # Revision tracking
│   │   ├── runner.ts             # Execution runner
│   │   ├── storage.ts            # Storage abstraction
│   │   └── types.ts              # Core type definitions
│   ├── package.json
│   ├── tsconfig.json
│   └── vitest.config.ts
│
├── providers/                    # tutopanda-providers - AI provider implementations
│   ├── dist/                     # Build output (gitignored)
│   ├── docs/                     # Provider documentation
│   ├── plans/                    # Planning documents
│   ├── src/
│   │   ├── producers/            # Producer implementations
│   │   ├── sdk/                  # Provider SDK utilities
│   │   ├── index.ts              # Main entry point
│   │   ├── mappings.ts           # Provider mappings
│   │   ├── mock-output.ts        # Mock outputs for testing
│   │   ├── mock-producers.ts     # Mock producer implementations
│   │   ├── registry.ts           # Provider registry
│   │   └── types.ts              # Provider type definitions
│   ├── tests/                    # Test suites
│   ├── tmp/                      # Temporary files
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── vitest.integration.config.ts
│
├── tmp-root/                     # Temporary workspace files
├── .claude/                      # Claude AI configuration
├── .git/                         # Git repository
├── .pnpm-store/                  # pnpm package cache
├── .vscode/                      # VS Code workspace settings
├── node_modules/                 # Root workspace dependencies
│
├── .eslintrc.json                # ESLint configuration
├── .gitignore                    # Git ignore rules
├── .npmrc                        # npm configuration
├── .prettierrc.json              # Prettier configuration
├── AGENTS.md                     # Agent guidelines (this file)
├── CLAUDE.md                     # Claude-specific documentation
├── docker-compose.yml            # Docker services configuration
├── IMPLEMENTATION_SUMMARY.md     # Implementation notes
├── package.json                  # Root workspace package.json
├── pnpm-lock.yaml                # pnpm lockfile
├── pnpm-workspace.yaml           # pnpm workspace configuration
├── start_neon.sh                 # Database startup script
├── tsconfig.base.json            # Base TypeScript configuration
└── tsconfig.json                 # Root TypeScript configuration
```

## Package Descriptions

### `cli` (tutopanda-cli)
Command-line interface for generating movies using the core orchestration library. Built with Ink for interactive terminal UI.

### `core` (tutopanda-core)
Shared TypeScript library for orchestrating AI-based movie asset generation. Implements the manifest-centric, content-addressed storage architecture.

### `providers` (tutopanda-providers)
AI provider implementations and registry. Handles integration with various AI services for content generation.

## Build Artifacts (gitignored)
- `cli/dist/` - CLI build output
- `core/dist/` - Core library build output
- `providers/dist/` - Providers build output
- All `node_modules/` directories
- TypeScript build info files (`*.tsbuildinfo`)
