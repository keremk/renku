import { describe, it, expect } from 'vitest';
import { generateWavWithDuration } from './wav-generator.js';

describe('generateWavWithDuration', () => {
  it('generates a valid WAV file header', () => {
    const buffer = generateWavWithDuration(1);

    // Check RIFF header
    expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buffer.toString('ascii', 8, 12)).toBe('WAVE');

    // Check fmt subchunk
    expect(buffer.toString('ascii', 12, 16)).toBe('fmt ');
    expect(buffer.readUInt32LE(16)).toBe(16); // Subchunk1Size
    expect(buffer.readUInt16LE(20)).toBe(1); // AudioFormat (PCM)
    expect(buffer.readUInt16LE(22)).toBe(1); // NumChannels (mono)
    expect(buffer.readUInt32LE(24)).toBe(8000); // SampleRate
    expect(buffer.readUInt16LE(34)).toBe(8); // BitsPerSample

    // Check data subchunk
    expect(buffer.toString('ascii', 36, 40)).toBe('data');
  });

  it('generates correct file size for given duration', () => {
    const duration = 5; // 5 seconds
    const buffer = generateWavWithDuration(duration);

    // 8kHz * 5 seconds * 1 channel * 1 byte/sample = 40000 samples
    const expectedDataSize = 8000 * duration;
    const expectedFileSize = 44 + expectedDataSize;

    expect(buffer.length).toBe(expectedFileSize);

    // Check RIFF chunk size (file size - 8)
    expect(buffer.readUInt32LE(4)).toBe(expectedFileSize - 8);

    // Check data chunk size
    expect(buffer.readUInt32LE(40)).toBe(expectedDataSize);
  });

  it('generates silence (128 for 8-bit unsigned PCM)', () => {
    const buffer = generateWavWithDuration(1);

    // Check that audio data is silence (128 for 8-bit unsigned PCM)
    const dataStart = 44;
    const dataEnd = buffer.length;

    for (let i = dataStart; i < Math.min(dataStart + 100, dataEnd); i++) {
      expect(buffer[i]).toBe(128);
    }
  });

  it('handles fractional durations', () => {
    const duration = 2.5; // 2.5 seconds
    const buffer = generateWavWithDuration(duration);

    // 8kHz * 2.5 seconds = 20000 samples (ceil for fractional)
    const expectedDataSize = Math.ceil(8000 * duration);
    const expectedFileSize = 44 + expectedDataSize;

    expect(buffer.length).toBe(expectedFileSize);
  });

  it('handles very short durations', () => {
    const duration = 0.1; // 100ms
    const buffer = generateWavWithDuration(duration);

    // 8kHz * 0.1 seconds = 800 samples
    const expectedDataSize = Math.ceil(8000 * duration);
    const expectedFileSize = 44 + expectedDataSize;

    expect(buffer.length).toBe(expectedFileSize);

    // Should still be a valid WAV
    expect(buffer.toString('ascii', 0, 4)).toBe('RIFF');
    expect(buffer.toString('ascii', 8, 12)).toBe('WAVE');
  });

  it('handles longer durations', () => {
    const duration = 30; // 30 seconds
    const buffer = generateWavWithDuration(duration);

    // 8kHz * 30 seconds = 240000 samples
    const expectedDataSize = 8000 * duration;
    const expectedFileSize = 44 + expectedDataSize;

    expect(buffer.length).toBe(expectedFileSize);
    // ~240KB - reasonable for dry-run verification
    expect(buffer.length).toBeLessThan(300000);
  });

  it('has correct byte rate in header', () => {
    const buffer = generateWavWithDuration(1);

    // ByteRate = SampleRate * NumChannels * BytesPerSample
    // 8000 * 1 * 1 = 8000
    expect(buffer.readUInt32LE(28)).toBe(8000);
  });

  it('has correct block align in header', () => {
    const buffer = generateWavWithDuration(1);

    // BlockAlign = NumChannels * BytesPerSample
    // 1 * 1 = 1
    expect(buffer.readUInt16LE(32)).toBe(1);
  });
});
