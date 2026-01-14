import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseGridStyle,
  detectPanelExtractions,
  needsPanelExtraction,
  extractPanelImages,
  resetFfmpegCache,
} from './ffmpeg-image-splitter.js';

describe('parseGridStyle', () => {
  it('parses 3x3 grid', () => {
    const result = parseGridStyle('3x3');
    expect(result).toEqual({ cols: 3, rows: 3 });
  });

  it('parses 2x2 grid', () => {
    const result = parseGridStyle('2x2');
    expect(result).toEqual({ cols: 2, rows: 2 });
  });

  it('parses non-square 2x3 grid', () => {
    const result = parseGridStyle('2x3');
    expect(result).toEqual({ cols: 2, rows: 3 });
  });

  it('parses non-square 3x2 grid', () => {
    const result = parseGridStyle('3x2');
    expect(result).toEqual({ cols: 3, rows: 2 });
  });

  it('parses case-insensitively', () => {
    const result = parseGridStyle('3X3');
    expect(result).toEqual({ cols: 3, rows: 3 });
  });

  it('throws on invalid format - missing x', () => {
    expect(() => parseGridStyle('33')).toThrow('Invalid GridStyle format');
  });

  it('throws on invalid format - non-numeric', () => {
    expect(() => parseGridStyle('axb')).toThrow('Invalid GridStyle format');
  });

  it('throws on invalid format - empty string', () => {
    expect(() => parseGridStyle('')).toThrow('Invalid GridStyle format');
  });

  it('throws on zero dimensions', () => {
    expect(() => parseGridStyle('0x3')).toThrow('Invalid GridStyle dimensions');
  });
});

describe('detectPanelExtractions', () => {
  it('returns empty map when no panel artifacts present', () => {
    const produces = ['Artifact:TextToImageProducer.GeneratedImage'];
    const result = detectPanelExtractions(produces);
    expect(result.panels.size).toBe(0);
  });

  it('detects single panel artifact', () => {
    const produces = [
      'Artifact:TextToImageProducer.GeneratedImage',
      'Artifact:TextToImageProducer.PanelImages[0]',
    ];
    const result = detectPanelExtractions(produces);
    expect(result.panels.size).toBe(1);
    expect(result.panels.get(0)).toBe('Artifact:TextToImageProducer.PanelImages[0]');
  });

  it('detects multiple panel artifacts', () => {
    const produces = [
      'Artifact:TextToImageProducer.GeneratedImage',
      'Artifact:TextToImageProducer.PanelImages[0]',
      'Artifact:TextToImageProducer.PanelImages[1]',
      'Artifact:TextToImageProducer.PanelImages[2]',
    ];
    const result = detectPanelExtractions(produces);
    expect(result.panels.size).toBe(3);
    expect(result.panels.get(0)).toBe('Artifact:TextToImageProducer.PanelImages[0]');
    expect(result.panels.get(1)).toBe('Artifact:TextToImageProducer.PanelImages[1]');
    expect(result.panels.get(2)).toBe('Artifact:TextToImageProducer.PanelImages[2]');
  });

  it('detects all 9 panels for 3x3 grid', () => {
    const produces = Array.from({ length: 9 }, (_, i) =>
      `Artifact:TextToImageProducer.PanelImages[${i}]`,
    );
    const result = detectPanelExtractions(produces);
    expect(result.panels.size).toBe(9);
  });

  it('handles artifacts with namespace indices', () => {
    const produces = ['Artifact:Producer[0].PanelImages[2]'];
    const result = detectPanelExtractions(produces);
    expect(result.panels.get(2)).toBe('Artifact:Producer[0].PanelImages[2]');
  });

  it('handles short artifact IDs without namespace', () => {
    const produces = ['Artifact:GeneratedImage', 'Artifact:PanelImages[0]', 'Artifact:PanelImages[1]'];
    const result = detectPanelExtractions(produces);
    expect(result.panels.size).toBe(2);
    expect(result.panels.get(0)).toBe('Artifact:PanelImages[0]');
    expect(result.panels.get(1)).toBe('Artifact:PanelImages[1]');
  });

  it('handles empty produces array', () => {
    const result = detectPanelExtractions([]);
    expect(result.panels.size).toBe(0);
  });

  it('ignores unrelated artifacts with similar names', () => {
    const produces = [
      'Artifact:PanelImagesOther', // Not exactly "PanelImages[N]"
      'Artifact:MyPanelImages[0]', // Has prefix
    ];
    const result = detectPanelExtractions(produces);
    expect(result.panels.size).toBe(0);
  });
});

describe('needsPanelExtraction', () => {
  it('returns false when no panels needed', () => {
    const extractions = { panels: new Map() };
    expect(needsPanelExtraction(extractions)).toBe(false);
  });

  it('returns true when one panel needed', () => {
    const panels = new Map([[0, 'Artifact:PanelImages[0]']]);
    expect(needsPanelExtraction({ panels })).toBe(true);
  });

  it('returns true when multiple panels needed', () => {
    const panels = new Map([
      [0, 'Artifact:PanelImages[0]'],
      [1, 'Artifact:PanelImages[1]'],
      [2, 'Artifact:PanelImages[2]'],
    ]);
    expect(needsPanelExtraction({ panels })).toBe(true);
  });
});

describe('extractPanelImages', () => {
  beforeEach(() => {
    resetFfmpegCache();
  });

  describe('simulated mode', () => {
    it('generates mock panel for each requested index', async () => {
      const produces = ['Artifact:GeneratedImage', 'Artifact:PanelImages[0]', 'Artifact:PanelImages[1]'];
      const imageBuffer = Buffer.from('mock image data');

      const result = await extractPanelImages({
        imageBuffer,
        primaryArtifactId: 'Artifact:GeneratedImage',
        produces,
        gridStyle: '2x2',
        mode: 'simulated',
      });

      expect(result.panels.length).toBe(2);
      expect(result.panels[0].status).toBe('succeeded');
      expect(result.panels[0].artefactId).toBe('Artifact:PanelImages[0]');
      expect(result.panels[0].blob?.mimeType).toBe('image/png');
      expect(result.panels[0].diagnostics?.source).toBe('simulated');
      expect(result.panels[0].diagnostics?.panelIndex).toBe(0);
    });

    it('generates all 9 panels for 3x3 grid', async () => {
      const produces = Array.from({ length: 9 }, (_, i) => `Artifact:PanelImages[${i}]`);
      const imageBuffer = Buffer.from('mock image data');

      const result = await extractPanelImages({
        imageBuffer,
        primaryArtifactId: 'Artifact:GeneratedImage',
        produces,
        gridStyle: '3x3',
        mode: 'simulated',
      });

      expect(result.panels.length).toBe(9);
      result.panels.forEach((panel, i) => {
        expect(panel.status).toBe('succeeded');
        expect(panel.artefactId).toBe(`Artifact:PanelImages[${i}]`);
        expect(panel.blob?.mimeType).toBe('image/png');
      });
    });

    it('generates panels for non-square 2x3 grid', async () => {
      const produces = Array.from({ length: 6 }, (_, i) => `Artifact:PanelImages[${i}]`);
      const imageBuffer = Buffer.from('mock image data');

      const result = await extractPanelImages({
        imageBuffer,
        primaryArtifactId: 'Artifact:GeneratedImage',
        produces,
        gridStyle: '2x3',
        mode: 'simulated',
      });

      expect(result.panels.length).toBe(6);

      // Verify grid positions for 2x3 (2 cols, 3 rows)
      // Panel 0: row=0, col=0
      // Panel 1: row=0, col=1
      // Panel 2: row=1, col=0
      // Panel 3: row=1, col=1
      // Panel 4: row=2, col=0
      // Panel 5: row=2, col=1
      expect(result.panels[0].diagnostics?.gridPosition).toEqual({ row: 0, col: 0 });
      expect(result.panels[1].diagnostics?.gridPosition).toEqual({ row: 0, col: 1 });
      expect(result.panels[2].diagnostics?.gridPosition).toEqual({ row: 1, col: 0 });
      expect(result.panels[3].diagnostics?.gridPosition).toEqual({ row: 1, col: 1 });
      expect(result.panels[4].diagnostics?.gridPosition).toEqual({ row: 2, col: 0 });
      expect(result.panels[5].diagnostics?.gridPosition).toEqual({ row: 2, col: 1 });
    });

    it('returns empty result when no panels requested', async () => {
      const produces = ['Artifact:GeneratedImage'];
      const imageBuffer = Buffer.from('mock image data');

      const result = await extractPanelImages({
        imageBuffer,
        primaryArtifactId: 'Artifact:GeneratedImage',
        produces,
        gridStyle: '3x3',
        mode: 'simulated',
      });

      expect(result.panels.length).toBe(0);
    });

    it('fails gracefully with invalid grid style', async () => {
      const produces = ['Artifact:PanelImages[0]'];
      const imageBuffer = Buffer.from('mock image data');

      const result = await extractPanelImages({
        imageBuffer,
        primaryArtifactId: 'Artifact:GeneratedImage',
        produces,
        gridStyle: 'invalid',
        mode: 'simulated',
      });

      expect(result.panels.length).toBe(1);
      expect(result.panels[0].status).toBe('failed');
      expect(result.panels[0].diagnostics?.reason).toBe('invalid_grid_style');
    });
  });

  describe('live mode with fixture', () => {
    const fixtureDir = join(__dirname, '../../../tests/fixtures');

    it('extracts panels from real 3x3 grid image', async () => {
      const imageBuffer = await readFile(join(fixtureDir, 'grid-image-fixture.jpeg'));

      // Request just 3 panels for faster test
      const produces = [
        'Artifact:PanelImages[0]',
        'Artifact:PanelImages[4]',
        'Artifact:PanelImages[8]',
      ];

      const result = await extractPanelImages({
        imageBuffer,
        primaryArtifactId: 'Artifact:GeneratedImage',
        produces,
        gridStyle: '3x3',
        mode: 'live',
      });

      expect(result.panels.length).toBe(3);

      // Verify each panel is a valid PNG
      for (const panel of result.panels) {
        expect(panel.status).toBe('succeeded');
        expect(panel.blob?.mimeType).toBe('image/png');
        expect(panel.blob?.data).toBeInstanceOf(Buffer);

        // PNG signature check
        const data = panel.blob?.data as Buffer;
        expect(data[0]).toBe(0x89);
        expect(data.toString('ascii', 1, 4)).toBe('PNG');
      }
    });

    it('includes correct diagnostics for panel positions', async () => {
      const imageBuffer = await readFile(join(fixtureDir, 'grid-image-fixture.jpeg'));
      const produces = ['Artifact:PanelImages[4]']; // Center panel of 3x3

      const result = await extractPanelImages({
        imageBuffer,
        primaryArtifactId: 'Artifact:GeneratedImage',
        produces,
        gridStyle: '3x3',
        mode: 'live',
      });

      expect(result.panels.length).toBe(1);
      const centerPanel = result.panels[0];
      expect(centerPanel.status).toBe('succeeded');
      expect(centerPanel.diagnostics?.panelIndex).toBe(4);
      expect(centerPanel.diagnostics?.gridPosition).toEqual({ row: 1, col: 1 });
      expect(centerPanel.diagnostics?.crop).toBeDefined();
    });

    it('handles panel index out of range', async () => {
      const imageBuffer = await readFile(join(fixtureDir, 'grid-image-fixture.jpeg'));
      const produces = ['Artifact:PanelImages[99]']; // Out of range for 3x3

      const result = await extractPanelImages({
        imageBuffer,
        primaryArtifactId: 'Artifact:GeneratedImage',
        produces,
        gridStyle: '3x3',
        mode: 'live',
      });

      expect(result.panels.length).toBe(1);
      expect(result.panels[0].status).toBe('failed');
      expect(result.panels[0].diagnostics?.reason).toBe('panel_index_out_of_range');
    });
  });
});
