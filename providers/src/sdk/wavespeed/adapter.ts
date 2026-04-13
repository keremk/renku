import type {
  ProviderAdapter,
  ClientOptions,
  ProviderClient,
  ModelContext,
  ProviderInputFile,
} from '../unified/provider-adapter.js';
import { normalizeWavespeedOutput } from './output.js';
import { pollForCompletion } from './polling.js';
import type { WavespeedResult } from './client.js';
import { Blob } from 'node:buffer';
import { generateOutputFromSchema } from '../unified/output-generator.js';
import {
  buildSimulatedUploadUrl,
  createSimulatedProviderClient,
  isSimulatedProviderClient,
} from '../unified/simulated-client.js';

const BASE_URL = 'https://api.wavespeed.ai/api/v3';

interface WavespeedClient {
  apiKey: string;
  logger?: ClientOptions['logger'];
}

/**
 * Wavespeed-ai provider adapter for the unified handler.
 * Uses direct HTTP calls with polling (no SDK).
 *
 * Note: In simulated mode, the unified handler generates output from schema
 * and doesn't call adapter.invoke(). This adapter is only used for live API calls.
 */
export const wavespeedAdapter: ProviderAdapter = {
  name: 'wavespeed-ai',
  secretKey: 'WAVESPEED_API_KEY',

  async createClient(options: ClientOptions): Promise<ProviderClient> {
    const key = await options.secretResolver.getSecret('WAVESPEED_API_KEY');
    if (!key) {
      throw new Error(
        'WAVESPEED_API_KEY is required to use the wavespeed-ai provider.'
      );
    }
    if (options.mode === 'simulated') {
      return createSimulatedProviderClient('wavespeed-ai');
    }
    return {
      apiKey: key,
      logger: options.logger,
    } as WavespeedClient;
  },

  formatModelIdentifier(model: string, _context?: ModelContext): string {
    // Wavespeed uses the model name directly
    return model;
  },

  async invoke(
    client: ProviderClient,
    model: string,
    input: Record<string, unknown>,
    context
  ): Promise<unknown> {
    if (isSimulatedProviderClient(client)) {
      return generateOutputFromSchema(context.schemaFile, {
        provider: 'wavespeed-ai',
        model,
        producesCount: context.request.produces.length,
      });
    }

    const wavespeedClient = client as WavespeedClient;

    // Submit task
    const submitUrl = `${BASE_URL}/${model}`;
    const submitResponse = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${wavespeedClient.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
    });

    if (!submitResponse.ok) {
      const errorText = await submitResponse.text();
      throw new Error(
        `Wavespeed API error (${submitResponse.status}): ${errorText}`
      );
    }

    const submitResult = (await submitResponse.json()) as {
      data: { id: string };
    };
    const requestId = submitResult.data.id;

    // Poll for completion
    const result = await pollForCompletion(
      {
        submitTask: async () => requestId,
        pollResult: async (id: string) => {
          const pollUrl = `${BASE_URL}/predictions/${id}/result`;
          const response = await fetch(pollUrl, {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${wavespeedClient.apiKey}`,
            },
          });
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(
              `Wavespeed API error (${response.status}): ${errorText}`
            );
          }
          return (await response.json()) as WavespeedResult;
        },
      },
      requestId,
      { logger: wavespeedClient.logger }
    );

    return result;
  },

  async uploadInputFile(
    client: ProviderClient,
    file: ProviderInputFile
  ): Promise<string> {
    if (isSimulatedProviderClient(client)) {
      return buildSimulatedUploadUrl(file, 'wavespeed-ai');
    }

    const wavespeedClient = client as WavespeedClient;
    const formData = new FormData();
    formData.set(
      'file',
      new Blob([file.data], { type: file.mimeType }),
      buildUploadFilename(file.mimeType)
    );

    const uploadResponse = await fetch(`${BASE_URL}/media/upload/binary`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${wavespeedClient.apiKey}`,
      },
      body: formData,
    });

    if (!uploadResponse.ok) {
      const errorText = await uploadResponse.text();
      throw new Error(
        `Wavespeed media upload failed (${uploadResponse.status}): ${errorText}`
      );
    }

    const uploadResult = (await uploadResponse.json()) as {
      data?: { download_url?: unknown };
    };
    const downloadUrl = uploadResult.data?.download_url;
    if (typeof downloadUrl !== 'string' || downloadUrl.length === 0) {
      throw new Error(
        'Wavespeed media upload did not return data.download_url.'
      );
    }

    return downloadUrl;
  },

  normalizeOutput(response: unknown): string[] {
    return normalizeWavespeedOutput(response as WavespeedResult);
  },
};

function buildUploadFilename(mimeType: string): string {
  const [, subtype = 'bin'] = mimeType.split('/');
  const extension = subtype.split('+')[0] || 'bin';
  return `input.${extension}`;
}
