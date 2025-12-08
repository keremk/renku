/**
 * Normalizes fal.ai API output to extract URL strings.
 *
 * Fal.ai returns different output structures depending on the model:
 * - Video: { video: { url: "..." } } or { data: { video: { url: "..." } } }
 * - Image (single): { image: { url: "..." } }
 * - Image (multiple): { images: [{ url: "..." }] }
 * - Audio: { audio: { url: "..." } }
 * - Audio files: { audio_file: { url: "..." } }
 *
 * The output may be wrapped in a { data: ... } envelope.
 */
export function normalizeFalOutput(output: unknown): string[] {
  if (!output || typeof output !== 'object') {
    return [];
  }

  let obj = output as Record<string, unknown>;

  // Unwrap data envelope if present
  if (obj.data && typeof obj.data === 'object') {
    obj = obj.data as Record<string, unknown>;
  }

  const urls: string[] = [];

  // Handle video output: { video: { url: "..." } }
  if (obj.video && typeof obj.video === 'object') {
    const url = extractUrl(obj.video);
    if (url) urls.push(url);
  }

  // Handle images array: { images: [{ url: "..." }] }
  if (Array.isArray(obj.images)) {
    for (const item of obj.images) {
      const url = extractUrl(item);
      if (url) urls.push(url);
    }
  }

  // Handle single image: { image: { url: "..." } }
  if (obj.image && typeof obj.image === 'object') {
    const url = extractUrl(obj.image);
    if (url) urls.push(url);
  }

  // Handle audio output: { audio: { url: "..." } }
  if (obj.audio && typeof obj.audio === 'object') {
    const url = extractUrl(obj.audio);
    if (url) urls.push(url);
  }

  // Handle audio_file output: { audio_file: { url: "..." } }
  if (obj.audio_file && typeof obj.audio_file === 'object') {
    const url = extractUrl(obj.audio_file);
    if (url) urls.push(url);
  }

  return urls;
}

function extractUrl(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') {
    return undefined;
  }
  const urlValue = (item as Record<string, unknown>).url;
  if (typeof urlValue === 'string' && urlValue.length > 0) {
    return urlValue;
  }
  return undefined;
}
