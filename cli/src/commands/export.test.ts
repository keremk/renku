import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { loadExportConfig } from './export.js';

const tmpDirs: string[] = [];

afterEach(async () => {
  while (tmpDirs.length) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'renku-export-test-'));
  tmpDirs.push(dir);
  return dir;
}

async function writeConfigFile(dir: string, config: Record<string, unknown>, filename = 'config.yaml'): Promise<string> {
  const filePath = join(dir, filename);
  await writeFile(filePath, stringifyYaml(config), 'utf8');
  return filePath;
}

describe('loadExportConfig', () => {
  it('loads valid export config with all fields', async () => {
    const dir = await createTempDir();
    const config = {
      width: 1920,
      height: 1080,
      fps: 30,
      exporter: 'ffmpeg',
      preset: 'medium',
      crf: 23,
      audioBitrate: '192k',
      subtitles: {
        font: 'Arial',
        fontSize: 48,
        fontBaseColor: '#FFFFFF',
        fontHighlightColor: '#FFD700',
        backgroundColor: '#000000',
        backgroundOpacity: 0.5,
        bottomMarginPercent: 10,
        maxWordsPerLine: 4,
        highlightEffect: true,
      },
    };
    const filePath = await writeConfigFile(dir, config);

    const loaded = await loadExportConfig(filePath);

    expect(loaded).toEqual(config);
  });

  it('loads config with only some fields', async () => {
    const dir = await createTempDir();
    const config = {
      fps: 24,
      subtitles: {
        font: 'Helvetica',
        maxWordsPerLine: 6,
      },
    };
    const filePath = await writeConfigFile(dir, config);

    const loaded = await loadExportConfig(filePath);

    expect(loaded.fps).toBe(24);
    expect(loaded.subtitles?.font).toBe('Helvetica');
    expect(loaded.subtitles?.maxWordsPerLine).toBe(6);
    expect(loaded.width).toBeUndefined();
    expect(loaded.height).toBeUndefined();
  });

  it('loads empty config file', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, {});

    const loaded = await loadExportConfig(filePath);

    expect(loaded).toEqual({});
  });

  it('rejects non-YAML file extension', async () => {
    const dir = await createTempDir();
    const filePath = join(dir, 'config.json');
    await writeFile(filePath, '{}', 'utf8');

    await expect(loadExportConfig(filePath)).rejects.toThrow(
      /Export config file must be YAML/
    );
  });

  it('rejects invalid width type', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, { width: 'not a number' });

    await expect(loadExportConfig(filePath)).rejects.toThrow(
      /'width' must be a number/
    );
  });

  it('rejects invalid fps type', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, { fps: '30' });

    await expect(loadExportConfig(filePath)).rejects.toThrow(
      /'fps' must be a number/
    );
  });

  it('rejects invalid exporter value', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, { exporter: 'invalid' });

    await expect(loadExportConfig(filePath)).rejects.toThrow(
      /'exporter' must be "remotion" or "ffmpeg"/
    );
  });

  it('accepts remotion exporter', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, { exporter: 'remotion' });

    const loaded = await loadExportConfig(filePath);

    expect(loaded.exporter).toBe('remotion');
  });

  it('accepts ffmpeg exporter', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, { exporter: 'ffmpeg' });

    const loaded = await loadExportConfig(filePath);

    expect(loaded.exporter).toBe('ffmpeg');
  });

  it('rejects invalid subtitles.fontSize type', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, {
      subtitles: { fontSize: 'large' },
    });

    await expect(loadExportConfig(filePath)).rejects.toThrow(
      /'subtitles.fontSize' must be a number/
    );
  });

  it('rejects invalid subtitles.highlightEffect type', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, {
      subtitles: { highlightEffect: 'yes' },
    });

    await expect(loadExportConfig(filePath)).rejects.toThrow(
      /'subtitles.highlightEffect' must be a boolean/
    );
  });

  it('warns on unknown top-level keys', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, {
      fps: 30,
      unknownKey: 'value',
      anotherUnknown: 123,
    });

    const mockLogger = { warn: vi.fn() };
    await loadExportConfig(filePath, mockLogger);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknownKey')
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('anotherUnknown')
    );
  });

  it('warns on unknown subtitle keys', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, {
      subtitles: {
        font: 'Arial',
        unknownSubtitleKey: 'value',
      },
    });

    const mockLogger = { warn: vi.fn() };
    await loadExportConfig(filePath, mockLogger);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('subtitles.unknownSubtitleKey')
    );
  });

  it('continues without logger when unknown keys exist', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, {
      fps: 30,
      unknownKey: 'value',
    });

    // Should not throw when logger is not provided
    const loaded = await loadExportConfig(filePath);

    expect(loaded.fps).toBe(30);
  });

  it('accepts .yml extension', async () => {
    const dir = await createTempDir();
    const filePath = await writeConfigFile(dir, { fps: 60 }, 'config.yml');

    const loaded = await loadExportConfig(filePath);

    expect(loaded.fps).toBe(60);
  });

  it('rejects non-object YAML content', async () => {
    const dir = await createTempDir();
    const filePath = join(dir, 'config.yaml');
    await writeFile(filePath, '- item1\n- item2', 'utf8');

    await expect(loadExportConfig(filePath)).rejects.toThrow(
      /must contain a YAML object/
    );
  });

  it('rejects null subtitles', async () => {
    const dir = await createTempDir();
    const filePath = join(dir, 'config.yaml');
    await writeFile(filePath, 'subtitles: null', 'utf8');

    await expect(loadExportConfig(filePath)).rejects.toThrow(
      /'subtitles' must be an object/
    );
  });
});
