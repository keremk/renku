import type { ArtefactEventStatus, ProducedArtefact } from '@gorenku/core';

export interface InlineArtefactOptions {
  artefactId: string;
  text: string;
  status?: ArtefactEventStatus;
  diagnostics?: Record<string, unknown>;
}

export interface BlobArtefactOptions {
  artefactId: string;
  data: Uint8Array | string;
  mimeType: string;
  status?: ArtefactEventStatus;
  diagnostics?: Record<string, unknown>;
}

export function inline(options: InlineArtefactOptions): ProducedArtefact {
  const { artefactId, text, status = 'succeeded', diagnostics } = options;
  return {
    artefactId,
    status,
    blob: {
      data: text,
      mimeType: 'text/plain',
    },
    diagnostics,
  };
}

export function blob(options: BlobArtefactOptions): ProducedArtefact {
  const { artefactId, data, mimeType, status = 'succeeded', diagnostics } = options;
  return {
    artefactId,
    status,
    blob: {
      data,
      mimeType,
    },
    diagnostics,
  };
}

export function combine(artefacts: ProducedArtefact[], diagnostics?: Record<string, unknown>) {
  return {
    artefacts,
    diagnostics,
  } satisfies {
    artefacts: ProducedArtefact[];
    diagnostics?: Record<string, unknown>;
  };
}
