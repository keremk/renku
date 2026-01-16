import { Buffer } from 'node:buffer';

/**
 * Response from ElevenLabs API containing an audio stream.
 */
export interface ElevenlabsStreamResponse {
  audioStream: ReadableStream<Uint8Array>;
  model: string;
}

/**
 * Check if a response is an ElevenLabs stream response.
 */
export function isElevenlabsStreamResponse(response: unknown): response is ElevenlabsStreamResponse {
  if (!response || typeof response !== 'object') {
    return false;
  }
  const obj = response as Record<string, unknown>;
  return 'audioStream' in obj && 'model' in obj;
}

/**
 * Collect a ReadableStream into a Buffer.
 */
export async function collectStreamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  try {
    let result = await reader.read();
    while (!result.done) {
      chunks.push(result.value);
      result = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }

  // Calculate total length
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);

  // Combine chunks into a single buffer
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return Buffer.from(combined);
}

/**
 * Estimate audio duration from text for TTS.
 * Assumes approximately 150 words per minute speaking rate.
 */
export function estimateTTSDuration(text: string): number {
  const words = text.trim().split(/\s+/).length;
  const wordsPerMinute = 150;
  const minutes = words / wordsPerMinute;
  const seconds = minutes * 60;
  // Minimum 1 second, maximum 300 seconds (5 minutes)
  return Math.max(1, Math.min(300, Math.ceil(seconds)));
}

/**
 * Extract duration from music input parameters.
 */
export function extractMusicDuration(input: Record<string, unknown>): number {
  const lengthMs = input.music_length_ms;
  if (typeof lengthMs === 'number' && lengthMs > 0) {
    return Math.ceil(lengthMs / 1000); // Convert ms to seconds
  }
  // Default to 30 seconds
  return 30;
}
