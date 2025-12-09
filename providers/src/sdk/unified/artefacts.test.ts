import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildArtefactsFromUrls, downloadBinary } from './artefacts.js';

// Mock fetch globally
global.fetch = vi.fn();

describe('downloadBinary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads binary data successfully', async () => {
    const testData = new Uint8Array([1, 2, 3, 4, 5]);
    const mockResponse = {
      ok: true,
      status: 200,
      arrayBuffer: async () => testData.buffer,
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    const result = await downloadBinary('https://example.com/file.bin');

    expect(global.fetch).toHaveBeenCalledWith('https://example.com/file.bin');
    expect(result).toBeInstanceOf(Buffer);
    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5]);
  });

  it('throws error on non-ok response', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
    };
    (global.fetch as any).mockResolvedValue(mockResponse);

    await expect(downloadBinary('https://example.com/missing.bin')).rejects.toThrow(
      'Failed to download https://example.com/missing.bin (404)',
    );
  });

  it('throws error on network failure', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network error'));

    await expect(downloadBinary('https://example.com/file.bin')).rejects.toThrow('Network error');
  });
});

describe('buildArtefactsFromUrls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds artefacts successfully from URLs', async () => {
    const testData1 = new Uint8Array([1, 2, 3]);
    const testData2 = new Uint8Array([4, 5, 6]);

    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => testData1.buffer,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => testData2.buffer,
      });

    const result = await buildArtefactsFromUrls({
      produces: ['Artifact:Image#0', 'Artifact:Image#1'],
      urls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
      mimeType: 'image/jpeg',
    });

    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      artefactId: 'Artifact:Image#0',
      status: 'succeeded',
      blob: {
        data: expect.any(Buffer),
        mimeType: 'image/jpeg',
      },
      diagnostics: {
        sourceUrl: 'https://example.com/img1.jpg',
      },
    });

    expect(result[1]).toEqual({
      artefactId: 'Artifact:Image#1',
      status: 'succeeded',
      blob: {
        data: expect.any(Buffer),
        mimeType: 'image/jpeg',
      },
      diagnostics: {
        sourceUrl: 'https://example.com/img2.jpg',
      },
    });
  });

  it('handles missing URLs with failed status', async () => {
    const result = await buildArtefactsFromUrls({
      produces: ['Artifact:Image#0', 'Artifact:Image#1'],
      urls: ['https://example.com/img1.jpg'], // Missing second URL
      mimeType: 'image/jpeg',
    });

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      artefactId: 'Artifact:Image#1',
      status: 'failed',
      diagnostics: {
        reason: 'missing_output',
        index: 1,
      },
    });
  });

  it('handles download failures with failed status', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

    const result = await buildArtefactsFromUrls({
      produces: ['Artifact:Image#0', 'Artifact:Image#1'],
      urls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg'],
      mimeType: 'image/jpeg',
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.status).toBe('succeeded');
    expect(result[1]).toEqual({
      artefactId: 'Artifact:Image#1',
      status: 'failed',
      diagnostics: {
        reason: 'download_failed',
        url: 'https://example.com/img2.jpg',
        error: 'Failed to download https://example.com/img2.jpg (500)',
      },
    });
  });

  it('uses default artefact ID when not provided', async () => {
    const testData = new Uint8Array([1, 2, 3]);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => testData.buffer,
    });

    const result = await buildArtefactsFromUrls({
      produces: [''],
      urls: ['https://example.com/img.jpg'],
      mimeType: 'image/jpeg',
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.artefactId).toBe('Artifact:Output#0');
  });

  it('handles empty produces and urls arrays', async () => {
    const result = await buildArtefactsFromUrls({
      produces: [],
      urls: [],
      mimeType: 'image/jpeg',
    });

    expect(result).toEqual([]);
  });

  it('preserves MIME type in successful artefacts', async () => {
    const testData = new Uint8Array([1, 2, 3]);
    (global.fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => testData.buffer,
    });

    const result = await buildArtefactsFromUrls({
      produces: ['Artifact:Audio#0'],
      urls: ['https://example.com/audio.mp3'],
      mimeType: 'audio/mpeg',
    });

    expect(result[0]?.blob?.mimeType).toBe('audio/mpeg');
  });

  it('handles network errors with failed status', async () => {
    (global.fetch as any).mockRejectedValue(new Error('Network timeout'));

    const result = await buildArtefactsFromUrls({
      produces: ['Artifact:Image#0'],
      urls: ['https://example.com/img.jpg'],
      mimeType: 'image/jpeg',
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      artefactId: 'Artifact:Image#0',
      status: 'failed',
      diagnostics: {
        reason: 'download_failed',
        url: 'https://example.com/img.jpg',
        error: 'Network timeout',
      },
    });
  });

  it('skips downloads and creates placeholder data in simulated mode', async () => {
    const result = await buildArtefactsFromUrls({
      produces: ['Artifact:Image#0'],
      urls: ['https://example.com/img.jpg'],
      mimeType: 'image/jpeg',
      mode: 'simulated',
    });

    expect(global.fetch).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('succeeded');
    expect(result[0]?.blob?.data).toBeInstanceOf(Buffer);
  });
});
