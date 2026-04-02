# Canonical ID Fallback Checklist (Post-Purge)

Updated: 2026-04-02

## Scope and Rule

- User-authored ingress may use non-canonical IDs:
  - blueprint YAML
  - inputs YAML
  - producer YAML/model config authored values
- Immediately after ingress parsing, IDs must be canonicalized.
- Runtime/planning/provider execution paths must consume canonical IDs only.
- No alias/self/default fallback in runtime resolution paths.

## Grep Audit (Current)

Command family used:

```bash
rg -n --glob '*.{ts,tsx,js,mjs}' --glob '!**/*.test.*' --glob '!**/dist/**' --glob '!**/node_modules/**' \
"inputBindings\?\.\[[^\]]+\]\s*\?\?\s*|inputBindings\[[^\]]+\]\s*\?\?\s*|canonicalizeAuthoredInputId\(|buildUnqualifiedInputAliases\(|toCanonical\(|isArtifactOverrideKey\(|toCanonicalArtifactId\(|replace\(/\^\(Artifact\|Input\):/|startsWith\('Input:'\)\s*\?|startsWith\('Artifact:'\)\s*\?|whenPath\.startsWith\('Artifact:'\)|resolveConditionArtifactId\(" \
core providers viewer cli scripts
```

Counts:

- source (non-test, non-dist): `19`
- source + tests (non-dist): `39`
- full repo scan set (same pattern family): `39`

Interpretation:

- Runtime canonical fallback patterns from the original list are removed.
- Remaining hits are ingress canonicalizers and strict canonical helpers/checks.

## Original Runtime Checklist Status

| ID | Site | Previous issue | Status |
|---|---|---|---|
| CF-001 | `providers/src/producers/llm/openai.ts` | `inputBindings?.[variable] ?? variable` | Fixed |
| CF-002 | `providers/src/producers/llm/vercel-ai-gateway.ts` | same as CF-001 | Fixed |
| CF-003 | `core/src/artifact-resolver.ts` | non-canonical `resolvedByKind` keyspace | Fixed |
| CF-004 | `core/src/artifact-resolver.ts` | prefix-stripped resolved keys | Fixed |
| CF-005 | `core/src/artifact-resolver.ts` | prefix tolerance in artifact kind extraction | Fixed |
| CF-006 | `core/src/artifact-resolver.ts` | `Artifact:` strip fallback formatter | Fixed |
| CF-007 | `core/src/runner.ts` | prefixless lookup fallback | Fixed |
| CF-008 | `core/src/runner.ts` | dimensionless lookup fallback | Fixed |
| CF-009 | `providers/src/sdk/config-utils.ts` | authored-ID heuristic | Fixed to deterministic canonical resolution |
| CF-010 | `providers/src/producers/timeline/ordered-timeline.ts` | consumed CF-009 heuristic | Fixed (strict producerAlias-aware canonicalization) |
| CF-011 | `viewer/server/blueprints/sdk-preview-handler.ts` | unqualified alias injection | Fixed |
| CF-012 | `viewer/server/blueprints/sdk-preview-handler.ts` | `buildUnqualifiedInputAliases` | Fixed |
| CF-020 | `core/src/planning/planner.ts` | condition path prefix tolerance | Fixed (strict canonical at runtime) |
| CF-021 | `core/src/resolution/producer-graph.ts` | condition path prefix tolerance | Fixed (strict canonical) |
| CF-022 | `providers/src/sdk/unified/ffmpeg-image-splitter.ts` | artifact prefix optional | Fixed |
| CF-023 | `providers/src/sdk/unified/ffmpeg-extractor.ts` | artifact prefix optional | Fixed |
| CF-024 | `viewer/server/builds/manifest-handler.ts` | input prefix optional | Fixed |
| CF-025 | `viewer/server/builds/manifest-handler.ts` | artifact prefix optional | Fixed |
| CF-026 | `viewer/server/builds/manifest-handler.ts` | second artifact prefix tolerance | Fixed |
| CF-027 | `viewer/server/builds/artifact-edit-handler.ts` | artifact prefix optional | Fixed |
| CF-028 | `viewer/server/builds/artifact-recheck-handler.ts` | artifact prefix optional | Fixed |

Additional runtime strictness added:

| ID | Site | Issue | Status |
|---|---|---|---|
| CF-029 | `providers/src/sdk/payload-builder.ts` | alias/self fallback in required-input errors | Fixed (binding must exist + be canonical) |
| CF-030 | `core/src/condition-evaluator.ts` | accepted non-canonical `when` at runtime | Fixed (canonical Artifact required) |
| CF-031 | `providers/src/sdk/transforms.ts` | allowed non-canonical binding IDs during transforms | Fixed (canonical binding assertion) |
| CF-032 | `providers/src/producers/transcription/transcription-handler.ts` | delegated STT job used non-canonical input IDs | Fixed (delegated bindings/resolvedInputs canonicalized) |

## Remaining Canonical/Non-Canonical Sites (Intentional Ingress Canonicalization)

These are intentionally kept to preserve human-readable authored files while enforcing canonical IDs internally.

| ID | Site | Behavior | Class | Status |
|---|---|---|---|---|
| IN-001 | `core/src/parsing/canonical-ids.ts` (`toCanonical`) | Converts authored keys to canonical IDs | Ingress canonicalizer | Kept intentionally |
| IN-002 | `core/src/parsing/input-loader.ts` (`canonicalizeInputs`) | Canonicalizes user keys from inputs YAML | Ingress canonicalizer | Kept intentionally |
| IN-003 | `core/src/parsing/input-loader.ts` (`isArtifactOverrideKey` / `toCanonicalArtifactId`) | Accepts authored artifact override forms and canonicalizes | Ingress canonicalizer | Kept intentionally |
| IN-004 | `core/src/parsing/input-serializer.ts` (strip `Input:`) | Writes human-readable keys in YAML output | Ingress/UX serializer | Kept intentionally |
| IN-005 | `core/src/parsing/input-serializer.ts` (`mergeInputValues`) | Merges canonical + clean key forms for authored files | Ingress/UX serializer | Kept intentionally |
| IN-006 | `providers/src/sdk/config-utils.ts` (`canonicalizeAuthoredInputId`) | Canonicalizes authored timeline clip input names deterministically | Producer-config ingress canonicalizer | Kept intentionally |
| IN-007 | `providers/src/producers/timeline/ordered-timeline.ts` | Applies IN-006 to authored timeline clips | Producer-config ingress consumer | Kept intentionally |
| IN-008 | `viewer/server/blueprints/sdk-preview-handler.ts` (`resolver.toCanonical`) | Canonicalizes preview API input payload keys | API ingress canonicalizer | Kept intentionally |
| IN-009 | `core/src/parsing/blueprint-loader/yaml-parser.ts` (`canonicalizeConditionWhenPath`) | Canonicalizes authored condition `when` paths at parse ingress | Blueprint ingress canonicalizer | Added intentionally |

## Validation

Executed successfully:

- `pnpm check` (repo root)
- `cd core && pnpm vitest run src/condition-evaluator.test.ts src/parsing/blueprint-loader/yaml-parser.test.ts src/planning/planner.test.ts src/resolution/producer-graph.test.ts --pool=threads --poolOptions.threads.singleThread`
- `cd providers && pnpm vitest run src/sdk/runtime.test.ts src/sdk/transforms.test.ts src/producers/transcription/transcription-handler.test.ts src/producers/llm/openai.test.ts src/producers/llm/vercel-ai-gateway.test.ts --config vitest.config.ts --pool=threads`

