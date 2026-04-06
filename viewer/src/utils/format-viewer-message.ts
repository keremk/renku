const REQUEST_FAILED_PREFIX = /^Request failed \(\d+\):\s*/;
const RUNTIME_ERROR_CODE_PATTERN = /^[RW]\d{2,}$/i;

interface ParsedMessage {
  message?: string;
  code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeProducerLabel(raw: string): string {
  const cleaned = raw.replace(/\[[^\]]+\]/g, '').trim();
  return cleaned.length > 0 ? cleaned : raw;
}

function normalizeArtifactLabel(raw: string): string {
  const path = raw.split('.');
  const tail = path[path.length - 1] ?? raw;
  const cleaned = tail.replace(/[_-]+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned : raw;
}

function rewriteCanonicalIds(message: string): string {
  const withArtifacts = message.replace(
    /\bArtifact:([^\s,)"']+?)\[(\d+)\]/g,
    (_match, artifactPath: string, indexRaw: string) => {
      const index = Number(indexRaw);
      const displayIndex = Number.isFinite(index) ? index + 1 : indexRaw;
      return `${normalizeArtifactLabel(artifactPath)} (item ${displayIndex})`;
    }
  );

  return withArtifacts.replace(
    /\bProducer:([A-Za-z0-9_-]+)(?:\[\d+\])?/g,
    (_match, producerName: string) => normalizeProducerLabel(producerName)
  );
}

function rewriteCliTerms(message: string): string {
  return message
    .replace(/--movie-id\/--id/g, 'selected movie')
    .replace(/--movie-id/g, 'selected movie')
    .replace(/--id/g, 'selected movie')
    .replace(/--last/g, 'latest run')
    .replace(/\b--up=(\d+)\b/g, (_match, layerRaw: string) => {
      return `layer limit (up to layer ${layerRaw})`;
    });
}

function rewriteDomainJargon(message: string): string {
  return message
    .replace(/\breusable canonical artifacts\b/gi, 'reusable outputs')
    .replace(/\bactive scope\b/gi, 'selected layer range')
    .replace(/\bproducer directive\b/gi, 'producer override')
    .replace(/\bcanonical artifact IDs?\b/gi, 'artifact IDs')
    .replace(/\bcanonical artifacts\b/gi, 'reusable outputs')
    .replace(/\bcanonical artifact\b/gi, 'artifact');
}

function cleanMessageText(message: string): string {
  return rewriteDomainJargon(rewriteCliTerms(rewriteCanonicalIds(message))).trim();
}

function parseJsonMaybe(value: string): unknown | undefined {
  const trimmed = value.trim();
  if (
    !(
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    )
  ) {
    return undefined;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function extractMessageAndCode(input: unknown): ParsedMessage {
  if (Array.isArray(input)) {
    const parts = input
      .map((item) => formatViewerMessage(item))
      .filter((value) => value.trim().length > 0);
    return {
      message: parts.length > 0 ? parts.join('; ') : undefined,
    };
  }

  if (!isRecord(input)) {
    return {};
  }

  const topCode = readStringField(input, 'code');
  const nestedError = input.error;
  const nestedMessage = input.message;

  if (typeof nestedError === 'string' && nestedError.trim().length > 0) {
    return {
      message: nestedError,
      code:
        topCode && RUNTIME_ERROR_CODE_PATTERN.test(topCode) ? topCode : undefined,
    };
  }

  if (typeof nestedMessage === 'string' && nestedMessage.trim().length > 0) {
    return {
      message: nestedMessage,
      code:
        topCode && RUNTIME_ERROR_CODE_PATTERN.test(topCode) ? topCode : undefined,
    };
  }

  if (isRecord(nestedError)) {
    const nested = extractMessageAndCode(nestedError);
    return {
      message: nested.message,
      code:
        nested.code ??
        (topCode && RUNTIME_ERROR_CODE_PATTERN.test(topCode) ? topCode : undefined),
    };
  }

  if (Array.isArray(input.errors)) {
    const nested = extractMessageAndCode(input.errors);
    if (nested.message) {
      return {
        message: nested.message,
        code:
          nested.code ??
          (topCode && RUNTIME_ERROR_CODE_PATTERN.test(topCode) ? topCode : undefined),
      };
    }
  }

  return {
    code: topCode && RUNTIME_ERROR_CODE_PATTERN.test(topCode) ? topCode : undefined,
  };
}

function formatParsedPayload(payload: unknown): string {
  const parsed = extractMessageAndCode(payload);
  if (!parsed.message) {
    if (isRecord(payload)) {
      const fallbackMessage = readStringField(payload, 'error') ?? readStringField(payload, 'message');
      if (fallbackMessage) {
        return cleanMessageText(fallbackMessage);
      }
    }
    return String(payload);
  }

  const cleaned = cleanMessageText(parsed.message);
  if (parsed.code && !cleaned.includes(parsed.code)) {
    return `${cleaned} (Code: ${parsed.code})`;
  }
  return cleaned;
}

function normalizeInputToString(input: unknown): string {
  if (input instanceof Error) {
    return input.message;
  }
  if (typeof input === 'string') {
    return input;
  }
  return String(input);
}

/**
 * Converts error/warning payloads to a readable single-line message for UI display.
 * Removes transport noise while preserving actionable runtime codes (e.g. R137).
 */
export function formatViewerMessage(input: unknown): string {
  if (Array.isArray(input) || isRecord(input)) {
    return formatParsedPayload(input);
  }

  const raw = normalizeInputToString(input).trim();
  if (raw.length === 0) {
    return '';
  }

  const withoutHttpEnvelope = raw.replace(REQUEST_FAILED_PREFIX, '').trim();
  const parsedPayload = parseJsonMaybe(withoutHttpEnvelope);
  if (parsedPayload !== undefined) {
    return formatParsedPayload(parsedPayload);
  }

  return cleanMessageText(withoutHttpEnvelope);
}
