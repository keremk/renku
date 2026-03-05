import type { ImageDimensions } from './contracts.js';

type SupportedImageFormat = 'png' | 'jpeg' | 'webp';

export function readImageDimensions(
  data: Buffer,
  mimeType: string
): ImageDimensions {
  const detectedFormat = detectImageFormat(data);
  if (detectedFormat) {
    return readImageDimensionsByFormat(data, detectedFormat);
  }

  const normalizedMimeType = mimeType.toLowerCase();
  if (normalizedMimeType === 'image/png') {
    return readPngDimensions(data);
  }
  if (
    normalizedMimeType === 'image/jpeg' ||
    normalizedMimeType === 'image/jpg'
  ) {
    return readJpegDimensions(data);
  }
  if (normalizedMimeType === 'image/webp') {
    return readWebpDimensions(data);
  }

  throw new Error(
    `Cannot estimate image dimensions for MIME type ${mimeType}. Expected image/png, image/jpeg, or image/webp.`
  );
}

function detectImageFormat(data: Buffer): SupportedImageFormat | null {
  if (isPngSignature(data)) {
    return 'png';
  }
  if (isJpegSignature(data)) {
    return 'jpeg';
  }
  if (isWebpSignature(data)) {
    return 'webp';
  }
  return null;
}

function readImageDimensionsByFormat(
  data: Buffer,
  format: SupportedImageFormat
): ImageDimensions {
  if (format === 'png') {
    return readPngDimensions(data);
  }
  if (format === 'jpeg') {
    return readJpegDimensions(data);
  }
  return readWebpDimensions(data);
}

function isPngSignature(data: Buffer): boolean {
  return (
    data.byteLength >= 8 &&
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a
  );
}

function isJpegSignature(data: Buffer): boolean {
  return data.byteLength >= 2 && data[0] === 0xff && data[1] === 0xd8;
}

function isWebpSignature(data: Buffer): boolean {
  return (
    data.byteLength >= 12 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  );
}

function readPngDimensions(data: Buffer): ImageDimensions {
  if (data.byteLength < 24) {
    throw new Error('PNG image is too small to contain dimensions.');
  }

  const signatureMatches =
    data[0] === 0x89 &&
    data[1] === 0x50 &&
    data[2] === 0x4e &&
    data[3] === 0x47 &&
    data[4] === 0x0d &&
    data[5] === 0x0a &&
    data[6] === 0x1a &&
    data[7] === 0x0a;
  if (!signatureMatches) {
    throw new Error('Invalid PNG signature while parsing dimensions.');
  }

  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width <= 0 || height <= 0) {
    throw new Error(`Invalid PNG dimensions: ${width}x${height}.`);
  }

  return { width, height };
}

function readJpegDimensions(data: Buffer): ImageDimensions {
  if (data.byteLength < 4 || data[0] !== 0xff || data[1] !== 0xd8) {
    throw new Error('Invalid JPEG header while parsing dimensions.');
  }

  let offset = 2;
  const sofMarkers = new Set<number>([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
    0xcf,
  ]);

  while (offset + 3 < data.byteLength) {
    if (data[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let markerOffset = offset + 1;
    while (markerOffset < data.byteLength && data[markerOffset] === 0xff) {
      markerOffset += 1;
    }
    if (markerOffset >= data.byteLength) {
      break;
    }

    const marker = data[markerOffset];
    if (marker === 0xd9 || marker === 0xda) {
      break;
    }

    const segmentLengthOffset = markerOffset + 1;
    if (segmentLengthOffset + 1 >= data.byteLength) {
      break;
    }
    const segmentLength = data.readUInt16BE(segmentLengthOffset);
    if (segmentLength < 2) {
      throw new Error(
        `Invalid JPEG segment length ${segmentLength} while parsing dimensions.`
      );
    }

    if (sofMarkers.has(marker)) {
      const frameDataOffset = segmentLengthOffset + 2;
      if (frameDataOffset + 4 >= data.byteLength) {
        break;
      }
      const height = data.readUInt16BE(frameDataOffset + 1);
      const width = data.readUInt16BE(frameDataOffset + 3);
      if (width <= 0 || height <= 0) {
        throw new Error(`Invalid JPEG dimensions: ${width}x${height}.`);
      }
      return { width, height };
    }

    offset = segmentLengthOffset + segmentLength;
  }

  throw new Error('Unable to parse JPEG dimensions from source image.');
}

function readWebpDimensions(data: Buffer): ImageDimensions {
  if (
    data.byteLength < 30 ||
    data.toString('ascii', 0, 4) !== 'RIFF' ||
    data.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new Error('Invalid WebP header while parsing dimensions.');
  }

  const chunkType = data.toString('ascii', 12, 16);
  if (chunkType === 'VP8X') {
    const width = 1 + readUInt24LE(data, 24);
    const height = 1 + readUInt24LE(data, 27);
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid WebP VP8X dimensions: ${width}x${height}.`);
    }
    return { width, height };
  }

  if (chunkType === 'VP8 ') {
    if (data.byteLength < 30) {
      throw new Error('WebP VP8 image is too small to contain dimensions.');
    }
    const startCode =
      data[23] === 0x9d && data[24] === 0x01 && data[25] === 0x2a;
    if (!startCode) {
      throw new Error('Invalid WebP VP8 start code while parsing dimensions.');
    }
    const width = data.readUInt16LE(26) & 0x3fff;
    const height = data.readUInt16LE(28) & 0x3fff;
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid WebP VP8 dimensions: ${width}x${height}.`);
    }
    return { width, height };
  }

  if (chunkType === 'VP8L') {
    if (data.byteLength < 25) {
      throw new Error('WebP VP8L image is too small to contain dimensions.');
    }
    if (data[20] !== 0x2f) {
      throw new Error('Invalid WebP VP8L signature while parsing dimensions.');
    }

    const b0 = data[21];
    const b1 = data[22];
    const b2 = data[23];
    const b3 = data[24];

    const width = 1 + (b0 | ((b1 & 0x3f) << 8));
    const height = 1 + (((b1 & 0xc0) >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));

    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid WebP VP8L dimensions: ${width}x${height}.`);
    }
    return { width, height };
  }

  throw new Error(`Unsupported WebP chunk type ${chunkType} for dimensions.`);
}

function readUInt24LE(data: Buffer, offset: number): number {
  if (offset + 2 >= data.byteLength) {
    throw new Error(
      `Cannot read 24-bit integer at offset ${offset}; buffer is too small.`
    );
  }
  return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16);
}
