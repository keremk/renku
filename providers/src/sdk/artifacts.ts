import type { ArtifactEventStatus, ProducedArtifact } from '@gorenku/core';

export interface InlineArtifactOptions {
  artifactId: string;
  text: string;
  status?: ArtifactEventStatus;
  diagnostics?: Record<string, unknown>;
}

export interface BlobArtifactOptions {
  artifactId: string;
  data: Uint8Array | string;
  mimeType: string;
  status?: ArtifactEventStatus;
  diagnostics?: Record<string, unknown>;
}

export function inline(options: InlineArtifactOptions): ProducedArtifact {
  const { artifactId, text, status = 'succeeded', diagnostics } = options;
  return {
    artifactId,
    status,
    blob: {
      data: text,
      mimeType: 'text/plain',
    },
    diagnostics,
  };
}

export function blob(options: BlobArtifactOptions): ProducedArtifact {
  const { artifactId, data, mimeType, status = 'succeeded', diagnostics } = options;
  return {
    artifactId,
    status,
    blob: {
      data,
      mimeType,
    },
    diagnostics,
  };
}

export function combine(artifacts: ProducedArtifact[], diagnostics?: Record<string, unknown>) {
  return {
    artifacts,
    diagnostics,
  } satisfies {
    artifacts: ProducedArtifact[];
    diagnostics?: Record<string, unknown>;
  };
}
