# @gorenku/core

> Core workflow orchestration engine for Renku

[![npm version](https://img.shields.io/npm/v/@gorenku/core.svg)](https://www.npmjs.com/package/@gorenku/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The core library for Renku - handles blueprint loading, execution planning, job orchestration, manifest management, and event logging. This package is the foundation for building AI-powered video generation workflows.

## Overview

`@gorenku/core` is designed for developers who want to build custom tooling on top of Renku's workflow orchestration system. It provides the fundamental building blocks for:

- **Blueprint parsing and validation** - Load and validate YAML workflow definitions
- **Execution planning** - Build dependency graphs and create layered execution plans
- **Job orchestration** - Run jobs in parallel with automatic dependency resolution
- **State management** - Track artifacts, versions, and execution history
- **Storage abstraction** - Local filesystem and S3 cloud storage support

This is a developer-focused package. If you're looking to generate videos from the command line, use [@gorenku/cli](../cli/README.md) instead.

## Installation

```bash
npm install @gorenku/core
```

Or in a pnpm workspace:

```bash
pnpm add @gorenku/core
```

## Key Exports

### Blueprint Loading

- `BlueprintLoader` - Parses YAML blueprints and resolves module imports
- `loadBlueprint()` - Convenience function for loading blueprint files
- `InputLoader` - Handles input value resolution and defaults

### Planning

- `Planner` - Builds execution graphs and creates layered execution plans
- `PlanningService` - High-level service for coordinating planning operations
- `createPlanner()` - Factory function for creating planner instances

### Execution

- `Runner` - Executes jobs layer by layer with parallel execution support
- `createRunner()` - Factory function for creating runner instances

### Storage & State

- `Storage` - File system storage abstraction
- `CloudStorage` - S3-based cloud storage implementation
- `EventLog` - Records execution events for debugging and auditing
- `Manifest` - Tracks artifact metadata, versions, and dependencies
- `createManifestService()` - Factory for manifest management

### Types

- `Blueprint` - Blueprint definition type
- `Producer` - Producer interface type
- `Artifact` - Artifact metadata type
- `ExecutionPlan` - Execution plan type
- `ProducerGraph` - Producer dependency graph type
- `InputSource` - Input value source type

### Utilities

- `hashing` - Content hashing utilities
- `jsonPath` - JSON path query utilities
- `blobUtils` - Blob file handling utilities
- `canonicalIds` - Canonical ID generation

## Core Concepts

### Blueprint Loader

The blueprint loader parses YAML workflow definitions and validates them against the schema. It resolves module imports and input sources to create a complete blueprint ready for planning.

### Planner

The planner analyzes the blueprint, resolves dependencies between producers, and creates a layered execution plan. It performs dirty checking to determine which artifacts need regeneration and optimizes for parallel execution.

### Runner

The runner executes the plan layer by layer, running independent jobs in parallel within each layer. It handles artifact resolution, provider communication, and event logging.

### Manifest

The manifest system tracks all artifacts produced during execution, including their metadata, dependencies, and content hashes. This enables incremental regeneration and dependency tracking across runs.

### Event Log

The event log records all significant events during execution (input changes, artifact production, errors) for debugging and audit purposes.

## Usage Example

```typescript
import {
  loadBlueprint,
  createPlanner,
  createRunner,
  createManifestService,
  Storage,
  EventLog
} from '@gorenku/core';

// Load blueprint
const blueprint = await loadBlueprint('./blueprint.yaml');

// Load inputs
const inputs = await loadInputs('./inputs.yaml');

// Create storage
const storage = new Storage('/path/to/workspace/builds/movie-123');

// Create manifest service
const manifestService = createManifestService(storage);

// Create execution plan
const planner = createPlanner(blueprint, inputs, manifestService);
const plan = await planner.createPlan();

// Create event log
const eventLog = new EventLog(storage);

// Execute the plan
const runner = createRunner({
  plan,
  storage,
  registry, // Provider registry from @gorenku/providers
  eventLog,
  concurrency: 2
});

await runner.execute();
```

## Development

### Setup

```bash
# Clone the monorepo
git clone https://github.com/yourusername/renku.git
cd renku

# Install dependencies
pnpm install
```

### Build

```bash
# Build the core package
pnpm --filter @gorenku/core build

# Watch mode for development
pnpm --filter @gorenku/core dev
```

### Testing

```bash
# Run unit tests
pnpm --filter @gorenku/core test

# Run tests in watch mode
pnpm --filter @gorenku/core test --watch
```

### Type Checking

```bash
# Type check the package
pnpm --filter @gorenku/core type-check
```

### Linting

```bash
# Lint the code
pnpm --filter @gorenku/core lint
```

## Architecture

The core package is organized into several key directories:

- **`parsing/`** - Blueprint and input parsing, schema validation
  - `blueprint-loader/` - YAML blueprint loading and validation
  - `input-loader.ts` - Input value resolution

- **`planning/`** - Execution graph construction and planning
  - `planner.ts` - Main planning engine
  - `dirty-checker.ts` - Determines what needs regeneration

- **`orchestration/`** - High-level service coordination
  - `planning-service.ts` - Coordinates planning operations

- **`resolution/`** - Dependency resolution and graph expansion
  - `canonical-graph.ts` - Canonical producer graph
  - `producer-graph.ts` - Dependency graph construction

- **`schema/`** - Blueprint schema and validation
  - JSON schema definitions for blueprints and inputs

## Testing

The core package uses Vitest for testing. Tests are located alongside source files with the `.test.ts` extension.

Run the test suite:

```bash
pnpm --filter @gorenku/core test
```

## Contributing

When contributing to the core package:

- Follow the coding conventions in [CLAUDE.md](../CLAUDE.md)
- Ensure TypeScript strict mode compliance
- Add tests for new functionality
- Run `pnpm check` before submitting

## License

MIT
