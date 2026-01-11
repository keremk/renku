import { deflateSync } from 'node:zlib';

/**
 * Generates a minimal valid PNG file for simulated mode.
 * PNG format: 8-byte signature + IHDR chunk + IDAT chunk + IEND chunk
 *
 * This is used for simulated mode to generate mock image artifacts
 * when ffmpeg extraction is skipped. Generates a 1x1 solid color PNG.
 */
export function generateMockPng(
  width: number = 1,
  height: number = 1,
  color: { r: number; g: number; b: number } = { r: 128, g: 128, b: 128 },
): Buffer {
  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // IHDR chunk (image header)
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0); // Width
  ihdrData.writeUInt32BE(height, 4); // Height
  ihdrData.writeUInt8(8, 8); // Bit depth (8 bits per channel)
  ihdrData.writeUInt8(2, 9); // Color type (2 = RGB)
  ihdrData.writeUInt8(0, 10); // Compression method (0 = deflate)
  ihdrData.writeUInt8(0, 11); // Filter method (0 = adaptive)
  ihdrData.writeUInt8(0, 12); // Interlace method (0 = no interlace)

  const ihdrChunk = createPngChunk('IHDR', ihdrData);

  // IDAT chunk (image data)
  // For an uncompressed PNG, we use zlib with no compression
  // Each row: filter byte (0 = none) + RGB pixels
  const rowSize = 1 + width * 3; // filter byte + RGB per pixel
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter type: none
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 3;
      rawData[pixelOffset] = color.r;
      rawData[pixelOffset + 1] = color.g;
      rawData[pixelOffset + 2] = color.b;
    }
  }

  // Compress with zlib (minimal compression for simplicity)
  const compressedData = deflateSync(rawData, { level: 0 });
  const idatChunk = createPngChunk('IDAT', compressedData);

  // IEND chunk (image end)
  const iendChunk = createPngChunk('IEND', Buffer.alloc(0));

  // Combine all parts
  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

/**
 * Creates a PNG chunk with the given type and data.
 * Chunk format: length (4 bytes) + type (4 bytes) + data + CRC (4 bytes)
 */
function createPngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const typeAndData = Buffer.concat([typeBuffer, data]);

  const crc = crc32(typeAndData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc >>> 0, 0);

  return Buffer.concat([length, typeAndData, crcBuffer]);
}

/**
 * CRC32 implementation for PNG chunks.
 * Uses the polynomial 0xEDB88320 (IEEE 802.3).
 */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;

  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }

  return crc ^ 0xffffffff;
}
