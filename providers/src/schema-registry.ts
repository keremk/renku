import type { ProviderName } from '@renku/core';

export interface SchemaRegistryEntry {
  provider: ProviderName;
  model: string;
  config?: Record<string, unknown>;
  sdkMapping?: Record<string, SdkMappingField>;
}

export interface SdkMappingField {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object';
  required?: boolean;
}

export class SchemaRegistry {
  private registry = new Map<string, SchemaRegistryEntry>();

  get(provider: ProviderName, model: string): SchemaRegistryEntry | undefined {
    return this.registry.get(this.getKey(provider, model));
  }

  register(provider: ProviderName, model: string, options: { config?: Record<string, unknown>; sdkMapping?: Record<string, SdkMappingField> }): void {
    const entry: SchemaRegistryEntry = {
      provider,
      model,
      ...options,
    };
    this.registry.set(this.getKey(provider, model), entry);
  }

  private getKey(provider: ProviderName, model: string): string {
    return `${provider}:${model}`;
  }
}
