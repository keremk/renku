import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isFileReference,
  resolveFileReference,
  resolveFileReferences,
} from './file-input-resolver.js';
import { Buffer } from 'node:buffer';

describe('parsing/file-input-resolver', () => {
  describe('isFileReference', () => {
    it('returns true for strings with file: prefix', () => {
      expect(isFileReference('file:./image.png')).toBe(true);
      expect(isFileReference('file:/absolute/path/audio.mp3')).toBe(true);
    });

    it('returns false for strings without file: prefix', () => {
      expect(isFileReference('./image.png')).toBe(false);
      expect(isFileReference('just a string')).toBe(false);
      expect(isFileReference('FILE:uppercase.txt')).toBe(false);
    });

    it('returns false for non-string values', () => {
      expect(isFileReference(123)).toBe(false);
      expect(isFileReference(null)).toBe(false);
      expect(isFileReference(undefined)).toBe(false);
      expect(isFileReference({ file: 'path' })).toBe(false);
      expect(isFileReference(['file:path'])).toBe(false);
    });
  });

  describe('resolveFileReference', () => {
    it('loads file and infers MIME type for image', async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'renku-file-resolver-'));
      const testImagePath = join(workdir, 'test.png');
      const testContent = Buffer.from('fake png content');
      await writeFile(testImagePath, testContent);

      const result = await resolveFileReference('file:./test.png', { baseDir: workdir });

      expect(result.data).toEqual(testContent);
      expect(result.mimeType).toBe('image/png');
    });

    it('loads file with absolute path', async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'renku-file-resolver-'));
      const testAudioPath = join(workdir, 'audio.mp3');
      const testContent = Buffer.from('fake audio content');
      await writeFile(testAudioPath, testContent);

      const result = await resolveFileReference(`file:${testAudioPath}`, { baseDir: '/some/other/dir' });

      expect(result.data).toEqual(testContent);
      expect(result.mimeType).toBe('audio/mpeg');
    });

    it('infers MIME type for various extensions', async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'renku-file-resolver-'));
      const testCases = [
        { filename: 'video.mp4', expectedMime: 'video/mp4' },
        { filename: 'image.jpg', expectedMime: 'image/jpeg' },
        { filename: 'image.jpeg', expectedMime: 'image/jpeg' },
        { filename: 'sound.wav', expectedMime: 'audio/wav' },
        { filename: 'data.json', expectedMime: 'application/json' },
        { filename: 'text.txt', expectedMime: 'text/plain' },
        { filename: 'unknown.xyz', expectedMime: 'application/octet-stream' },
      ];

      for (const { filename, expectedMime } of testCases) {
        const filePath = join(workdir, filename);
        await writeFile(filePath, 'content');
        const result = await resolveFileReference(`file:./${filename}`, { baseDir: workdir });
        expect(result.mimeType).toBe(expectedMime);
      }
    });

    it('throws error for missing file', async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'renku-file-resolver-'));
      await expect(
        resolveFileReference('file:./nonexistent.png', { baseDir: workdir }),
      ).rejects.toThrow(/Failed to load file.*nonexistent\.png/);
    });
  });

  describe('resolveFileReferences', () => {
    it('resolves single file reference', async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'renku-file-resolver-'));
      const testImagePath = join(workdir, 'image.png');
      await writeFile(testImagePath, 'test content');

      const result = await resolveFileReferences('file:./image.png', { baseDir: workdir });

      expect(result).toMatchObject({
        data: expect.any(Buffer),
        mimeType: 'image/png',
      });
    });

    it('resolves array of file references', async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'renku-file-resolver-'));
      await writeFile(join(workdir, 'img1.png'), 'content1');
      await writeFile(join(workdir, 'img2.jpg'), 'content2');

      const result = await resolveFileReferences(
        ['file:./img1.png', 'file:./img2.jpg'],
        { baseDir: workdir },
      );

      expect(Array.isArray(result)).toBe(true);
      const array = result as Array<{ data: Buffer; mimeType: string }>;
      expect(array).toHaveLength(2);
      expect(array[0]?.mimeType).toBe('image/png');
      expect(array[1]?.mimeType).toBe('image/jpeg');
    });

    it('resolves mixed array with file references and plain values', async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'renku-file-resolver-'));
      await writeFile(join(workdir, 'img.png'), 'content');

      const result = await resolveFileReferences(
        ['file:./img.png', 'plain string', 123],
        { baseDir: workdir },
      );

      expect(Array.isArray(result)).toBe(true);
      const array = result as unknown[];
      expect(array).toHaveLength(3);
      expect(array[0]).toMatchObject({ mimeType: 'image/png' });
      expect(array[1]).toBe('plain string');
      expect(array[2]).toBe(123);
    });

    it('returns non-file values unchanged', async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'renku-file-resolver-'));
      expect(await resolveFileReferences('plain string', { baseDir: workdir })).toBe('plain string');
      expect(await resolveFileReferences(123, { baseDir: workdir })).toBe(123);
      expect(await resolveFileReferences(null, { baseDir: workdir })).toBe(null);
      expect(await resolveFileReferences(undefined, { baseDir: workdir })).toBe(undefined);

      const obj = { key: 'value' };
      expect(await resolveFileReferences(obj, { baseDir: workdir })).toBe(obj);
    });

    it('handles nested directories in relative paths', async () => {
      const workdir = await mkdtemp(join(tmpdir(), 'renku-file-resolver-'));
      const subDir = join(workdir, 'assets', 'images');
      await mkdir(subDir, { recursive: true });
      await writeFile(join(subDir, 'nested.png'), 'nested content');

      const result = await resolveFileReferences(
        'file:./assets/images/nested.png',
        { baseDir: workdir },
      );

      expect(result).toMatchObject({
        data: expect.any(Buffer),
        mimeType: 'image/png',
      });
    });
  });
});
