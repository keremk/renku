const MIME_TYPE_MAP: Record<string, string> = {
  'mp3': 'audio/mpeg',
  'wav': 'audio/wav',
  'webm': 'video/webm',
  'mp4': 'video/mp4',
  'mov': 'video/quicktime',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'webp': 'image/webp',
  'gif': 'image/gif',
  'json': 'application/json',
  'txt': 'text/plain',
};

export function inferMimeType(extension: string): string {
  const normalized = extension.toLowerCase().replace(/^\./, '');
  return MIME_TYPE_MAP[normalized] ?? 'application/octet-stream';
}

const EXTENSION_MAP: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/plain': 'txt',
  'application/json': 'json',
};

export function inferBlobExtension(mimeType?: string): string | null {
  if (!mimeType) {
    return null;
  }
  const normalized = mimeType.toLowerCase();
  if (EXTENSION_MAP[normalized]) {
    return EXTENSION_MAP[normalized];
  }
  if (normalized.startsWith('audio/')) {
    return normalized.slice('audio/'.length);
  }
  if (normalized.startsWith('video/')) {
    return normalized.slice('video/'.length);
  }
  if (normalized.startsWith('image/')) {
    return normalized.slice('image/'.length);
  }
  return null;
}

export function formatBlobFileName(hash: string, mimeType?: string): string {
  const extension = inferBlobExtension(mimeType);
  if (!extension) {
    return hash;
  }
  if (hash.endsWith(`.${extension}`)) {
    return hash;
  }
  return `${hash}.${extension}`;
}
