# Blueprint Handling Code Review - Comprehensive Findings

## Executive Summary

This code review covers the blueprint handling system across parsing, graph creation/expansion, inputs handling, planning, dirty tracking, execution, and artifact generation. The review identified **45+ issues** across 4 main categories:

- **Critical Issues**: 8 (require immediate attention)
- **High Priority**: 12 (should fix soon)
- **Medium Priority**: 15+ (improve code quality)
- **Test Coverage Gaps**: 15+ modules undertested or untested

---

## 1. Critical Issues

### 1.1 Duplicated Artifact Hash Logic (Risk: Hash Mismatches)
**Files:**
- `core/src/planning/planner.ts:310-318`
- `core/src/manifest.ts:226-233`

The `deriveArtefactHash` function is duplicated with **different implementations**:
- planner.ts uses `hashPayload()`
- manifest.ts uses `createHash('sha256')`

This inconsistency could cause hash mismatches, breaking dirty tracking.

### 1.2 Silent Error Swallowing in Graph Resolution
**File:** `core/src/resolution/canonical-expander.ts:556-558`

```typescript
try {
  owner = findNodeByNamespace(root, candidatePath);
  // ...
} catch {
  // Namespace not found, try shorter path - SWALLOWS ALL ERRORS
}
```

All errors including schema errors, type errors, and programming mistakes are silently caught and suppressed.

### 1.3 Race Condition in Manifest Save
**File:** `core/src/manifest.ts:79-101`

Read-check-write pattern without atomicity:
1. Read pointer
2. Check hash
3. Write manifest
4. Write pointer (separate operation)

Between steps, another process could modify the pointer, causing data loss.

### 1.4 Manifest Atomicity Violation
**File:** `core/src/manifest.ts:79-102`

Manifest and pointer are written in separate operations. If writePointer fails after writeFileAtomic succeeds, the system enters an inconsistent state.

### 1.5 Race Condition in Append Queue
**File:** `core/src/storage.ts:62-80`

The append queue uses `.catch(() => { /* noop */ })` which silently swallows all errors. If appends fail, the promise chain continues without notification.

### 1.6 Asymmetric Dimension Alignment Check
**File:** `core/src/resolution/canonical-expander.ts:467-508`

The `edgeInstancesAlign` function skips comparison when dimensions don't match, potentially allowing edges between nodes with incompatible dimensions.

### 1.7 Silent JSON Parse in Manifest Loading
**File:** `core/src/manifest.ts:132-142`

Corrupted manifest pointers are silently replaced with empty pointers, hiding data corruption.

### 1.8 Event Log Race with Pending Edits
**File:** `core/src/orchestration/planning-service.ts:123-150`

Input events are appended to event log AND passed as pendingEdits, risking double-counting in dirty tracking.

---

## 2. DRY Violations (Duplicated Logic)

### 2.1 `deriveDimensionName` Function (3 copies)
- `core/src/parsing/blueprint-loader/yaml-parser.ts:820-844`
- `core/src/resolution/schema-decomposition.ts:174-208`
- `core/src/resolution/canonical-expander.ts:796-799`

### 2.2 Blob Resolution Logic (2 copies)
- `core/src/runner.ts:712-740`
- `core/src/blob-utils.ts:215-234`

### 2.3 Latest Event Collection Logic (2 copies)
- `core/src/manifest.ts:193-224`
- `core/src/planning/planner.ts:260-296`

---

## 3. Speculative Fallbacks Hiding Errors

| File | Lines | Issue |
|------|-------|-------|
| `manifest.ts` | 132-142 | Silent JSON parse fallback to empty pointer |
| `canonical-expander.ts` | 556-558 | Silent catch during namespace resolution |
| `artifact-resolver.ts` | 109-119 | Legacy path fallback without logging |
| `artifact-resolver.ts` | 127-133 | JSON decode fallback to raw string |
| `condition-evaluator.ts` | 418-425 | Invalid regex treated as "not matching" |
| `planning-service.ts` | 346-356 | Failed schema parse silently skipped |
| `runner.ts` | 353-377 | Logging failures continue silently |

---

## 4. Dead Code

| File | Lines | Description |
|------|-------|-------------|
| `yaml-parser.ts` | 701-703 | `normalizeReference()` - no-op function |
| `planner.ts` | 22-23 | `PlannerLogger` interface - serves no purpose |
| `runner.ts` | 34-35 | `RunnerLogger` interface - serves no purpose |

---

## 5. Unnecessary Complexity

### 5.1 Backward Compatibility Fallbacks (Undocumented)
**File:** `yaml-parser.ts:81-95`

Two silent fallback chains without warnings:
- `artifacts` vs `artefacts` (British/American spelling)
- `producers` vs `modules` (field rename)

Users won't know they're using deprecated fields.

### 5.2 Multiple Fallback Levels in Output Generation
**File:** `providers/src/sdk/unified/output-generator.ts:271-341`

Four nested fallback levels for mock output generation makes debugging difficult.

### 5.3 Type Confusion in Artifact Resolution
**File:** `runner.ts:496-512`

Tries 3 different key formats silently:
1. Full canonical ID
2. Without prefix
3. Without dimensions

No logging of which format matched.

---

## 6. Type Safety Issues

### 6.1 Raw Blueprint Uses `unknown` Throughout
**File:** `yaml-parser.ts:184-199`

```typescript
interface RawBlueprint {
  meta?: unknown;
  inputs?: unknown[];
  artifacts?: unknown[];
  // ...26 more `unknown` fields
}
```

All values immediately cast to `Record<string, unknown>`, defeating type checking.

### 6.2 Unsafe JSON Assertions
- `manifest.ts:71` - `JSON.parse(raw) as Manifest` without validation
- `manifest.ts:133-139` - `Partial<ManifestPointer>` without enforcement

---

## 7. Error Handling Gaps

### 7.1 Input Error Context Missing
**File:** `input-loader.ts:138-152`

If `resolver.toCanonical(key)` throws, no context about which input caused the problem.

### 7.2 Dirty Propagation Skips Missing Metadata
**File:** `planner.ts:140-160`

Jobs not in metadata are silently skipped rather than flagged as errors.

### 7.3 Deleted Inputs Not Detected
**File:** `planner.ts:276-285`

Only compares hashes - can't distinguish "input removed" from "input unchanged".

---

## 8. Test Coverage Gaps

### 8.1 Completely Untested Files
| File | Lines | Impact |
|------|-------|--------|
| `canonical-ids.ts` | 508 | Critical ID utilities |
| `producer-graph.ts` | 268 | Producer graph creation |
| `planning/adapter.ts` | 45 | Planner wrapper |

### 8.2 Severely Undertested (<30% coverage)
| File | Lines | Test Lines | Gap |
|------|-------|------------|-----|
| `canonical-expander.ts` | 879 | ~150 | 600+ untested |
| `canonical-graph.ts` | 745 | ~100 | 600+ untested |
| `yaml-parser.ts` | 854 | 239 | 600+ untested |
| `input-loader.ts` | 594 | ~100 | 400+ untested |
| `orchestration/planning-service.ts` | 357 | ~50 | 300+ untested |

### 8.3 Missing Integration Tests
- End-to-end blueprint→execution flow
- Condition-based execution flow
- Multi-level nested blueprints
- Artifact override & fan-in
- Error recovery scenarios

### 8.4 Missing Edge Case Tests
- Circular job dependencies
- Very large manifests (1000+ inputs)
- Missing artifact during condition evaluation
- Empty graphs or graphs with orphaned nodes
- Producer returning no artifacts
- Unicode/emoji in input values

---

## 9. Conflicting/Redundant Code

### 9.1 Mixed Manifest Source of Truth
Two paths to manifest state without consistency check:
1. `manifestService.loadCurrent()`
2. `manifestService.buildFromEvents()`

### 9.2 Inconsistent Terminology
- "artefact" spelled both ways
- `determineDirtyInputs` vs `determineDirtyArtefacts` naming

---

## 10. Performance Concerns

### 10.1 Full Event Log Scan on Every Plan
**File:** `planner.ts:55-59`

No incremental/delta approach using available `sinceRevision` parameter.

### 10.2 Duplicate Iterations in Metadata Building
**File:** `planner.ts:92-107`

Filters inputs twice when building graph metadata.

---

## Recommended Action Priority

### Immediate (Critical)
1. Fix duplicated `deriveArtefactHash` - use single shared implementation
2. Add proper error handling in `canonical-expander.ts:556-558`
3. Address manifest save atomicity issue
4. Fix silent error swallowing in storage append queue

### Short-term (High Priority)
5. Consolidate `deriveDimensionName` to single location
6. Add logging to all speculative fallbacks
7. Remove dead code (`normalizeReference`, empty interfaces)
8. Add deprecation warnings for backward-compat fields

### Medium-term (Quality)
9. Improve type safety in YAML parsing
10. Add comprehensive tests for:
    - `canonical-ids.ts`
    - `producer-graph.ts`
    - `canonical-expander.ts`
    - `canonical-graph.ts`

### Long-term (Architecture)
11. Create integration test suite for full blueprint flow
12. Consider event sourcing for manifest consistency
13. Add structured logging throughout

---

## Files Requiring Most Attention

1. **`core/src/manifest.ts`** - Multiple critical issues (atomicity, race conditions)
2. **`core/src/resolution/canonical-expander.ts`** - Silent error swallowing, complexity, poor test coverage
3. **`core/src/planning/planner.ts`** - Duplicated logic, error handling gaps
4. **`core/src/parsing/blueprint-loader/yaml-parser.ts`** - Type safety, dead code, poor test coverage
5. **`core/src/runner.ts`** - Silent failures, resource management, incomplete tests


Manifest Atomicity Approaches - Pros/Cons

  Option 1: Transaction-style Rollback

  How it works: If pointer write fails after manifest write succeeds, delete the orphaned manifest file.

  | Pros                             | Cons                                             |
  |----------------------------------|--------------------------------------------------|
  | Simple to implement              | Brief window where file exists but isn't tracked |
  | Minimal changes to existing code | Delete operation could also fail                 |
  | No new file formats needed       | Doesn't prevent all race conditions              |

  Option 2: Write-ahead Logging (WAL)

  How it works: Write an intent file first, then manifest+pointer, then delete intent. On startup, check for intent files and recover.

  | Pros                       | Cons                               |
  |----------------------------|------------------------------------|
  | Full crash recovery        | More complex implementation        |
  | Industry-standard approach | Requires recovery logic on startup |
  | Handles all failure modes  | New file format/convention needed  |

  Option 3: Single File Approach

  How it works: Embed the pointer data (revision, hash, path) inside the manifest file itself. Only one atomic write needed.

  | Pros                                | Cons                                        |
  |-------------------------------------|---------------------------------------------|
  | Eliminates atomicity issue entirely | Changes manifest file format                |
  | Simplest long-term solution         | Requires migration for existing manifests   |
  | Single source of truth              | May need backwards compat during transition |