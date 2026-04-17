# @gorenku/core

> Core workflow orchestration engine for Renku

[![npm version](https://img.shields.io/npm/v/@gorenku/core.svg)](https://www.npmjs.com/package/@gorenku/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

The core library for Renku - handles blueprint loading, execution planning, job orchestration, event logging, run lifecycle tracking, and dynamic `BuildState` reconstruction. This package is the foundation for building AI-powered video generation workflows.

Authoring and runtime terminology in core is intentionally split:

- Authored blueprints declare `inputs:`, `outputs:`, and `imports:`
- Runtime execution appends concrete history as canonical input and `Artifact:...` events plus per-run metadata
- `BuildState` is a reconstructed snapshot derived from that persisted runtime history, not a stored source of truth

## Overview

`@gorenku/core` is designed for developers who want to build custom tooling on top of Renku's workflow orchestration system. It provides the fundamental building blocks for:

- **Blueprint parsing and validation** - Load and validate YAML workflow definitions
- **Execution planning** - Build dependency graphs and create layered execution plans
- **Job orchestration** - Run jobs in parallel with automatic dependency resolution
- **State management** - Rebuild current runtime state from event logs and run lifecycle history whenever core needs a current view
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

- `createStorageContext()` - File system storage abstraction entry point
- `createCloudStorageContext()` - S3-based cloud storage entry point
- `createEventLog()` - Records input and artifact events for execution history, debugging, and auditing
- `BuildState` - In-memory snapshot of the latest known inputs, artifacts, revision, and run configuration
- `createBuildStateService()` - Rebuilds the latest `BuildState` view from persisted event history plus run lifecycle metadata
- `createRunLifecycleService()` - Appends and reads explicit run lifecycle events plus snapshot references

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

The blueprint loader parses YAML workflow definitions and validates them against the schema. It resolves blueprint `imports:` and input sources to create a complete blueprint ready for planning.

### Planner

The planner analyzes the blueprint, resolves dependencies between producers, and creates a layered execution plan. It performs dirty checking to determine which artifacts need regeneration and optimizes for parallel execution.

### Runner

The runner executes the plan layer by layer, running independent jobs in parallel within each layer. It handles artifact resolution, provider communication, and event logging.

### BuildState

`BuildState` is a synthesized view of the latest runtime state for a movie. It includes the latest known input hashes, artifact metadata, revision information, and optional run configuration.

`BuildState` is not the canonical persisted runtime store. Core does not maintain a separate mutable current-state document and then try to keep it in sync. Instead, the source of truth is:

- input events in the event log
- artifact events in the event log
- run lifecycle events for per-run metadata such as plan paths, input snapshot paths, status, and summaries

Core rebuilds `BuildState` from that history whenever planning, execution, or read APIs need the current state. That means the snapshot always comes from the same persisted history the runtime just wrote.

This matters especially after a run. Execution appends new input events, artifact events, and run lifecycle events first, and only then exposes a fresh `BuildState` snapshot. In other words, `runResult.buildStateSnapshot()` is a rebuild from the updated source of truth, not a lightly patched copy of the state that was passed into the run.

### Event Log

The event log records the runtime history of a movie: input edits, artifact production attempts, failures, and resulting revisions. It is the canonical history stream used to reconstruct current state.

### Run Lifecycle

Explicit run lifecycle events store per-revision metadata alongside the rest of the runtime history, such as:

- plan file paths
- input snapshot paths and hashes
- run status and timestamps
- run summaries
- run configuration

Together, input events, artifact events, and run lifecycle events let core rebuild a current `BuildState` snapshot without treating that snapshot as the source of truth.

## Usage Example

```typescript
import {
  createStorageContext,
  initializeMovieStorage,
  createBuildStateService,
  createEventLog,
  createPlanner,
  createRunner
} from '@gorenku/core';

const storage = createStorageContext({
  kind: 'local',
  basePath: '/path/to/workspace/builds',
});
await initializeMovieStorage(storage, 'movie-123');

const buildStateService = createBuildStateService(storage);
const eventLog = createEventLog(storage);

const { buildState } = await buildStateService.loadCurrent('movie-123');

const planner = createPlanner();
const planResult = await planner.computePlan({
  movieId: 'movie-123',
  buildState,
  eventLog,
  blueprint: producerGraph,
  targetRevision: 'rev-0002',
  pendingEdits: [],
});

const runner = createRunner();
const runResult = await runner.execute(planResult.plan, {
  movieId: 'movie-123',
  buildState: planResult.buildState,
  executionState: planResult.executionState,
  storage,
  eventLog,
  produce,
});

const nextBuildState = await runResult.buildStateSnapshot();
```

In that flow, `buildState` is just the planner and runner's current working snapshot. The durable record is still the event history written during execution, and `nextBuildState` is reconstructed from those persisted writes.

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

- **`build-state.ts`, `event-log.ts`, `run-lifecycle.ts`** - Runtime history storage and current-state reconstruction
  - `event-log.ts` - Append and read runtime events
  - `run-lifecycle.ts` - Append and read explicit run lifecycle events
  - `build-state.ts` - Rebuild the latest `BuildState` view from persisted history

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
