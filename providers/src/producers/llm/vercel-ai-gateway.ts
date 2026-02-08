import type { ArtefactEventStatus } from '@gorenku/core';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import type { ProducerInvokeArgs, ProducerRuntime } from '../../sdk/types.js';
import {
  createVercelGatewayClientManager,
  parseOpenAiConfig,
  renderPrompts,
  callVercelGateway,
  buildArtefactsFromResponse,
  sanitizeResponseMetadata,
  type OpenAiLlmConfig,
  type OpenAiResponseFormat,
  type VercelGatewayGenerationResult,
} from '../../sdk/vercel-gateway/index.js';

/**
 * Creates a handler factory for the Vercel AI Gateway producer.
 * Supports multiple AI providers through OpenAI-compatible API format.
 */
export function createVercelAiGatewayHandler(): HandlerFactory {
  return (init) => {
    const { descriptor, secretResolver, logger } = init;
    const clientManager = createVercelGatewayClientManager(secretResolver, logger);
    const notify = init.notifications;
    const notificationLabel = `${descriptor.provider}/${descriptor.model}`;

    const factory = createProducerHandlerFactory({
      domain: 'prompt',
      configValidator: parseOpenAiConfig,
      warmStart: async () => {
        // Initialize the client to validate API key and gateway configuration
        try {
          await clientManager.ensure();
        } catch (error) {
          logger?.error?.('providers.vercel-gateway.warmStart.error', {
            provider: descriptor.provider,
            model: descriptor.model,
            error: error instanceof Error ? error.message : String(error),
          });
          notify?.publish({
            type: 'error',
            message: `Warm start failed for ${notificationLabel}: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: new Date().toISOString(),
          });
          throw error;
        }
      },
      invoke: async (args: ProducerInvokeArgs) => {
        const { request, runtime } = args;
        notify?.publish({
          type: 'progress',
          message: `Invoking ${notificationLabel} for job ${request.jobId}`,
          timestamp: new Date().toISOString(),
        });
        try {
          // 1. Parse config
          const config = runtime.config.parse<OpenAiLlmConfig>(parseOpenAiConfig);

          // 2. Auto-derive responseFormat from outputSchema (always)
          const outputSchema = getOutputSchemaFromRequest(request);
          const responseFormat = deriveResponseFormat(outputSchema);

          const schemaInfo =
            responseFormat?.type === 'json_schema'
              ? {
                  hasSchema: Boolean(responseFormat.schema),
                  schema: responseFormat.schema,
                }
              : { hasSchema: false };
          const configLogPayload = {
            producer: request.jobId,
            provider: descriptor.provider,
            model: descriptor.model,
            responseFormat: responseFormat?.type,
            autoDerivedFromOutputSchema: outputSchema !== undefined && config.responseFormat?.type !== 'json_schema',
            ...schemaInfo,
          };
          logger?.debug?.('providers.vercel-gateway.config', configLogPayload);

          // 3. Render prompts with variable substitution
          const promptInputs = buildPromptVariablePayload(config.variables, runtime, request);
          const prompts = renderPrompts(config, promptInputs, logger);
          const promptPayload = {
            systemPrompt: prompts.system,
            userPrompt: prompts.user,
          };
          const promptLogPayload = {
            producer: request.jobId,
            provider: descriptor.provider,
            model: descriptor.model,
            ...promptPayload,
          };
          logger?.debug?.('providers.vercel-gateway.prompts', promptLogPayload);

          // 4. Get apiKeyName from request context if provided and reinitialize if different
          const apiKeyName = getApiKeyNameFromExtras(request.context.extras);

          // 5. Initialize client and get model
          await clientManager.ensure(apiKeyName);
          const model = clientManager.getModel(request.model);

          // 6. Call provider via Vercel AI Gateway
          const generation: VercelGatewayGenerationResult = await callVercelGateway({
            model,
            prompts,
            responseFormat,
            config,
            mode: init.mode,
            request,
          });

          // 7. Build artifacts using implicit mapping
          const artefacts = buildArtefactsFromResponse(generation.data, request.produces, {
            producerId: request.jobId,
          });

          // 8. Determine overall status
          const status: ArtefactEventStatus = artefacts.some((artefact) => artefact.status === 'failed')
            ? 'failed'
            : 'succeeded';

          // 9. Build diagnostics
          const textLength =
            typeof generation.data === 'string'
              ? generation.data.length
              : JSON.stringify(generation.data).length;

          const diagnostics = {
            provider: 'vercel',
            model: request.model,
            response: sanitizeResponseMetadata(generation.response),
            usage: generation.usage,
            warnings: generation.warnings,
            textLength,
          } satisfies Record<string, unknown>;

          notify?.publish({
            type: status === 'succeeded' ? 'success' : 'error',
            message: `${notificationLabel} completed for job ${request.jobId} (${status}).`,
            timestamp: new Date().toISOString(),
          });
          return {
            status,
            artefacts,
            diagnostics,
          };
        } catch (error) {
          notify?.publish({
            type: 'error',
            message: `${notificationLabel} failed for job ${request.jobId}: ${error instanceof Error ? error.message : String(error)}`,
            timestamp: new Date().toISOString(),
          });
          throw error;
        }
      },
    });

    return factory(init);
  };
}

/**
 * Extracts apiKeyName from request context extras if provided.
 */
function getApiKeyNameFromExtras(extras: Record<string, unknown> | undefined): string | undefined {
  if (!extras || typeof extras !== 'object') {
    return undefined;
  }
  const modelDef = extras.modelDefinition as Record<string, unknown> | undefined;
  if (!modelDef || typeof modelDef !== 'object') {
    return undefined;
  }
  const apiKeyName = modelDef.apiKeyName;
  return typeof apiKeyName === 'string' ? apiKeyName : undefined;
}

function buildPromptVariablePayload(
  variables: string[] | undefined,
  runtime: ProducerRuntime,
  request: ProviderJobContext
): Record<string, unknown> {
  if (!variables || variables.length === 0) {
    return normalizePromptValues(runtime.inputs.all(), runtime);
  }
  const inputBindings = extractInputBindings(request);
  const payload: Record<string, unknown> = {};
  for (const variable of variables) {
    const canonicalId = inputBindings?.[variable] ?? variable;
    const value = runtime.inputs.getByNodeId(canonicalId);
    if (value === undefined) {
      throw createProviderError(
        SdkErrorCode.MISSING_REQUIRED_INPUT,
        `[providers.vercel-gateway.prompts] Missing resolved input for canonical id "${canonicalId}" (variable "${variable}")`,
        { kind: 'user_input', causedByUser: true },
      );
    }
    payload[variable] = normalizePromptValue(value, runtime);
  }
  return payload;
}

function extractInputBindings(request: ProviderJobContext): Record<string, string> | undefined {
  const extras = request.context.extras;
  if (!extras || typeof extras !== 'object') {
    return undefined;
  }
  const jobContext = (extras as Record<string, unknown>).jobContext;
  if (!jobContext || typeof jobContext !== 'object') {
    return undefined;
  }
  const bindings = (jobContext as Record<string, unknown>).inputBindings;
  if (!bindings || typeof bindings !== 'object') {
    return undefined;
  }
  return bindings as Record<string, string>;
}

function normalizePromptValues(
  values: Record<string, unknown>,
  runtime: ProducerRuntime
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    normalized[key] = normalizePromptValue(value, runtime);
  }
  return normalized;
}

function normalizePromptValue(value: unknown, runtime: ProducerRuntime): unknown {
  if (isFanInValue(value)) {
    return formatFanInPromptValue(value, runtime);
  }
  return value;
}

function formatFanInPromptValue(value: FanInValue, runtime: ProducerRuntime): string {
  const lines: string[] = [];
  for (const group of value.groups) {
    if (!Array.isArray(group)) {
      continue;
    }
    for (const memberId of group) {
      if (typeof memberId !== 'string' || memberId.length === 0) {
        continue;
      }
      const resolved = runtime.inputs.getByNodeId(memberId) ?? runtime.inputs.get(memberId);
      if (typeof resolved !== 'string' || resolved.trim().length === 0) {
        throw createProviderError(
          SdkErrorCode.MISSING_FANIN_DATA,
          `[providers.vercel-gateway.prompts] Fan-in member "${memberId}" is missing text content for prompt variable.`,
          { kind: 'user_input' },
        );
      }
      lines.push(`- ${resolved.trim()}`);
    }
  }
  if (lines.length === 0) {
    throw createProviderError(
      SdkErrorCode.MISSING_FANIN_DATA,
      '[providers.vercel-gateway.prompts] Fan-in collection did not yield any values for prompt variable.',
      { kind: 'user_input' },
    );
  }
  return lines.join('\n');
}

interface FanInValue {
  groupBy: string;
  orderBy?: string;
  groups: unknown[];
}

function isFanInValue(value: unknown): value is FanInValue {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as FanInValue).groups));
}

/**
 * Extracts outputSchema from request context extras.
 * The outputSchema is set by core in producer-graph.ts via extras.schema.output.
 */
function getOutputSchemaFromRequest(request: ProviderJobContext): string | undefined {
  const extras = request.context?.extras as Record<string, unknown> | undefined;
  const schema = extras?.schema as Record<string, unknown> | undefined;
  return typeof schema?.output === 'string' ? schema.output : undefined;
}

/**
 * Derives the responseFormat to use, always auto-deriving from outputSchema.
 * textFormat is no longer user-configurable — providers always deduce from schema.
 */
function deriveResponseFormat(
  outputSchema: string | undefined,
): OpenAiResponseFormat {
  if (outputSchema) {
    return buildResponseFormatFromSchema(outputSchema);
  }
  return { type: 'text' };
}

/**
 * Builds a responseFormat from an outputSchema JSON string.
 */
function buildResponseFormatFromSchema(schemaString: string): OpenAiResponseFormat {
  const schema = JSON.parse(schemaString) as Record<string, unknown>;
  return {
    type: 'json_schema',
    schema,
    name: typeof schema.title === 'string' ? schema.title : 'output',
    description: typeof schema.description === 'string' ? schema.description : undefined,
  };
}
