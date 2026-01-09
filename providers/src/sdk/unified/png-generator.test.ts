import { describe, it, expect } from 'vitest';
import { generateMockPng } from './png-generator.js';

describe('generateMockPng', () => {
  it('generates a valid PNG file signature', () => {
    const buffer = generateMockPng();

    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    expect(buffer[0]).toBe(0x89);
    expect(buffer.toString('ascii', 1, 4)).toBe('PNG');
    expect(buffer[4]).toBe(0x0d);
    expect(buffer[5]).toBe(0x0a);
    expect(buffer[6]).toBe(0x1a);
    expect(buffer[7]).toBe(0x0a);
  });

  it('generates a valid IHDR chunk', () => {
    const buffer = generateMockPng();

    // IHDR chunk starts at offset 8
    // Length (4 bytes) + Type (4 bytes) + Data (13 bytes) + CRC (4 bytes)
    const ihdrLength = buffer.readUInt32BE(8);
    expect(ihdrLength).toBe(13); // IHDR data is always 13 bytes

    const ihdrType = buffer.toString('ascii', 12, 16);
    expect(ihdrType).toBe('IHDR');
  });

  it('generates default 1x1 image', () => {
    const buffer = generateMockPng();

    // Width and height are in IHDR data (starting at offset 16)
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    expect(width).toBe(1);
    expect(height).toBe(1);
  });

  it('generates custom sized image', () => {
    const buffer = generateMockPng(10, 5);

    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);

    expect(width).toBe(10);
    expect(height).toBe(5);
  });

  it('generates image with custom color', () => {
    // Generate two images with different colors and verify they differ
    const gray = generateMockPng(1, 1, { r: 128, g: 128, b: 128 });
    const red = generateMockPng(1, 1, { r: 255, g: 0, b: 0 });

    // The buffers should be different due to different pixel data
    expect(gray.equals(red)).toBe(false);
  });

  it('contains IDAT chunk (image data)', () => {
    const buffer = generateMockPng();

    // Find IDAT chunk by scanning for the type
    let foundIDAT = false;
    for (let i = 8; i < buffer.length - 4; i++) {
      if (buffer.toString('ascii', i, i + 4) === 'IDAT') {
        foundIDAT = true;
        break;
      }
    }

    expect(foundIDAT).toBe(true);
  });

  it('ends with IEND chunk', () => {
    const buffer = generateMockPng();

    // IEND chunk: length (0) + type ('IEND') + CRC
    // Should be at the end of the file
    const iendStart = buffer.length - 12;
    const iendLength = buffer.readUInt32BE(iendStart);
    const iendType = buffer.toString('ascii', iendStart + 4, iendStart + 8);

    expect(iendLength).toBe(0); // IEND has no data
    expect(iendType).toBe('IEND');
  });

  it('uses RGB color type', () => {
    const buffer = generateMockPng();

    // Color type is at IHDR data offset + 9 (offset 24 from start)
    const bitDepth = buffer[24];
    const colorType = buffer[25];

    expect(bitDepth).toBe(8); // 8 bits per channel
    expect(colorType).toBe(2); // RGB color type
  });

  it('generates different buffer sizes for different dimensions', () => {
    const small = generateMockPng(1, 1);
    const medium = generateMockPng(10, 10);
    const large = generateMockPng(100, 100);

    // Larger images should produce larger files
    expect(small.length).toBeLessThan(medium.length);
    expect(medium.length).toBeLessThan(large.length);
  });

  it('generates valid PNG that can be parsed', () => {
    const buffer = generateMockPng(2, 2);

    // Verify chunk structure is valid
    let offset = 8; // Skip signature

    while (offset < buffer.length) {
      const chunkLength = buffer.readUInt32BE(offset);
      const chunkType = buffer.toString('ascii', offset + 4, offset + 8);

      // Chunk types should be valid ASCII (4 uppercase/lowercase letters)
      expect(chunkType).toMatch(/^[A-Za-z]{4}$/);

      // Move to next chunk: length (4) + type (4) + data (chunkLength) + CRC (4)
      offset += 12 + chunkLength;
    }

    // Should have read exactly to the end
    expect(offset).toBe(buffer.length);
  });
});
