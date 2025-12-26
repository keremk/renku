import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  buildArtefactsFromUrls,
  buildArtefactsFromJsonResponse,
  downloadBinary,
  parseArtefactIdentifier,
} from './artefacts.js';

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

describe('buildArtefactsFromJsonResponse', () => {
  it('trims namespace ordinals so nested fanout arrays resolve correctly', () => {
    const response = {
      ImagePrompt: ['first frame', 'second frame'],
    };
    const produces = [
      'Artifact:ImagePromptGenerator.ImagePrompt[0][0]',
      'Artifact:ImagePromptGenerator.ImagePrompt[0][1]',
    ];

    const artefacts = buildArtefactsFromJsonResponse(response, produces, {
      producerId: 'Producer:ImagePromptGenerator.ImagePromptProducer[0]',
    });

    expect(artefacts).toHaveLength(2);
    expect(artefacts[0]?.blob?.data).toBe('first frame');
    expect(artefacts[1]?.blob?.data).toBe('second frame');
    expect(artefacts.every((artefact) => artefact.status === 'succeeded')).toBe(true);
  });

  it('skips indexing when artefacts only carry namespace ordinals', () => {
    const response = {
      ImageSummary: 'concise summary',
    };
    const produces = ['Artifact:ImagePromptGenerator.ImageSummary[0]'];

    const artefacts = buildArtefactsFromJsonResponse(response, produces, {
      producerId: 'Producer:ImagePromptGenerator.ImagePromptProducer[0]',
    });

    expect(artefacts).toHaveLength(1);
    expect(artefacts[0]?.blob?.data).toBe('concise summary');
    expect(artefacts[0]?.status).toBe('succeeded');
  });

  it('handles string response by returning it as-is', () => {
    const response = 'Plain text response';
    const produces = ['Artifact:TextOutput'];

    const artefacts = buildArtefactsFromJsonResponse(response, produces);

    expect(artefacts).toHaveLength(1);
    expect(artefacts[0]?.blob?.data).toBe('Plain text response');
    expect(artefacts[0]?.status).toBe('succeeded');
  });

  it('handles simple field extraction', () => {
    const response = {
      Title: 'My Movie',
      Description: 'A great film',
    };
    const produces = ['Artifact:Title', 'Artifact:Description'];

    const artefacts = buildArtefactsFromJsonResponse(response, produces);

    expect(artefacts).toHaveLength(2);
    expect(artefacts[0]?.blob?.data).toBe('My Movie');
    expect(artefacts[1]?.blob?.data).toBe('A great film');
  });

  it('returns failure for missing fields', () => {
    const response = {
      Title: 'Exists',
    };
    const produces = ['Artifact:Title', 'Artifact:Missing'];

    const artefacts = buildArtefactsFromJsonResponse(response, produces);

    expect(artefacts).toHaveLength(2);
    expect(artefacts[0]?.status).toBe('succeeded');
    expect(artefacts[1]?.status).toBe('failed');
    expect(artefacts[1]?.diagnostics?.reason).toBe('missing_field');
  });

  describe('decomposed JSON artifacts', () => {
    it('extracts nested fields using JSON path for decomposed artifacts', () => {
      const response = {
        Title: 'Moon Landing Documentary',
        Summary: 'A story about space exploration',
        Segments: [
          { Script: 'In 1969, humanity took its first steps on the moon...' },
          { Script: 'The Apollo 11 mission was a triumph of engineering...' },
        ],
      };

      const produces = [
        'Artifact:DocProducer.VideoScript.Title',
        'Artifact:DocProducer.VideoScript.Summary',
        'Artifact:DocProducer.VideoScript.Segments[0].Script',
        'Artifact:DocProducer.VideoScript.Segments[1].Script',
      ];

      const artefacts = buildArtefactsFromJsonResponse(response, produces, {
        producerId: 'Producer:DocProducer',
      });

      expect(artefacts).toHaveLength(4);
      expect(artefacts[0]?.blob?.data).toBe('Moon Landing Documentary');
      expect(artefacts[1]?.blob?.data).toBe('A story about space exploration');
      expect(artefacts[2]?.blob?.data).toBe('In 1969, humanity took its first steps on the moon...');
      expect(artefacts[3]?.blob?.data).toBe('The Apollo 11 mission was a triumph of engineering...');
      expect(artefacts.every((artefact) => artefact.status === 'succeeded')).toBe(true);
    });

    it('handles nested arrays in decomposed artifacts', () => {
      const response = {
        Segments: [
          { ImagePrompts: ['astronaut walking', 'earth from moon'] },
          { ImagePrompts: ['rocket launch', 'mission control'] },
        ],
      };

      const produces = [
        'Artifact:DocProducer.VideoScript.Segments[0].ImagePrompts[0]',
        'Artifact:DocProducer.VideoScript.Segments[0].ImagePrompts[1]',
        'Artifact:DocProducer.VideoScript.Segments[1].ImagePrompts[0]',
        'Artifact:DocProducer.VideoScript.Segments[1].ImagePrompts[1]',
      ];

      const artefacts = buildArtefactsFromJsonResponse(response, produces, {
        producerId: 'Producer:DocProducer',
      });

      expect(artefacts).toHaveLength(4);
      expect(artefacts[0]?.blob?.data).toBe('astronaut walking');
      expect(artefacts[1]?.blob?.data).toBe('earth from moon');
      expect(artefacts[2]?.blob?.data).toBe('rocket launch');
      expect(artefacts[3]?.blob?.data).toBe('mission control');
      expect(artefacts.every((artefact) => artefact.status === 'succeeded')).toBe(true);
    });

    it('returns failure for missing JSON paths', () => {
      const response = {
        Title: 'Some Title',
      };

      const produces = [
        'Artifact:DocProducer.VideoScript.Title',
        'Artifact:DocProducer.VideoScript.NonExistent',
      ];

      const artefacts = buildArtefactsFromJsonResponse(response, produces, {
        producerId: 'Producer:DocProducer',
      });

      expect(artefacts).toHaveLength(2);
      expect(artefacts[0]?.status).toBe('succeeded');
      expect(artefacts[1]?.status).toBe('failed');
      expect(artefacts[1]?.diagnostics?.reason).toBe('json_path_not_found');
    });

    it('handles boolean values', () => {
      const response = {
        Segments: [
          { UseNarrationAudio: true },
          { UseNarrationAudio: false },
        ],
      };

      const produces = [
        'Artifact:DocProducer.VideoScript.Segments[0].UseNarrationAudio',
        'Artifact:DocProducer.VideoScript.Segments[1].UseNarrationAudio',
      ];

      const artefacts = buildArtefactsFromJsonResponse(response, produces, {
        producerId: 'Producer:DocProducer',
      });

      expect(artefacts).toHaveLength(2);
      expect(artefacts[0]?.blob?.data).toBe('true');
      expect(artefacts[1]?.blob?.data).toBe('false');
    });

    it('handles numeric values', () => {
      const response = {
        Duration: 120,
        Rating: 4.5,
      };

      const produces = [
        'Artifact:DocProducer.VideoScript.Duration',
        'Artifact:DocProducer.VideoScript.Rating',
      ];

      const artefacts = buildArtefactsFromJsonResponse(response, produces, {
        producerId: 'Producer:DocProducer',
      });

      expect(artefacts).toHaveLength(2);
      expect(artefacts[0]?.blob?.data).toBe('120');
      expect(artefacts[1]?.blob?.data).toBe('4.5');
    });
  });
});

describe('parseArtefactIdentifier', () => {
  it('parses simple artifact identifier', () => {
    const result = parseArtefactIdentifier('Artifact:MovieTitle');
    expect(result).toEqual({
      kind: 'MovieTitle',
      baseName: 'MovieTitle',
      jsonPath: undefined,
      index: undefined,
      ordinal: undefined,
    });
  });

  it('parses artifact with namespace', () => {
    const result = parseArtefactIdentifier('Artifact:DocProducer.VideoScript');
    expect(result).toEqual({
      kind: 'DocProducer.VideoScript',
      baseName: 'VideoScript',
      jsonPath: undefined,
      index: undefined,
      ordinal: undefined,
    });
  });

  it('extracts JSON path when parent artifact name is provided', () => {
    const result = parseArtefactIdentifier(
      'Artifact:DocProducer.VideoScript.Segments[0].Script',
      'VideoScript',
    );
    expect(result?.jsonPath).toBe('Segments[0].Script');
    expect(result?.baseName).toBe('Script');
  });

  it('extracts JSON path with nested arrays', () => {
    const result = parseArtefactIdentifier(
      'Artifact:DocProducer.VideoScript.Segments[1].ImagePrompts[2]',
      'VideoScript',
    );
    expect(result?.jsonPath).toBe('Segments[1].ImagePrompts[2]');
    expect(result?.ordinal).toEqual([1, 2]);
  });

  it('parses ordinal indices from brackets', () => {
    const result = parseArtefactIdentifier('Artifact:Producer.Image[0][1]');
    expect(result?.ordinal).toEqual([0, 1]);
  });

  it('parses named indices from brackets', () => {
    const result = parseArtefactIdentifier('Artifact:Producer.Image[segment=2&image=3]');
    expect(result?.index).toEqual({ segment: 2, image: 3 });
  });

  it('returns null for invalid identifier', () => {
    const result = parseArtefactIdentifier('NotArtifact:Something');
    expect(result).toBeNull();
  });

  it('handles mixed numeric and named indices', () => {
    const result = parseArtefactIdentifier('Artifact:Producer.Image[0][segment=1]');
    expect(result?.ordinal).toEqual([0]);
    expect(result?.index).toEqual({ segment: 1 });
  });
});
