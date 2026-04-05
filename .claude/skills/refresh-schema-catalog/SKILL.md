---
name: refresh-schema-catalog
description: Refresh Fal and Replicate model schemas while preserving local override patches and resolving drift safely.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion
---

# Refresh Schema Catalog (Fal + Replicate)

Use this workflow when refreshing schema files under `catalog/models/**`.

The key rule: **Never hand-edit generated schema JSON as the source of truth.**
Put durable manual fixes in:

- `catalog/models/fal-ai/schema-overrides.yaml`
- `catalog/models/replicate/schema-overrides.yaml`

## Quick Run

Run drift checks first:

```bash
pnpm catalog:check-fal-diff
pnpm catalog:check-replicate-diff
```

Then apply updates:

```bash
pnpm catalog:update-fal-diff
pnpm catalog:update-replicate-diff
```

## If a model fails with override patch errors

Typical error meaning:

- Upstream schema changed structure (for example, a field renamed).
- Your override path no longer matches.

Resolution steps:

1. Inspect the failing model schema file and locate the new field path.
2. Update the corresponding patch entry in `schema-overrides.yaml`.
3. Re-run only that model:

```bash
node scripts/update-fal-catalog.mjs catalog/models/fal-ai/fal-ai.yaml --update-diff --model=<model-name>
```

or

```bash
node scripts/update-replicate-catalog.mjs catalog/models/replicate/replicate.yaml --update-diff --model=<owner/model>
```

4. Re-run full diff checks to confirm clean state.

## Adding a new durable fix

Example (Fal):

```yaml
version: 1
models:
  - name: qwen-image-2/pro/edit
    type: image
    patches:
      - op: add
        path: /input_schema/properties/image_urls/maxItems
        value: 3
```

Supported patch ops:

- `add`
- `replace`
- `remove`

Patch paths are JSON pointers (must start with `/`).

## Safety behavior

- Batch update continues across models when one model fails.
- Script exits non-zero at the end if any model failed.
- This prevents silent drift while keeping refresh runs practical for large catalogs.
