 # Full Core Consolidation for Blueprint Graph Parsing + Loop-Indexed Inputs UX

  ## Summary

  - Move viewer parse-graph construction fully into core and expose it as a core service consumed by viewer server.
  - Remove viewer-server custom graph parsing/walking logic for blueprint references.
  - Implement loop-indexed grouped inputs UI (text + media + other looped inputs) with synchronized add/remove and automatic counter updates.
  - Keep existing behavior for non-looped multivalue inputs such as StyleReferenceImages.

  ## Non-Negotiable Engineering Constraints

  - Layered architecture:
      - All graph parsing logic lives in core services. Viewer and CLI are thin wrappers to those services.
      - cli only parses flags and renders output; viewer only captures UI state and calls server APIs.
  - Error architecture:
      - Use numbered core error codes for all invalid combinations and invalid producer/count/dependency cases.
      - Fail fast; no silent fallback, no implicit substitution, no guessing.
  - Always use Canonical IDs internally. Aliases are only allowed in the user inputs and they should be parsed immediately and converted into Canonical IDs. Do not pass around aliases, alternatives to canonical ids. Use the common canonical id functions when needed.
  - Fixture discipline:
      - Integration/E2E tests use package-owned fixtures only.
      - No cross-package fixture dependency.
      - No tests referencing catalog blueprints; use targeted, explicitly named local fixture blueprints.

  ## Public API and Contract Changes

  - Add a new core-exported parse projection service that returns the payload used by /viewer-api/blueprints/parse.
  - Keep existing parse payload fields (meta, nodes, edges, inputs, outputs, conditions, layerAssignments, layerCount) stable.
  - Add loopGroups to parse payload, where each group includes groupId, primaryDimension, countInput, countInputOffset, and members.
  - Add managedCountInputs to parse payload for count inputs that must be hidden in “Other Inputs”.
  - Extend ProducerBinding payload with structured endpoint metadata for source and target (endpoint kind, producer/input/output names, loop selectors, constant
    selectors, collection selectors).
  - Enforce fail-fast errors in core for invalid/ambiguous loop grouping metadata (no silent fallback).

  ## Implementation Changes

  - Create a core module in core/src/resolution that owns viewer parse projection and uses core graph services instead of viewer-local parsing.
  - Refactor shared reference parsing so buildBlueprintGraph and the new projection service reuse the same core parsing helpers.
  - Replace viewer/server/blueprints/graph-converter.ts usage in parse flow with the new core service; keep parse handler as a thin adapter only.
  - Derive loop groups in core from canonical loop metadata plus producer-input binding selectors.
  - Use the outer selector as primary dimension for multi-dimension refs (example: Prompt[scene][shot] groups by scene).
  - Exclude non-looped multivalue inputs from loop groups so they stay on existing UI paths.
  - Update InputsPanel to render indexed grouped sections with reusable container/presenter components for text and media cards.
  - Implement indexed controls per group: previous/next navigation, 1-based index display, add, remove-last (trash).
  - Allow add/remove only at last index and only when editable.
  - Apply add/remove across all members in the same group atomically.
  - Auto-update managed counter input with count = groupLength - countInputOffset.
  - Enforce minimum group length of 1.
  - Auto-normalize mismatched member lengths/counter to max member length and show a dismissible warning.
  - Hide only managed count inputs from “Other Inputs”.
  - Update viewer-side binding consumers (artifact-prompt-resolver, audio-input-binding-resolver) to consume structured binding endpoint metadata instead of regex
    parsing.

  ## Test Plan

  - Add core unit tests for parse projection parity against current viewer semantics (nodes/edges/layers/bindings).
  - Add core unit tests for loop-group derivation on style-cartoon-alt and celebrity-then-now blueprints.
  - Add core unit tests for countInputOffset behavior and outer-dimension grouping for multi-dimension selectors.
  - Add core unit tests that ambiguous loop-group derivation fails with explicit errors.
  - Replace viewer server converter-focused tests with parse-handler contract tests validating core delegation and response shape.
  - Add viewer UI tests for grouped navigation, add/remove synchronization, min=1 enforcement, counter auto-update, and mismatch auto-fix warning behavior.
  - Add viewer UI tests confirming managed counters are hidden only when grouped-management applies.
  - Add viewer UI tests confirming ungrouped multivalue inputs retain existing behavior.
  - Add tests for artifact/audio binding resolution using structured binding metadata.
  - Run manual acceptance on /Users/keremk/videos/style-cartoon-alt/style-cartoon-alt.yaml and /Users/keremk/videos/celebrity-then-now/celebrity-then-now.yaml.

  ## Assumptions and Defaults

  - This change includes full parse-graph consolidation now (not phased) per your “Full now” decision.
  - Auto-fix policy is normalize-to-max with dismissible warning.
  - Minimum loop-group size is 1.
  - Only managed loop counters are hidden from “Other Inputs”.
  - No fallback behavior is introduced for missing loop/binding metadata; invalid setups fail fast with descriptive errors.
