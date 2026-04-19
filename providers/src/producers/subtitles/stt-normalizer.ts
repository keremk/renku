import { createProducerHandlerFactory } from '../../sdk/handler-factory.js';
import { createProviderError, SdkErrorCode } from '../../sdk/errors.js';
import type { HandlerFactory, HandlerFactoryInit, ProviderJobContext } from '../../types.js';
import { resolveSttNormalizerAdapter } from './adapters.js';

interface InputArtifactSource {
  artifactId: string;
  upstreamJobId: string;
  upstreamProducerId: string;
  upstreamProducerAlias: string;
  provider: string;
  model: string;
}

export function createSttNormalizerHandler(): HandlerFactory {
  return (init: HandlerFactoryInit) => {
    const { getModelDefinition } = init;

    return createProducerHandlerFactory({
      domain: 'transcription',
      invoke: async ({ request, runtime }) => {
        const outputArtifactId = request.produces[0];
        if (!outputArtifactId) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            'STT normalizer requires a declared output artifact.',
            { kind: 'user_input', causedByUser: true },
          );
        }

        const rawArtifactIds = request.inputs.filter((inputId) =>
          inputId.startsWith('Artifact:')
        );
        if (rawArtifactIds.length !== 1) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            'STT normalizer requires exactly one raw transcription artifact input.',
            {
              kind: 'user_input',
              causedByUser: true,
              metadata: { inputIds: request.inputs },
            },
          );
        }

        const rawArtifactId = rawArtifactIds[0]!;
        const rawPayload = runtime.inputs.getByNodeId<unknown>(rawArtifactId);
        if (rawPayload === undefined) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            `STT normalizer could not resolve raw transcription artifact "${rawArtifactId}".`,
            {
              kind: 'user_input',
              causedByUser: true,
              metadata: { rawArtifactId },
            },
          );
        }

        const sourceInfo = readInputArtifactSource(request, rawArtifactId);
        const modelDefinition = getModelDefinition?.(
          sourceInfo.provider,
          sourceInfo.model,
        );
        if (!modelDefinition) {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            `STT normalizer could not load model metadata for ${sourceInfo.provider}/${sourceInfo.model}.`,
            {
              kind: 'user_input',
              causedByUser: true,
              metadata: { ...sourceInfo },
            },
          );
        }

        if (typeof modelDefinition.sttNormalizer !== 'string') {
          throw createProviderError(
            SdkErrorCode.INVALID_CONFIG,
            `STT model ${sourceInfo.provider}/${sourceInfo.model} does not declare a subtitles normalizer.`,
            {
              kind: 'user_input',
              causedByUser: true,
              metadata: { ...sourceInfo },
            },
          );
        }

        const adapter = resolveSttNormalizerAdapter(modelDefinition.sttNormalizer);
        const normalized = adapter.normalize(rawPayload);
        const payload = JSON.stringify(normalized, null, 2);

        return {
          status: 'succeeded',
          artifacts: [
            {
              artifactId: runtime.artifacts.expectBlob(outputArtifactId),
              status: 'succeeded',
              blob: {
                data: payload,
                mimeType: 'application/json',
              },
            },
          ],
          diagnostics: {
            sttNormalizer: modelDefinition.sttNormalizer,
            upstreamProvider: sourceInfo.provider,
            upstreamModel: sourceInfo.model,
          },
        };
      },
    })(init);
  };
}

function readInputArtifactSource(
  request: ProviderJobContext,
  artifactId: string,
): InputArtifactSource {
  const extras = request.context.extras;
  const sources = extras?.inputArtifactSources;
  if (!isRecord(sources)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      'STT normalizer requires inputArtifactSources metadata in the job context.',
      { kind: 'user_input', causedByUser: true },
    );
  }

  const source = sources[artifactId];
  if (!isRecord(source)) {
    throw createProviderError(
      SdkErrorCode.INVALID_CONFIG,
      `STT normalizer is missing source metadata for artifact "${artifactId}".`,
      {
        kind: 'user_input',
        causedByUser: true,
        metadata: { artifactId, knownArtifacts: Object.keys(sources) },
      },
    );
  }

  return source as unknown as InputArtifactSource;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
