# Plan: Blob File Inputs in inputs.yaml

## Goal
Allow users to specify blob inputs in `inputs.yaml` using a `file:` prefix. Supports:
1. **User inputs**: Provide blob data for input fields (e.g., reference images)
2. **Artifact overrides**: Replace a previously generated artifact with a user-provided file, triggering downstream regeneration

## Syntax

**Blob input (single):**
```yaml
inputs:
  ImageInput: file:./path/to/image.jpg
```

**Blob inputs (array):**
```yaml
inputs:
  ReferenceImages:
    - file:./img1.jpg
    - file:./img2.png
```

**Override a generated artifact:**
```yaml
inputs:
  # Replace artifact with user-provided file → marks it dirty → downstream re-runs
  ImageProducer.GeneratedImage[0]: file:./replacement-image.jpg
  AudioProducer.SegmentAudio[0]: file:./custom-audio.mp3
```

## How It Works

1. **Input loader**: Detects `file:` prefix, loads file as `BlobInput { data, mimeType }`
2. **Planning**: If the key is an artifact ID (not an input ID), treat it as an artifact override
3. **Dirty tracking**: Artifact overrides mark the artifact as user-provided, triggering dependent producers to re-run

---

## Implementation

### 1. Add `inferMimeType()` to blob-utils.ts

**File:** `core/src/blob-utils.ts`

```typescript
const MIME_TYPE_MAP: Record<string, string> = {
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'webm': 'video/webm',
  'mp4': 'video/mp4',
  'mov': 'video/quicktime',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'webp': 'image/webp',
  'gif': 'image/gif',
  'json': 'application/json',
  'txt': 'text/plain',
};

export function inferMimeType(extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\./, '');
  return MIME_TYPE_MAP[normalized] ?? 'application/octet-stream';
}
```

---

### 2. Add `BlobInput` Type

**File:** `core/src/types.ts`

```typescript
/** Blob loaded from a local file. */
export interface BlobInput {
  data: Buffer;
  mimeType: string;
}

export function isBlobInput(value: unknown): value is BlobInput {
  return typeof value === 'object' && value !== null &&
         'data' in value && 'mimeType' in value &&
         (Buffer.isBuffer((value as BlobInput).data) ||
          (value as BlobInput).data instanceof Uint8Array);
}
```

---

### 3. Create File Input Resolver Module

**File:** `core/src/parsing/file-input-resolver.ts` (NEW)

```typescript
import { readFile } from 'node:fs/promises';
import { resolve, extname, isAbsolute } from 'node:path';
import { inferMimeType } from '../blob-utils.js';
import type { BlobInput } from '../types.js';

const FILE_PREFIX = 'file:';

export function isFileReference(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(FILE_PREFIX);
}

export interface FileResolverContext {
  baseDir: string;
}

/** Load a local file as BlobInput */
export async function resolveFileReference(
  reference: string,
  context: FileResolverContext,
): Promise<BlobInput> {
  const filePath = reference.slice(FILE_PREFIX.length);
  const absolutePath = isAbsolute(filePath)
    ? filePath
    : resolve(context.baseDir, filePath);

  try {
    const data = await readFile(absolutePath);
    const mimeType = inferMimeType(extname(absolutePath));
    return { data, mimeType };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load file "${filePath}": ${msg}`);
  }
}

/** Recursively resolve file references in a value */
export async function resolveFileReferences(
  value: unknown,
  context: FileResolverContext,
): Promise<unknown> {
  if (isFileReference(value)) {
    return resolveFileReference(value, context);
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((item) => resolveFileReferences(item, context)));
  }
  return value;
}
```

---

### 4. Integrate into Input Loader

**File:** `core/src/parsing/input-loader.ts`

```typescript
import { dirname } from 'node:path';
import { resolveFileReferences } from './file-input-resolver.js';

export async function loadInputsFromYaml(...): Promise<LoadedInputs> {
  // ... existing code through line 71 ...

  applyModelSelectionsToInputs(values, modelSelections);

  // Resolve file: references to BlobInput objects
  const fileContext = { baseDir: dirname(filePath) };
  const resolvedValues = await resolveAllFileReferences(values, fileContext);

  return { values: resolvedValues, modelSelections };
}

async function resolveAllFileReferences(
  values: Record<string, unknown>,
  context: { baseDir: string },
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = await resolveFileReferences(value, context);
  }
  return resolved;
}
```

---

### 5. Export New Module

**File:** `core/src/index.ts`

```typescript
export * from './parsing/file-input-resolver.js';
export { isBlobInput } from './types.js';
```

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| `core/src/blob-utils.ts` | Modify | Add `inferMimeType()` |
| `core/src/types.ts` | Modify | Add `BlobInput` type and `isBlobInput()` guard |
| `core/src/parsing/file-input-resolver.ts` | Create | File loading logic |
| `core/src/parsing/input-loader.ts` | Modify | Integrate file resolution |
| `core/src/index.ts` | Modify | Export new module |
| `core/src/parsing/file-input-resolver.test.ts` | Create | Unit tests |

---

## Data Flow

```
inputs.yaml
  │
  │  ImageInput: file:./image.jpg
  │  AudioProducer.SegmentAudio[0]: file:./custom.mp3
  ▼
input-loader.ts (loadInputsFromYaml)
  │ resolveFileReferences()
  ▼
{
  "Input:ImageInput": BlobInput { data, mimeType: 'image/jpeg' },
  "Input:AudioProducer.SegmentAudio[0]": BlobInput { data, mimeType: 'audio/mpeg' }
}
  │
  ▼
Planning detects artifact override key → marks dirty → re-runs downstream
  │
  ▼
providers/runtime.ts (buildPayload)
  │ isBlobInput() → upload to S3
  ▼
Signed URLs sent to provider SDK
```

---

## Testing

**Unit tests** (`file-input-resolver.test.ts`):
- `isFileReference()` detection
- Single file loading with MIME inference
- Array of files resolution
- Error handling for missing files
- Absolute vs relative paths

**Integration tests** (`input-loader.test.ts`):
- End-to-end: inputs.yaml with `file:` → BlobInput in loaded values
