Canonical ID System Critique

  Executive Summary

  The codebase has a partially implemented canonical ID system with significant inconsistencies, fallback logic, and
  over-engineering. While the intent to use canonical IDs (Input:, Artifact:, Producer:) is present, the implementation falls
  short of the strict "canonical-only" goal.

  ---
  🚨 Critical Issues

  1. Missing isCanonicalProducerId() Validator

  Location: core/src/parsing/canonical-ids.ts

  There's formatCanonicalProducerId() but no isCanonicalProducerId():
  // EXISTS:
  export function isCanonicalInputId(value: string): boolean { ... }
  export function isCanonicalArtifactId(value: string): boolean { ... }

  // MISSING:
  export function isCanonicalProducerId(value: string): boolean { ... }

  Throughout the codebase, ad-hoc checks like node.id.startsWith('Producer:') are used instead.

  ---
  2. Dual Resolution Mode in InputIdResolver

  Location: core/src/parsing/canonical-ids.ts:82-98

  The resolver accepts BOTH canonical IDs AND qualified names, creating ambiguity:
  const resolve = (key: string): string => {
    if (isCanonicalInputId(trimmed)) {
      return trimmed;  // Strict mode
    }
    const qualified = qualifiedToCanonical.get(trimmed);
    if (qualified) {
      return qualified;  // Loose mode - accepts non-canonical format
    }
    throw new Error(...);
  };

  Problem: Users can provide either Input:Topic or Topic and both work. This violates the "canonical only" principle.

  ---
  3. formatCanonicalProducerName Does NOT Format a Canonical ID

  Location: core/src/parsing/canonical-ids.ts:15-17

  Badly named function that doesn't produce a canonical ID at all:
  export function formatCanonicalProducerName(namespacePath: string[], producerAlias: string): string {
    return namespacePath.length > 0 ? namespacePath.join('.') : producerAlias;
  }

  Red flags:
  - Returns namespacePath.join('.') when namespace exists, ignoring the producerAlias entirely
  - Returns just producerAlias when no namespace
  - This is NOT a canonical ID (no Producer: prefix)
  - Name is misleading


  ---
  4. Embedded Dimension Indices in "Canonical" IDs

  Location: core/src/resolution/canonical-expander.ts:613-626

  IDs include runtime indices:
  function formatCanonicalNodeId(node, indices): string {
    const baseId = formatCanonicalInputId(...);
    const suffix = node.dimensions.map((symbol) => `[${indices[symbol]}]`).join('');
    return `${baseId}${suffix}`;  // e.g., "Artifact:Image[0][1]"
  }

  Problem: IDs like Artifact:SegmentImage[segment=0][image=0] embed runtime state. These aren't "canonical" - they're instance
  IDs. The terminology is confusing.

  ---
  5. Scattered startsWith('Artifact:') / startsWith('Input:') Checks

  Locations:
  - core/src/planning/planner.ts:94,123,339
  - core/src/resolution/canonical-expander.ts:365
  - core/src/artifact-resolver.ts:82

  The same validation is repeated 10+ times:
  // planner.ts:94
  const artefactInputs = node.inputs.filter((input) => input.startsWith('Artifact:'));

  // planner.ts:123
  const producesMissing = info.node.produces.some(
    (id) => id.startsWith('Artifact:') && manifest.artefacts[id] === undefined,
  );

  // planner.ts:339
  if (!input.startsWith('Input:')) { return null; }

  Problem: No centralized validator function. If prefix changes, all locations need updating.

  ---
  🟠 Fallback / Guessing Patterns (RED FLAGS)

  6. lastIndexOf('.') Extraction Without Validation

  Location: core/src/parsing/input-loader.ts:146-148, 391-393

  const producerName = selection.producerId.includes('.')
    ? selection.producerId.slice(selection.producerId.lastIndexOf('.') + 1)
    : selection.producerId;

  Problems:
  - Silent fallback: if no ., uses entire string
  - No validation that extracted name is valid
  - What if producer name contains a dot? (e.g., my.producer in a namespace)

  7. Regex-Based Kind Extraction

  Location: core/src/artifact-resolver.ts:80-88

  export function extractArtifactKind(artifactId: string): string {
    const withoutPrefix = artifactId.replace(/^(Artifact|Input):/, '');
    const kind = withoutPrefix.replace(/\[.*?\]/g, '');
    return kind;
  }

  Problems:
  - Strips prefix via regex
  - Strips dimensions via regex
  - No validation that result is valid
  - Fragile if format changes

  8. Lossy Producer Normalization in CLI

  Location: cli/src/lib/friendly-view.ts:170-177

  function normalizeProducer(producedBy: string | undefined): string {
    if (!producedBy) {
      return 'unknown-producer';  // FALLBACK
    }
    const parts = producedBy.split(':');
    const candidate = parts[parts.length - 1] ?? producedBy;  // FALLBACK
    return candidate.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/--+/g, '-').toLowerCase();
  }

  Problems:
  - Returns 'unknown-producer' if missing
  - Splits on : and takes last part
  - Sanitizes to filesystem-safe name, losing namespace info
  - Producer:images.Generator and Producer:videos.Generator both become generator

  9. toFriendlyFileName Strips Namespace

  Location: cli/src/lib/friendly-view.ts:179-193

  function toFriendlyFileName(artefactId: string, mimeType?: string): string {
    const trimmed = artefactId.replace(/^Artifact:/, '').trim();
    const withoutNamespace = trimmed.includes('.')
      ? trimmed.slice(trimmed.lastIndexOf('.') + 1)
      : trimmed;
    // ...
  }

  Problem: Intentionally strips namespace, causing collision risk.

  ---
  🟡 Over-Engineering / Unnecessary Complexity

  10. Complex Dimension Symbol Format

  Location: core/src/resolution/canonical-graph.ts:229-234

  function formatDimensionSlot(nodeId: string, slot: DimensionSlot): string {
    const scopeLabel = slot.scope === 'namespace'
      ? `ns:${slot.scopeKey || '__root__'}`
      : `local:${slot.scopeKey}`;
    return `${nodeId}::${scopeLabel}:${slot.ordinal}:${slot.raw}`;
  }

  Creates symbols like:
  ScriptGenerator.Script::ns:ScriptGenerator:0:i

  Problems:
  - 4-5 levels of delimiter nesting (:, ::)
  - Magic string __root__ for empty namespace
  - Parsing requires multiple splits and knowledge of format
  - extractDimensionLabel() at line 657 does symbol.split(':') and takes last element

  11. Producer-Scoped Input IDs Are Ambiguous

  Location: core/src/parsing/canonical-ids.ts:103-110

  export function formatProducerScopedInputId(
    namespacePath: string[],
    producerName: string,
    key: string,
  ): string {
    const producerSegments = formatCanonicalProducerName(namespacePath, producerName).split('.');
    return formatCanonicalId('Input', [...producerSegments, key]);
  }

  Creates: Input:Namespace.Producer.apiKey

  Problem: Without knowing all producer names upfront, you can't parse this:
  - Is it Producer=Namespace.Producer, Input=apiKey?
  - Or Producer=Namespace, Input=Producer.apiKey?

  This is demonstrated in matchProducerScopedKey at input-loader.ts:351-365 which iterates all known producers to figure out where
   to split:

  function matchProducerScopedKey(body: string, index: ProducerIndex) {
    for (const [qualified, entry] of index.byQualified) {
      if (body.startsWith(`${qualified}.`)) {  // Try each producer!
        return { producerId: qualified, keyPath: body.slice(qualified.length + 1) };
      }
    }
    return null;
  }

  12. nodeId() Function Does NOT Return a Canonical ID

  Location: core/src/resolution/canonical-graph.ts:522-527

  function nodeId(namespacePath: string[], name: string): string {
    if (namespacePath.length === 0) {
      return name;
    }
    return `${namespacePath.join('.')}.${name}`;
  }

  Problem: Returns qualified name without type prefix. NOT a canonical ID despite being used as node identifiers.

  ---
  📋 Summary Table

  | Issue                              | Severity | Location                  | Problem                          |
  |------------------------------------|----------|---------------------------|----------------------------------|
  | No isCanonicalProducerId()         | High     | canonical-ids.ts          | Incomplete API                   |
  | Dual resolution mode               | High     | canonical-ids.ts:82       | Accepts non-canonical input      |
  | formatCanonicalProducerName naming | High     | canonical-ids.ts:15       | Misleading name, wrong output    |
  | lastIndexOf('.') extraction        | High     | input-loader.ts:146       | Fallback without validation      |
  | Scattered prefix checks            | Medium   | planner.ts, expander.ts   | No central validator             |
  | Lossy producer normalization       | High     | friendly-view.ts:170      | Namespace info lost              |
  | Complex dimension symbols          | Medium   | canonical-graph.ts:229    | Over-engineered format           |
  | Producer-scoped ID ambiguity       | High     | canonical-ids.ts:103      | Requires producer index to parse |
  | nodeId() misnamed                  | Medium   | canonical-graph.ts:522    | Returns qualified, not canonical |
  | Embedded indices in IDs            | Medium   | canonical-expander.ts:619 | IDs contain runtime state        |
  | Regex-based kind extraction        | Medium   | artifact-resolver.ts:82   | Fragile parsing                  |
  | 'unknown-producer' fallback        | Medium   | friendly-view.ts:171      | Silent degradation               |

  ---
  Recommendations

  1. Define a formal canonical ID grammar with clear BNF
  2. Create proper parsers (not just formatters) for each ID type
  3. Single source of truth for validation - one set of is*() and validate*() functions
  4. Strict-mode only - remove all fallback logic that accepts non-canonical forms
  5. Separate instance IDs from canonical IDs - don't embed [0] indices in "canonical" format
  6. Rename formatCanonicalProducerName - it's not canonical, call it formatQualifiedProducerName
  7. Add proper error messages - when parsing fails, explain what format was expected
  8. Consider structured ID type instead of strings - CanonicalId { type, namespace, name } object


  Incremental Plan: Canonical ID System Cleanup

  Philosophy

  1. Convert to canonical IDs at parse time - YAML parsing should immediately convert all references to canonical IDs
  2. No fallbacks, no guessing - If something doesn't exist, throw an error
  3. Clear terminology - Replace vague names like "qualifiedName" with precise ones
  4. Dead code removal only after verification - Confirm dead before deleting

  ---
  Phase 1: Foundation - Canonical ID Module Cleanup

  Goal: Establish a solid canonical ID API that all other code can depend on.

  Step 1.1: Add Missing Validators and Parsers

  File: core/src/parsing/canonical-ids.ts

  Add:
  // Validators
  export function isCanonicalProducerId(value: string): boolean
  export function isCanonicalId(value: string): boolean  // any type

  // Parsers (throw on invalid)
  export function parseCanonicalInputId(id: string): { namespace: string[]; name: string }
  export function parseCanonicalArtifactId(id: string): { namespace: string[]; name: string; indices: number[] }
  export function parseCanonicalProducerId(id: string): { namespace: string[]; name: string }

  // Strict validation (throws with clear message)
  export function assertCanonicalInputId(value: string): void
  export function assertCanonicalArtifactId(value: string): void
  export function assertCanonicalProducerId(value: string): void

  Tests to add: core/src/parsing/canonical-ids.test.ts (new file)
  - Test each validator with valid/invalid inputs
  - Test each parser extracts correct parts
  - Test assertions throw with clear messages

  Step 1.2: Rename formatCanonicalProducerName

  Current problem: Returns namespace.join('.') or just producerAlias, NOT a canonical ID.

  Rename to: formatProducerPath (since it creates the path portion, not the full canonical ID)

  Update all call sites - use grep to find them.

  Step 1.3: Fix formatCanonicalProducerId Logic Bug

  Current code (line 19-21):
  export function formatCanonicalProducerId(namespacePath: string[], producerAlias: string): string {
    return formatCanonicalId('Producer', formatCanonicalProducerName(namespacePath, producerAlias).split('.'));
  }

  Problem: When namespacePath is non-empty, formatCanonicalProducerName ignores producerAlias!

  Fix: Properly join namespace + producer name.

  ---
  Phase 2: Remove Dual Resolution Mode

  Goal: InputIdResolver.resolve() should ONLY accept canonical IDs.

  Step 2.1: Audit Current Usage of InputIdResolver

  Search for all places that call resolver.resolve(key) to understand what format key is in.

  Step 2.2: Convert Input Keys at YAML Parse Time

  In loadInputsFromYaml and related functions, convert all input keys to canonical form immediately upon reading:
  - If key is already canonical (Input:Foo), validate it
  - If key is short form (Foo), convert to canonical and then validate
  - Store only canonical IDs

  Step 2.3: Make InputIdResolver.resolve() Strict

  Remove the fallback path that accepts non-canonical names:
  const resolve = (key: string): string => {
    if (!isCanonicalInputId(key)) {
      throw new Error(`Expected canonical input ID, got "${key}". Use Input:name format.`);
    }
    if (!canonicalIds.has(key)) {
      throw new Error(`Unknown canonical input id "${key}".`);
    }
    return key;
  };

  ---
  Phase 3: Eliminate Ad-Hoc String Manipulation

  Step 3.1: Replace lastIndexOf('.') Extractions

  Locations:
  - core/src/parsing/input-loader.ts:146-148
  - core/src/parsing/input-loader.ts:391-393

  Replace with: Proper parsing using the new parseCanonicalProducerId() or storing namespace + name as structured data.

  Step 3.2: Replace Scattered startsWith() Checks

  Create centralized functions:
  export function getCanonicalIdType(id: string): 'Input' | 'Artifact' | 'Producer' | null

  Update locations:
  - core/src/planning/planner.ts:94,123,339
  - core/src/resolution/canonical-expander.ts:365
  - core/src/artifact-resolver.ts:82

  Step 3.3: Fix extractArtifactKind in artifact-resolver.ts

  Replace regex-based extraction with proper parser:
  export function extractArtifactKind(artifactId: string): string {
    const parsed = parseCanonicalArtifactId(artifactId);
    return [...parsed.namespace, parsed.name].join('.');
  }

  ---
  Phase 4: Fix Naming Throughout

  Goal: Replace vague names with clear ones.

  Step 4.1: Rename Terminology

  | Old Name                    | New Name                 | Reason                   |
  |-----------------------------|--------------------------|--------------------------|
  | qualifiedName               | producerPath or nodePath | "Qualified" is ambiguous |
  | formatCanonicalProducerName | formatProducerPath       | It's not canonical       |
  | namespacePath               | Keep as-is               | Actually clear           |
  | canonicalId                 | Keep as-is               | Correct usage            |

  Step 4.2: Update ProducerIndex Structure

  Current:
  interface ProducerIndex {
    byQualified: Map<string, { namespacePath: string[]; producerName: string; qualifiedName: string }>;
  }

  New:
  interface ProducerIndex {
    byPath: Map<string, { namespace: string[]; name: string; path: string; canonicalId: string }>;
  }

  ---
  Phase 5: Fix CLI Lossy Transformations

  Step 5.1: Fix normalizeProducer in friendly-view.ts

  Current issue: Strips namespace, causing collisions.

  Options:
  1. Include namespace in directory structure: movies/movieId/namespace.producer/artifact.png
  2. Use hash suffix when collisions detected
  3. Flatten namespace with separator: movies/movieId/namespace-producer/artifact.png

  Recommendation: Option 3 - replace . with - to preserve uniqueness.

  Step 5.2: Fix toFriendlyFileName

  Same issue - preserve namespace information.

  Step 5.3: Remove 'unknown-producer' Fallback

  Replace with throwing an error - if producer is missing, that's a bug.

  ---
  Phase 6: Verify and Remove Dead Code

  Step 6.1: Verify formatDimensionSlot Usage

  Location: core/src/resolution/canonical-graph.ts:229-234

  You mentioned this is dead code. Verify by:
  1. Search for all callers of formatDimensionSlot
  2. Search for ::ns: and ::local: patterns in tests
  3. If truly dead, remove the entire dimension symbol format system

  Step 6.2: Remove Unused Dimension Symbol Helpers

  If Step 6.1 confirms dead:
  - Remove formatDimensionSlot
  - Remove extractDimensionLabel in canonical-expander.ts:657
  - Remove makeNamespaceSlot
  - Simplify dimension handling throughout

  ---
  Phase 7: Harden Producer-Scoped Input IDs

  Step 7.1: Eliminate Ambiguous Parsing

  Current problem: Input:Namespace.Producer.apiKey requires knowing all producers to parse.

  Solution options:
  1. Explicit delimiter: Input:Namespace.Producer::apiKey (use :: between producer and key)
  2. Structured during creation: Store { producerCanonicalId, inputKey } instead of flattening to string
  3. Reverse order: Input:apiKey@Namespace.Producer

  Recommendation: Option 1 - add :: delimiter for producer-scoped inputs.

  Step 7.2: Update formatProducerScopedInputId

  export function formatProducerScopedInputId(
    namespace: string[],
    producerName: string,
    inputKey: string,
  ): string {
    const producerPath = formatProducerPath(namespace, producerName);
    return `Input:${producerPath}::${inputKey}`;
  }

  Step 7.3: Add Parser for Producer-Scoped Input IDs

  export function parseProducerScopedInputId(id: string): {
    producerPath: string;
    inputKey: string;
  } | null {
    // Parse Input:Namespace.Producer::inputKey format
  }

  ---
  Phase 8: Add Comprehensive Tests

  Step 8.1: Unit Tests for Canonical ID Module

  File: core/src/parsing/canonical-ids.test.ts

  Test cases:
  - All formatters produce valid canonical IDs
  - All parsers extract correct components
  - Round-trip: format → parse → format produces same result
  - Invalid inputs throw with clear messages
  - Edge cases: empty namespace, single segment, maximum depth

  Step 8.2: Integration Tests for Strict Mode

  File: core/src/parsing/strict-canonical.test.ts

  Test cases:
  - YAML with non-canonical input keys fails with clear error
  - YAML with unknown inputs fails
  - YAML with canonical IDs works
  - No fallbacks anywhere in the pipeline

  Step 8.3: Snapshot Tests for Canonical IDs

  Update existing snapshot tests to verify canonical ID format stability.

  ---
  Execution Order

  | Phase | Risk   | Effort | Dependencies      |
  |-------|--------|--------|-------------------|
  | 1     | Low    | Medium | None              |
  | 2     | Medium | Medium | Phase 1           |
  | 3     | Medium | Low    | Phase 1           |
  | 4     | Low    | Low    | Phase 1           |
  | 5     | Low    | Low    | Phase 1, 4        |
  | 6     | Medium | Low    | Must verify first |
  | 7     | High   | Medium | Phase 1, 2, 3     |
  | 8     | Low    | Medium | All phases        |

  Suggested order: 1 → 4 → 3 → 2 → 5 → 6 → 7 → 8

  ---
  Testing Strategy Per Phase

  For each phase:
  1. Run existing tests first - pnpm test
  2. Add new tests before changing code - test the current behavior
  3. Make the change
  4. Update tests to expect new behavior
  5. Run type-check - pnpm check
  6. Run all tests - pnpm test
  7. Run e2e tests - ensure blueprints still work