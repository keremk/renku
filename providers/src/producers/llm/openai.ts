import type { ArtefactEventStatus } from '@renku/core';
import type { HandlerFactory, ProviderJobContext } from '../../types.js';
import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import type { ProducerInvokeArgs, ProducerRuntime } from '../../sdk/types.js';
import {
  createOpenAiClientManager,
  parseOpenAiConfig,
  renderPrompts,
  callOpenAi,
  buildArtefactsFromResponse,
  sanitizeResponseMetadata,
  simulateOpenAiGeneration,
  type OpenAiLlmConfig,
  type GenerationResult,
} from '../../sdk/openai/index.js';

export function createOpenAiLlmHandler(): HandlerFactory {
  return (init) => {
    const { descriptor, secretResolver, logger, schemaRegistry } = init;
    const clientManager = createOpenAiClientManager(secretResolver, logger, init.mode, schemaRegistry);
    const isSimulated = init.mode === 'simulated';
    const notify = init.notifications;
    const notificationLabel = `${descriptor.provider}/${descriptor.model}`;

    const factory = createProducerHandlerFactory({
      domain: 'prompt',
      configValidator: parseOpenAiConfig,
      warmStart: async () => {
        if (isSimulated) {
          return;
        }
        try {
          await clientManager.ensure();
        } catch (error) {
          logger?.error?.('providers.openai.warmStart.error', {
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
        const schemaInfo = config.responseFormat?.type === 'json_schema'
          ? {
              hasSchema: Boolean(config.responseFormat.schema),
              schema: config.responseFormat.schema,
            }
          : { hasSchema: false };
        const configLogPayload = {
          producer: request.jobId,
          provider: descriptor.provider,
          model: descriptor.model,
          responseFormat: config.responseFormat?.type,
          ...schemaInfo,
        };
        logger?.debug?.('providers.openai.config', configLogPayload);

        // 2. Render prompts with variable substitution
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
        logger?.debug?.('providers.openai.prompts', promptLogPayload);

        // 3. Call OpenAI via AI SDK or simulate the response
        let generation: GenerationResult;
        if (isSimulated) {
          generation = simulateOpenAiGeneration({ request, config });
        } else {
          await clientManager.ensure();
          const model = clientManager.getModel(request.model);
          generation = await callOpenAi({
            model,
            prompts,
            responseFormat: config.responseFormat,
            config,
          });
        }

        // 5. Build artifacts using implicit mapping
        const artefacts = buildArtefactsFromResponse(generation.data, request.produces, {
          producerId: request.jobId,
        });

        // 6. Determine overall status
        const status: ArtefactEventStatus = artefacts.some((artefact) => artefact.status === 'failed')
          ? 'failed'
          : 'succeeded';

        // 7. Build diagnostics
        const textLength =
          typeof generation.data === 'string'
            ? generation.data.length
            : JSON.stringify(generation.data).length;

        const diagnostics = {
          provider: 'openai',
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

function buildPromptVariablePayload(
  variables: string[] | undefined,
  runtime: ProducerRuntime,
  request: ProviderJobContext,
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
      throw new Error(
        `[providers.openai.prompts] Missing resolved input for canonical id "${canonicalId}" (variable "${variable}")`,
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
  runtime: ProducerRuntime,
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
        throw new Error(
          `[providers.openai.prompts] Fan-in member "${memberId}" is missing text content for prompt variable.`,
        );
      }
      lines.push(`- ${resolved.trim()}`);
    }
  }
  if (lines.length === 0) {
    throw new Error('[providers.openai.prompts] Fan-in collection did not yield any values for prompt variable.');
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
