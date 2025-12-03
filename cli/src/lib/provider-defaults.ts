import { parseQualifiedProducerName, formatProducerScopedInputId } from '@renku/core';
import type { InputMap } from './input-loader.js';
import type { ProducerOptionsMap } from './producer-options.js';

export function applyProviderDefaults(values: InputMap, options: ProducerOptionsMap): void {
  for (const [key, entries] of options) {
    const primary = entries?.[0];
    if (!primary) {
      continue;
    }
    if (primary.sourcePath && primary.sourcePath !== key) {
      continue;
    }
    const { namespacePath, producerName } = parseQualifiedProducerName(primary.sourcePath ?? key);
    const providerId = formatProducerScopedInputId(namespacePath, producerName, 'provider');
    const modelId = formatProducerScopedInputId(namespacePath, producerName, 'model');
    if (values[providerId] === undefined) {
      values[providerId] = primary.provider;
    }
    if (values[modelId] === undefined) {
      values[modelId] = primary.model;
    }
    for (const [path, value] of Object.entries(primary.configDefaults ?? {})) {
      const canonicalId = formatProducerScopedInputId(namespacePath, producerName, path);
      if (values[canonicalId] === undefined) {
        values[canonicalId] = value;
      }
    }
  }
}
