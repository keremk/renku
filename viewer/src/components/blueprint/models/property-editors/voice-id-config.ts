import type {
  ConfigFieldDescriptor,
  VoiceIdCustomConfig,
  VoiceOption,
} from '@/types/blueprint-graph';

export interface ParsedVoiceIdCustomConfig {
  allowCustom: true;
  options: VoiceOption[];
  optionsFile?: string;
  optionsRich: VoiceOption[];
}

export function parseVoiceIdCustomConfig(
  field: ConfigFieldDescriptor
): ParsedVoiceIdCustomConfig {
  const rawConfig = field.customConfig;
  if (!isObjectRecord(rawConfig)) {
    throw new Error(
      `Field "${field.keyPath}" requires object customConfig for voice-id-selector.`
    );
  }

  const config = rawConfig as VoiceIdCustomConfig;
  if (config.allow_custom !== true) {
    throw new Error(
      `Field "${field.keyPath}" must set customConfig.allow_custom to true.`
    );
  }

  const options = parseVoiceOptionArray({
    value: config.options,
    keyPath: field.keyPath,
    configKey: 'options',
  });

  const optionsRich = parseVoiceOptionArray({
    value: config.options_rich,
    keyPath: field.keyPath,
    configKey: 'options_rich',
  });

  const optionsFile = parseOptionalString({
    value: config.options_file,
    keyPath: field.keyPath,
    configKey: 'options_file',
  });

  if (optionsFile && options.length > 0) {
    throw new Error(
      `Field "${field.keyPath}" cannot define both customConfig.options and customConfig.options_file.`
    );
  }

  return {
    allowCustom: true,
    options,
    optionsFile,
    optionsRich,
  };
}

function parseVoiceOptionArray(args: {
  value: unknown;
  keyPath: string;
  configKey: string;
}): VoiceOption[] {
  if (args.value === undefined) {
    return [];
  }

  if (!Array.isArray(args.value)) {
    throw new Error(
      `Field "${args.keyPath}" has invalid customConfig.${args.configKey}. Expected array.`
    );
  }

  return args.value.map((entry, index) => {
    if (!isObjectRecord(entry)) {
      throw new Error(
        `Field "${args.keyPath}" has invalid customConfig.${args.configKey}[${index}]. Expected object.`
      );
    }

    const value = entry.value;
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(
        `Field "${args.keyPath}" has invalid customConfig.${args.configKey}[${index}].value. Expected non-empty string.`
      );
    }

    const label = entry.label;
    if (typeof label !== 'string' || label.length === 0) {
      throw new Error(
        `Field "${args.keyPath}" has invalid customConfig.${args.configKey}[${index}].label. Expected non-empty string.`
      );
    }

    const option: VoiceOption = {
      value,
      label,
    };

    if ('tagline' in entry && entry.tagline !== undefined) {
      if (typeof entry.tagline !== 'string') {
        throw new Error(
          `Field "${args.keyPath}" has invalid customConfig.${args.configKey}[${index}].tagline. Expected string.`
        );
      }
      option.tagline = entry.tagline;
    }

    if ('description' in entry && entry.description !== undefined) {
      if (typeof entry.description !== 'string') {
        throw new Error(
          `Field "${args.keyPath}" has invalid customConfig.${args.configKey}[${index}].description. Expected string.`
        );
      }
      option.description = entry.description;
    }

    if ('preview_url' in entry && entry.preview_url !== undefined) {
      if (typeof entry.preview_url !== 'string') {
        throw new Error(
          `Field "${args.keyPath}" has invalid customConfig.${args.configKey}[${index}].preview_url. Expected string.`
        );
      }
      option.preview_url = entry.preview_url;
    }

    return option;
  });
}

function parseOptionalString(args: {
  value: unknown;
  keyPath: string;
  configKey: string;
}): string | undefined {
  if (args.value === undefined) {
    return undefined;
  }

  if (typeof args.value !== 'string' || args.value.trim().length === 0) {
    throw new Error(
      `Field "${args.keyPath}" has invalid customConfig.${args.configKey}. Expected non-empty string.`
    );
  }

  return args.value;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
