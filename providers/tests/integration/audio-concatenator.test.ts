import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, beforeAll } from 'vitest';
import {
  concatenateWithSilence,
  buildMixCommand,
  generateSilence,
  convertToWav,
} from '../../src/producers/transcription/audio-concatenator.js';
import type { AudioSegment } from '../../src/producers/transcription/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURES_DIR = join(__dirname, '../fixtures');

/**
 * These tests require ffmpeg to be installed on the system.
 * They test the actual ffmpeg commands with real audio data.
 */
describe('integration: audio-concatenator', () => {
  let audioFixture: Buffer;

  beforeAll(async () => {
    // Load the test audio fixture
    audioFixture = await readFile(join(FIXTURES_DIR, 'audio-fixture.mp3'));
    expect(audioFixture.length).toBeGreaterThan(0);
  });

  describe('generateSilence', () => {
    it('generates valid WAV audio for 1 second duration', async () => {
      const result = await generateSilence(1);

      // Should return a buffer
      expect(Buffer.isBuffer(result)).toBe(true);

      // WAV files start with "RIFF" header
      expect(result.slice(0, 4).toString('ascii')).toBe('RIFF');

      // Should have reasonable size for 1 second of 16kHz mono audio
      // 16000 samples/sec * 2 bytes/sample * 1 sec = 32000 bytes + header
      expect(result.length).toBeGreaterThan(30000);
      expect(result.length).toBeLessThan(40000);
    });

    it('generates valid WAV audio for 5 second duration', async () => {
      const result = await generateSilence(5);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.slice(0, 4).toString('ascii')).toBe('RIFF');

      // ~160000 bytes for 5 seconds + header
      expect(result.length).toBeGreaterThan(150000);
      expect(result.length).toBeLessThan(170000);
    });

    it('generates valid WAV audio for fractional duration', async () => {
      const result = await generateSilence(2.5);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.slice(0, 4).toString('ascii')).toBe('RIFF');

      // ~80000 bytes for 2.5 seconds + header
      expect(result.length).toBeGreaterThan(75000);
      expect(result.length).toBeLessThan(90000);
    });
  });

  describe('convertToWav', () => {
    it('converts MP3 audio fixture to WAV format', async () => {
      const result = await convertToWav(audioFixture);

      // Should return a buffer
      expect(Buffer.isBuffer(result)).toBe(true);

      // WAV files start with "RIFF" header
      expect(result.slice(0, 4).toString('ascii')).toBe('RIFF');

      // Should have reasonable size (WAV is larger than MP3)
      expect(result.length).toBeGreaterThan(audioFixture.length);
    });

    it('outputs 16kHz mono WAV', async () => {
      const result = await convertToWav(audioFixture);

      // Parse WAV header to verify format
      // Bytes 22-23: number of channels (1 = mono)
      const numChannels = result.readUInt16LE(22);
      expect(numChannels).toBe(1);

      // Bytes 24-27: sample rate (16000 Hz)
      const sampleRate = result.readUInt32LE(24);
      expect(sampleRate).toBe(16000);

      // Bytes 34-35: bits per sample (16 for pcm_s16le)
      const bitsPerSample = result.readUInt16LE(34);
      expect(bitsPerSample).toBe(16);
    });
  });

  describe('buildMixCommand', () => {
    it('builds correct ffmpeg command for single segment', () => {
      const segments: AudioSegment[] = [
        {
          buffer: Buffer.alloc(1000),
          startTime: 0,
          duration: 5,
          clipId: 'clip-0',
          assetId: 'asset-0',
        },
      ];

      const args = buildMixCommand(
        ['/tmp/segment-0.mp3'],
        segments,
        10,
        '/tmp/test'
      );

      // Should include anullsrc with correct duration
      expect(args).toContain('-f');
      expect(args).toContain('lavfi');
      expect(args.some(arg => arg.includes('anullsrc=r=16000:cl=mono:d=10'))).toBe(true);

      // Should include the segment file
      expect(args).toContain('/tmp/segment-0.mp3');

      // Should include filter_complex
      expect(args).toContain('-filter_complex');

      // Should include output format options
      expect(args).toContain('-acodec');
      expect(args).toContain('pcm_s16le');
      expect(args).toContain('-f');
      expect(args).toContain('wav');

      // Output path should be in the temp directory
      expect(args).toContain('/tmp/test/output.wav');
    });

    it('builds correct ffmpeg command for multiple segments with delays', () => {
      const segments: AudioSegment[] = [
        {
          buffer: Buffer.alloc(1000),
          startTime: 0,
          duration: 3,
          clipId: 'clip-0',
          assetId: 'asset-0',
        },
        {
          buffer: Buffer.alloc(1000),
          startTime: 5,
          duration: 3,
          clipId: 'clip-1',
          assetId: 'asset-1',
        },
        {
          buffer: Buffer.alloc(1000),
          startTime: 10,
          duration: 3,
          clipId: 'clip-2',
          assetId: 'asset-2',
        },
      ];

      const args = buildMixCommand(
        ['/tmp/segment-0.mp3', '/tmp/segment-1.mp3', '/tmp/segment-2.mp3'],
        segments,
        15,
        '/tmp/test'
      );

      // Find the filter_complex argument
      const filterIndex = args.indexOf('-filter_complex');
      const filterComplex = args[filterIndex + 1];

      // Should have delays for segments 1 and 2 (5000ms and 10000ms)
      expect(filterComplex).toContain('adelay=0|0');
      expect(filterComplex).toContain('adelay=5000|5000');
      expect(filterComplex).toContain('adelay=10000|10000');

      // Should mix 4 inputs (silence + 3 segments)
      expect(filterComplex).toContain('amix=inputs=4');
    });

    it('uses duration=longest for amix', () => {
      const segments: AudioSegment[] = [
        {
          buffer: Buffer.alloc(1000),
          startTime: 2,
          duration: 3,
          clipId: 'clip-0',
          assetId: 'asset-0',
        },
      ];

      const args = buildMixCommand(
        ['/tmp/segment-0.mp3'],
        segments,
        10,
        '/tmp/test'
      );

      const filterIndex = args.indexOf('-filter_complex');
      const filterComplex = args[filterIndex + 1];

      expect(filterComplex).toContain('duration=longest');
    });
  });

  describe('concatenateWithSilence', () => {
    it('returns silence when given empty segments array', async () => {
      const result = await concatenateWithSilence([], 5);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.slice(0, 4).toString('ascii')).toBe('RIFF');

      // Should be ~5 seconds of silence
      expect(result.length).toBeGreaterThan(150000);
    });

    it('converts single segment starting at 0 to WAV', async () => {
      const segments: AudioSegment[] = [
        {
          buffer: audioFixture,
          startTime: 0,
          duration: 5,
          clipId: 'clip-0',
          assetId: 'asset-0',
        },
      ];

      const result = await concatenateWithSilence(segments, 5);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.slice(0, 4).toString('ascii')).toBe('RIFF');
    });

    it('concatenates multiple segments with correct timing', async () => {
      // Use the same audio fixture for multiple segments
      const segments: AudioSegment[] = [
        {
          buffer: audioFixture,
          startTime: 0,
          duration: 3,
          clipId: 'clip-0',
          assetId: 'asset-0',
        },
        {
          buffer: audioFixture,
          startTime: 5,
          duration: 3,
          clipId: 'clip-1',
          assetId: 'asset-1',
        },
      ];

      const result = await concatenateWithSilence(segments, 10);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.slice(0, 4).toString('ascii')).toBe('RIFF');

      // Result should be ~10 seconds at 16kHz mono
      // 16000 * 2 * 10 = 320000 bytes + header overhead
      // Note: amix filter may add some overhead
      expect(result.length).toBeGreaterThan(300000);
      expect(result.length).toBeLessThan(400000);
    });

    it('handles single segment not starting at 0', async () => {
      const segments: AudioSegment[] = [
        {
          buffer: audioFixture,
          startTime: 2.5, // Starts at 2.5 seconds
          duration: 3,
          clipId: 'clip-0',
          assetId: 'asset-0',
        },
      ];

      const result = await concatenateWithSilence(segments, 8);

      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.slice(0, 4).toString('ascii')).toBe('RIFF');

      // Result should be ~8 seconds
      // Note: amix filter adds overhead, so size may be larger than raw calculation
      expect(result.length).toBeGreaterThan(240000);
      expect(result.length).toBeLessThan(320000);
    });
  });
});
