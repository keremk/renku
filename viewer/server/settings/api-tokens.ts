import {
  readApiKeysEnvFile,
  writeApiKeysEnvFile,
  type ApiKeyValues,
} from '@gorenku/core';

export interface ProviderTokenPayload {
  providers?: {
    fal?: { apiKey?: string };
    replicate?: { apiKey?: string };
    elevenlabs?: { apiKey?: string };
  };
  promptProviders?: {
    openai?: { apiKey?: string };
    vercelGateway?: { apiKey?: string };
  };
}

export interface SettingsApiTokens {
  fal: string;
  replicate: string;
  elevenlabs: string;
  openai: string;
  vercelGateway: string;
}

export function mapProviderTokenPayloadToApiKeyValues(
  payload: ProviderTokenPayload
): ApiKeyValues {
  return {
    FAL_KEY: payload.providers?.fal?.apiKey,
    REPLICATE_API_TOKEN: payload.providers?.replicate?.apiKey,
    ELEVENLABS_API_KEY: payload.providers?.elevenlabs?.apiKey,
    OPENAI_API_KEY: payload.promptProviders?.openai?.apiKey,
    AI_GATEWAY_API_KEY: payload.promptProviders?.vercelGateway?.apiKey,
  };
}

export async function persistProviderTokenPayload(
  payload: ProviderTokenPayload
): Promise<string> {
  const apiKeys = mapProviderTokenPayloadToApiKeyValues(payload);
  return writeApiKeysEnvFile(apiKeys);
}

export async function readSettingsApiTokens(): Promise<SettingsApiTokens> {
  const apiKeys = await readApiKeysEnvFile();
  return {
    fal: apiKeys.FAL_KEY ?? '',
    replicate: apiKeys.REPLICATE_API_TOKEN ?? '',
    elevenlabs: apiKeys.ELEVENLABS_API_KEY ?? '',
    openai: apiKeys.OPENAI_API_KEY ?? '',
    vercelGateway: apiKeys.AI_GATEWAY_API_KEY ?? '',
  };
}
