# Plan: Make OpenAI Provider Dry-Run Equivalent to Live

## Goal

Make the `--dry-run` execution path for OpenAI providers identical to live mode, with the only difference being that the final HTTP call to the OpenAI API is intercepted and returns mock data. This ensures dry-run validates all the same code paths as live execution.

## Current State

### How Mode Switching Works Today

The mode is set in `cli/src/lib/build.ts:122`:
```typescript
const registry = createProviderRegistry({
  mode: dryRun ? 'simulated' : 'live',
  ...
});
```

### Current Divergence Points in OpenAI Provider

| Code Location | Live Mode | Simulated Mode |
|--------------|-----------|----------------|
| `openai.ts:29-31` | Calls `clientManager.ensure()` | Early return (skips) |
| `client.ts:14-50` | Creates real OpenAI client with API key | Never called |
| `openai.ts:91-102` | Calls `generateText()`/`generateObject()` | Calls `simulateOpenAiGeneration()` |
| `simulation.ts` | Not used | Generates mock data from schema |

### Problems with Current Approach

1. **Config validation skipped**: Schema and config errors only surface in live mode
2. **Prompt rendering not validated**: Variable substitution issues not caught
3. **Input binding resolution not tested**: Missing inputs not detected
4. **Response format validation skipped**: JSON schema validation errors hidden
5. **Downstream processing errors hidden**: Artifact building issues not caught
6. **Credentials not validated**: API key issues only found in live runs

## Proposed Solution

### Architecture: Intercept at the HTTP Layer

Instead of branching early with `if (isSimulated)`, run the **entire live code path** and intercept only at the final API call:

```
Live Mode:
  parse config → render prompts → validate → initialize client → call API → process response

Dry-Run Mode (Proposed):
  parse config → render prompts → validate → initialize client → [INTERCEPT] → process mock response
                                                                      ↑
                                                              Return mock instead of HTTP call
```

### Implementation Strategy

Use the Vercel AI SDK's built-in testing capabilities. The AI SDK providers accept a `fetch` option that can be replaced with a mock implementation.

```typescript
// providers/src/sdk/openai/client.ts
const openai = createOpenAI({
  apiKey,
  fetch: mode === 'simulated' ? createMockFetch() : undefined,
});
```

This approach:
- Runs all validation and preparation code
- Only intercepts the actual HTTP call
- Returns properly structured mock responses
- Maintains full code path equivalence

## Files to Modify

| File | Change |
|------|--------|
| `providers/src/sdk/openai/client.ts` | Add mock fetch injection for simulated mode |
| `providers/src/sdk/openai/mock-fetch.ts` | **NEW**: Mock fetch implementation returning valid OpenAI response shapes |
| `providers/src/producers/llm/openai.ts` | Remove early exit in `warmStart`, remove `simulateOpenAiGeneration()` branch |
| `providers/src/sdk/openai/simulation.ts` | Refactor to work within mock fetch responses |

## Detailed Implementation

### Step 1: Create Mock Fetch Implementation

**File:** `providers/src/sdk/openai/mock-fetch.ts` (NEW)

```typescript
import type { ProviderMode } from '../../types.js';

interface MockFetchOptions {
  mode: ProviderMode;
}

/**
 * Creates a mock fetch function that intercepts OpenAI API calls
 * and returns properly structured mock responses.
 */
export function createMockFetch(options: MockFetchOptions): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    // Parse the request to understand what endpoint is being called
    const body = init?.body ? JSON.parse(init.body as string) : {};

    // Generate appropriate mock response based on endpoint
    if (url.includes('/chat/completions')) {
      return createMockChatCompletionResponse(body);
    }

    // Fallback for unknown endpoints
    return new Response(JSON.stringify({ error: 'Unknown endpoint' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

function createMockChatCompletionResponse(requestBody: Record<string, unknown>): Response {
  const responseFormat = requestBody.response_format as { type?: string; json_schema?: unknown } | undefined;

  let content: string;
  if (responseFormat?.type === 'json_schema' && responseFormat.json_schema) {
    // Generate mock JSON matching the schema
    content = JSON.stringify(generateMockFromSchema(responseFormat.json_schema));
  } else {
    // Plain text response
    content = `[Simulated response for model: ${requestBody.model}]`;
  }

  const mockResponse = {
    id: `chatcmpl-mock-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: requestBody.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content,
      },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };

  return new Response(JSON.stringify(mockResponse), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function generateMockFromSchema(schema: unknown): unknown {
  // Reuse logic from existing simulation.ts
  // ... (move schema-based mock generation here)
}
```

### Step 2: Modify Client Manager

**File:** `providers/src/sdk/openai/client.ts`

```typescript
// Current code (lines 14-50):
async ensure() {
  if (client) return client;

  if (mode === 'simulated') {
    client = createMockOpenAiClient();  // ← REMOVE THIS BRANCH
    return client;
  }

  const apiKey = await secretResolver.getSecret('OPENAI_API_KEY');
  client = createOpenAI({ apiKey });
  return client;
}

// Proposed change:
async ensure() {
  if (client) return client;

  // Get API key - in simulated mode, use a placeholder if not available
  let apiKey: string;
  if (mode === 'simulated') {
    try {
      apiKey = await secretResolver.getSecret('OPENAI_API_KEY');
    } catch {
      apiKey = 'sk-simulated-dry-run-key';  // Placeholder for dry-run
    }
  } else {
    apiKey = await secretResolver.getSecret('OPENAI_API_KEY');
  }

  client = createOpenAI({
    apiKey,
    fetch: mode === 'simulated' ? createMockFetch({ mode }) : undefined,
  });
  return client;
}
```

### Step 3: Remove Early Exit from OpenAI Handler

**File:** `providers/src/producers/llm/openai.ts`

```typescript
// Current warmStart (lines 28-31):
warmStart: async () => {
  if (isSimulated) {
    return;  // ← REMOVE THIS EARLY EXIT
  }
  await clientManager.ensure();
}

// Proposed change:
warmStart: async () => {
  await clientManager.ensure();  // Always initialize, mock fetch handles simulation
}

// Current invoke (lines 91-102):
if (isSimulated) {
  return simulateOpenAiGeneration(...);  // ← REMOVE THIS BRANCH
}
const result = await generateText(...);

// Proposed change:
const result = await generateText(...);  // Same path for both modes
```

### Step 4: Update Handler Factory

**File:** `providers/src/producers/llm/openai.ts`

Ensure the client manager receives the mode so it can inject mock fetch:

```typescript
export function createOpenAiHandler(init: HandlerFactoryInit): ProducerHandler {
  const { domain, mode, logger, secretResolver } = init;
  const isSimulated = mode === 'simulated';

  const clientManager = createOpenAiClientManager({
    secretResolver,
    mode,  // ← Pass mode to client manager
  });

  // ... rest unchanged
}
```

## Migration Path

### Phase 1: Add Mock Fetch Infrastructure
1. Create `mock-fetch.ts` with OpenAI response mocking
2. Move schema-based generation logic from `simulation.ts` to `mock-fetch.ts`
3. Add tests for mock fetch responses

### Phase 2: Update Client Manager
1. Modify `client.ts` to inject mock fetch in simulated mode
2. Handle missing API key gracefully in simulated mode
3. Add tests for client initialization in both modes

### Phase 3: Remove Early Exits
1. Remove `if (isSimulated)` branch from `warmStart`
2. Remove `if (isSimulated)` branch from `invoke`
3. Delete or deprecate `simulateOpenAiGeneration()`
4. Update integration tests

### Phase 4: Validate Equivalence
1. Run same blueprint in live and dry-run modes
2. Compare execution paths (logging, errors caught)
3. Verify same config validation occurs
4. Verify prompt rendering happens in both modes

## Testing Strategy

### Unit Tests

```typescript
// providers/src/sdk/openai/mock-fetch.test.ts
describe('createMockFetch', () => {
  it('returns valid chat completion response', async () => {
    const mockFetch = createMockFetch({ mode: 'simulated' });
    const response = await mockFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    const body = await response.json();
    expect(body.choices[0].message.content).toBeDefined();
    expect(body.usage.total_tokens).toBe(0);
  });

  it('generates mock JSON matching schema', async () => {
    const mockFetch = createMockFetch({ mode: 'simulated' });
    const response = await mockFetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'gpt-4',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'test',
            schema: {
              type: 'object',
              properties: {
                items: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      }),
    });

    const body = await response.json();
    const content = JSON.parse(body.choices[0].message.content);
    expect(Array.isArray(content.items)).toBe(true);
  });
});
```

### Integration Tests

```typescript
// providers/src/producers/llm/openai.test.ts
describe('OpenAI handler code path equivalence', () => {
  it('runs same validation in simulated mode as live', async () => {
    const handler = createOpenAiHandler({
      mode: 'simulated',
      secretResolver: mockSecretResolver,
      ...
    });

    // This should throw the same validation error as live mode
    await expect(handler.invoke({
      context: { providerConfig: { /* invalid config */ } },
      ...
    })).rejects.toThrow(/validation error/);
  });

  it('renders prompts in simulated mode', async () => {
    const handler = createOpenAiHandler({ mode: 'simulated', ... });

    // Should render prompts with variables, not skip
    const result = await handler.invoke({
      context: {
        providerConfig: {
          userPrompt: 'Hello {{Input:Name}}',
        },
        extras: {
          resolvedInputs: { 'Input:Name': 'World' },
        },
      },
      ...
    });

    // Verify prompt was actually rendered
    expect(result.diagnostics.renderedPrompt).toContain('Hello World');
  });
});
```

## Success Criteria

1. **Same validation errors**: Config/schema errors caught in both modes
2. **Same prompt rendering**: Variable substitution runs in both modes
3. **Same input resolution**: Missing input errors caught in both modes
4. **Same artifact building**: Downstream processing runs in both modes
5. **Only HTTP intercepted**: Mock fetch is the single divergence point
6. **No credential requirement**: Dry-run works without valid API key
7. **All existing tests pass**: No regression in functionality

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Mock responses don't match real API shape | Use OpenAI's actual response types, add comprehensive tests |
| Performance regression from running full path | Benchmark before/after, mock fetch is synchronous |
| Breaking existing dry-run behavior | Feature flag to enable new behavior, gradual rollout |
| Schema generation differences | Port existing simulation.ts logic exactly |

## Future Extensions

Once OpenAI is working with this pattern, apply the same approach to:
- Replicate providers (mock the Replicate client's HTTP calls)
- ElevenLabs providers (mock the audio generation endpoints)
- Fal providers (mock the image generation endpoints)

This creates a consistent pattern: **run full code path, intercept only at HTTP boundary**.

## References

- Current simulation: `providers/src/sdk/openai/simulation.ts`
- Current client: `providers/src/sdk/openai/client.ts`
- OpenAI handler: `providers/src/producers/llm/openai.ts`
- Vercel AI SDK fetch option: https://sdk.vercel.ai/docs/ai-sdk-core/settings#fetch
