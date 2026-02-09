import { Buffer } from 'node:buffer';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TranscriptionClip } from '@gorenku/compositions';
import { __test__ } from './transcription-handler.js';

const { parseTranscriptionConfig, loadAudioSegmentsFromTranscriptionTrack } = __test__;

function makeTranscriptionClip(index: number, startTime: number, duration: number, assetId: string): TranscriptionClip {
  return {
    id: `clip-t-${index}`,
    kind: 'Transcription',
    startTime,
    duration,
    properties: { assetId },
  };
}

async function writeBinaryFile(storageRoot: string, relativePath: string, data: Buffer): Promise<void> {
  const absolutePath = resolve(storageRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, data);
}

describe('parseTranscriptionConfig', () => {
  it('parses valid config with stt provider and model', () => {
    const config = parseTranscriptionConfig({
      languageCode: 'eng',
      stt: { provider: 'fal-ai', model: 'elevenlabs/speech-to-text' },
    });
    expect(config.languageCode).toBe('eng');
    expect(config.stt.provider).toBe('fal-ai');
    expect(config.stt.model).toBe('elevenlabs/speech-to-text');
  });

  it('forwards additional stt config properties', () => {
    const config = parseTranscriptionConfig({
      stt: { provider: 'fal-ai', model: 'elevenlabs/stt', diarize: true, tag_audio_events: false },
    });
    expect(config.stt.diarize).toBe(true);
    expect(config.stt.tag_audio_events).toBe(false);
  });

  it('throws when stt object is missing', () => {
    expect(() => parseTranscriptionConfig({})).toThrow(/config\.stt/);
  });

  it('throws when stt.provider is missing', () => {
    expect(() => parseTranscriptionConfig({ stt: { model: 'x' } })).toThrow(/provider/);
  });

  it('throws when stt.model is missing', () => {
    expect(() => parseTranscriptionConfig({ stt: { provider: 'x' } })).toThrow(/model/);
  });
});

describe('loadAudioSegmentsFromTranscriptionTrack', () => {
  let storageRoot = '';

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'renku-transcription-handler-'));
  });

  afterEach(async () => {
    if (storageRoot) {
      await rm(storageRoot, { recursive: true, force: true });
    }
  });

  it('loads audio segments from canonical asset blob paths', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:AudioProducer.GeneratedAudio[0]'),
      makeTranscriptionClip(1, 10, 8, 'Artifact:AudioProducer.GeneratedAudio[1]'),
    ];
    const assetBlobPaths: Record<string, string> = {
      'Artifact:AudioProducer.GeneratedAudio[0]': 'builds/movie-123/blobs/aa/audio-0.mp3',
      'Artifact:AudioProducer.GeneratedAudio[1]': 'builds/movie-123/blobs/bb/audio-1.mp3',
    };
    const segment0Data = Buffer.from('audio-segment-0');
    const segment1Data = Buffer.from('audio-segment-1');

    await writeBinaryFile(storageRoot, assetBlobPaths['Artifact:AudioProducer.GeneratedAudio[0]']!, segment0Data);
    await writeBinaryFile(storageRoot, assetBlobPaths['Artifact:AudioProducer.GeneratedAudio[1]']!, segment1Data);

    const segments = await loadAudioSegmentsFromTranscriptionTrack(clips, assetBlobPaths, storageRoot);

    expect(segments).toHaveLength(2);
    expect(segments[0]?.assetId).toBe('Artifact:AudioProducer.GeneratedAudio[0]');
    expect(segments[0]?.startTime).toBe(0);
    expect(segments[0]?.duration).toBe(10);
    expect(segments[0]?.buffer.equals(segment0Data)).toBe(true);
    expect(segments[1]?.assetId).toBe('Artifact:AudioProducer.GeneratedAudio[1]');
    expect(segments[1]?.startTime).toBe(10);
    expect(segments[1]?.duration).toBe(8);
    expect(segments[1]?.buffer.equals(segment1Data)).toBe(true);
  });

  it('throws when a clip asset ID is missing in assetBlobPaths', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:AudioProducer.GeneratedAudio[0]'),
    ];
    const assetBlobPaths: Record<string, string> = {};

    await expect(
      loadAudioSegmentsFromTranscriptionTrack(clips, assetBlobPaths, storageRoot),
    ).rejects.toThrow(/missing blob path/i);
  });

  it('throws when the resolved file path does not exist', async () => {
    const clips: TranscriptionClip[] = [
      makeTranscriptionClip(0, 0, 10, 'Artifact:AudioProducer.GeneratedAudio[0]'),
    ];
    const assetBlobPaths: Record<string, string> = {
      'Artifact:AudioProducer.GeneratedAudio[0]': 'builds/movie-123/blobs/aa/missing.mp3',
    };

    await expect(
      loadAudioSegmentsFromTranscriptionTrack(clips, assetBlobPaths, storageRoot),
    ).rejects.toThrow(/could not read audio file/i);
  });

  it('resolves storage-relative blob paths to absolute files under storage root', async () => {
    const clip = makeTranscriptionClip(0, 4, 6, 'Artifact:AudioProducer.GeneratedAudio[0]');
    const relativeBlobPath = 'builds/movie-abc/blobs/cc/audio.mp3';
    const assetBlobPaths = {
      'Artifact:AudioProducer.GeneratedAudio[0]': relativeBlobPath,
    };
    const expectedData = Buffer.from('fixture-audio-bytes');

    await writeBinaryFile(storageRoot, relativeBlobPath, expectedData);

    const segments = await loadAudioSegmentsFromTranscriptionTrack([clip], assetBlobPaths, storageRoot);
    expect(segments).toHaveLength(1);
    expect(segments[0]?.buffer.equals(expectedData)).toBe(true);

    const absolutePath = resolve(storageRoot, relativeBlobPath);
    const fileData = await readFile(absolutePath);
    expect(fileData.equals(expectedData)).toBe(true);
  });
});
