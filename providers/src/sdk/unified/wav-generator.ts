/**
 * Generates a minimal valid WAV file with specified duration.
 * WAV format: 44-byte header + PCM samples
 * Uses 8kHz mono 8-bit for minimal file size (~8KB/second)
 *
 * This is used for dry-run mode to generate mock audio/video assets
 * that mediabunny can extract duration from, ensuring the same code
 * path is used for both simulated and live modes.
 */
export function generateWavWithDuration(durationSeconds: number): Buffer {
  const sampleRate = 8000;
  const bitsPerSample = 8;
  const numChannels = 1;
  const bytesPerSample = bitsPerSample / 8;

  const numSamples = Math.ceil(durationSeconds * sampleRate);
  const dataSize = numSamples * numChannels * bytesPerSample;
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  // RIFF header
  buffer.write('RIFF', offset);
  offset += 4;
  buffer.writeUInt32LE(fileSize - 8, offset);
  offset += 4;
  buffer.write('WAVE', offset);
  offset += 4;

  // fmt subchunk
  buffer.write('fmt ', offset);
  offset += 4;
  buffer.writeUInt32LE(16, offset);
  offset += 4; // Subchunk1Size (16 for PCM)
  buffer.writeUInt16LE(1, offset);
  offset += 2; // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, offset);
  offset += 2; // NumChannels
  buffer.writeUInt32LE(sampleRate, offset);
  offset += 4; // SampleRate
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, offset);
  offset += 4; // ByteRate
  buffer.writeUInt16LE(numChannels * bytesPerSample, offset);
  offset += 2; // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, offset);
  offset += 2; // BitsPerSample

  // data subchunk
  buffer.write('data', offset);
  offset += 4;
  buffer.writeUInt32LE(dataSize, offset);
  offset += 4;

  // Audio data (silence - all 128 for 8-bit unsigned PCM)
  buffer.fill(128, offset, offset + dataSize);

  return buffer;
}
