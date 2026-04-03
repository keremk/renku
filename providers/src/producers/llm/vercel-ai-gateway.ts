import { isCanonicalId, type ArtefactEventStatus } from '@gorenku/core';
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
  sanitizeProviderMetadata,
  type OpenAiLlmConfig,
  type OpenAiResponseFormat,
  type VercelGatewayGenerationResult,
} from '../../sdk/vercel-gateway/index.js';
import { extractConditionHints } from './openai.js';
import { applyRuntimeLlmInvocationSettings } from './invocation-settings.js';

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
          const parsedConfig = runtime.config.parse<OpenAiLlmConfig>(parseOpenAiConfig);
          const config = applyRuntimeLlmInvocationSettings(parsedConfig, request);

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

          // 6. Extract condition hints from request context (for dry-run simulation)
          const conditionHints = extractConditionHints(request);

          // 7. Call provider via Vercel AI Gateway
          let generation: VercelGatewayGenerationResult;
          try {
            generation = await callVercelGateway({
              model,
              prompts,
              responseFormat,
              config,
              mode: init.mode,
              request,
              conditionHints,
            });
          } catch (error) {
            throw normalizeGatewayInvocationError(
              error,
              request.model,
              responseFormat.type,
            );
          }

          // 8. Build artifacts using implicit mapping
          const artefacts = buildArtefactsFromResponse(generation.data, request.produces, {
            producerId: request.jobId,
          });

          // 9. Determine overall status
          const status: ArtefactEventStatus = artefacts.some((artefact) => artefact.status === 'failed')
            ? 'failed'
            : 'succeeded';

          // 10. Build diagnostics
          const textLength =
            typeof generation.data === 'string'
              ? generation.data.length
              : JSON.stringify(generation.data).length;

          const diagnostics = {
            provider: 'vercel',
            model: request.model,
            response: sanitizeResponseMetadata(generation.response),
            providerMetadata: sanitizeProviderMetadata(generation.providerMetadata),
            gatewayRoutingAttempts: extractGatewayRoutingAttempts(generation.providerMetadata),
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
    const canonicalId = inputBindings?.[variable];
    if (!canonicalId) {
      throw createProviderError(
        SdkErrorCode.MISSING_REQUIRED_INPUT,
        `[providers.vercel-gateway.prompts] Missing input binding for variable "${variable}". Expected canonical binding metadata in job context.`,
        { kind: 'user_input', causedByUser: true },
      );
    }
    if (!isCanonicalId(canonicalId)) {
      throw createProviderError(
        SdkErrorCode.MISSING_REQUIRED_INPUT,
        `[providers.vercel-gateway.prompts] Input binding for variable "${variable}" must be canonical. Received "${canonicalId}".`,
        { kind: 'user_input', causedByUser: true },
      );
    }
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
      if (!isCanonicalId(memberId)) {
        throw createProviderError(
          SdkErrorCode.MISSING_FANIN_DATA,
          `[providers.vercel-gateway.prompts] Fan-in member "${memberId}" is not a canonical node ID.`,
          { kind: 'user_input' },
        );
      }
      const resolved = runtime.inputs.getByNodeId(memberId);
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

function normalizeGatewayInvocationError(
  error: unknown,
  model: string,
  responseFormatType: OpenAiResponseFormat['type'],
): unknown {
  if (!isRecord(error)) {
    return error;
  }

  if (readString(error, 'name') !== 'GatewayResponseError') {
    return error;
  }

  const message = readString(error, 'message');
  if (!message?.includes('Invalid error response format')) {
    return error;
  }

  const statusCode = readNumber(error, 'statusCode');
  const rawResponse = stringifyUnknown(error.response);
  const details: string[] = [
    `Vercel AI Gateway returned a non-JSON error payload while calling model "${model}".`,
    statusCode !== undefined ? `Status code: ${statusCode}.` : undefined,
    rawResponse ? `Gateway response: ${rawResponse}.` : undefined,
    `Requested response format: ${responseFormatType}.`,
    'This usually means the upstream provider timed out or rejected the request format.',
  ].filter((entry): entry is string => typeof entry === 'string');

  return createProviderError(
    SdkErrorCode.PROVIDER_PREDICTION_FAILED,
    details.join(' '),
    {
      kind: 'unknown',
      retryable: false,
      metadata: {
        provider: 'vercel',
        model,
        reason: 'gateway_invalid_error_payload',
        statusCode,
        responseFormat: responseFormatType,
        gatewayResponse: rawResponse,
      },
      raw: error,
    },
  );
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return truncateText(value, 400);
  }
  try {
    return truncateText(JSON.stringify(value), 400);
  } catch {
    return truncateText(String(value), 400);
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function readNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === 'number' ? value : undefined;
}

function extractGatewayRoutingAttempts(
  providerMetadata: Record<string, unknown> | undefined,
): unknown[] | undefined {
  if (!providerMetadata) {
    return undefined;
  }
  const gateway = providerMetadata.gateway;
  if (!gateway || typeof gateway !== 'object' || Array.isArray(gateway)) {
    return undefined;
  }
  const routing = (gateway as Record<string, unknown>).routing;
  if (!routing || typeof routing !== 'object' || Array.isArray(routing)) {
    return undefined;
  }
  const attempts = (routing as Record<string, unknown>).attempts;
  return Array.isArray(attempts) ? attempts : undefined;
}
