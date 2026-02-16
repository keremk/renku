import { Buffer } from 'node:buffer';
import {
  createEventLog,
  parseCanonicalArtifactId,
  persistBlobToStorage,
  type ArtefactEvent,
  type StorageContext,
} from '@gorenku/core';
import { checkFalJobStatus } from '@gorenku/providers/dist/sdk/fal/recovery.js';

interface FalRecoveryCandidate {
  artefactId: string;
  providerRequestId: string;
  model: string;
  provider: 'fal-ai';
  event: ArtefactEvent;
}

type FalStatusChecker = typeof checkFalJobStatus;

interface DownloadResult {
  data: Uint8Array;
  mimeType?: string;
}

interface RecoveryPrepassDependencies {
  checkFalStatus?: FalStatusChecker;
  downloadBinary?: (url: string) => Promise<DownloadResult>;
  secretResolver?: {
    getSecret(key: string): Promise<string | null>;
  };
  now?: () => string;
  logger?: {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
  };
}

export interface RecoveryPrepassSummary {
  checkedArtifactIds: string[];
  recoveredArtifactIds: string[];
  pendingArtifactIds: string[];
  failedArtifactIds: string[];
}

interface RecoveryPrepassOptions {
  storage: StorageContext;
  movieId: string;
  dependencies?: RecoveryPrepassDependencies;
}

/**
 * Reconcile recoverable failed artifacts before planning.
 *
 * For each latest failed artifact marked recoverable, this checks provider status,
 * downloads completed output when available, and appends a succeeded artifact event.
 */
export async function recoverFailedArtifactsBeforePlanning(
  options: RecoveryPrepassOptions
): Promise<RecoveryPrepassSummary> {
  const { storage, movieId, dependencies } = options;
  const checkFalStatus = dependencies?.checkFalStatus ?? checkFalJobStatus;
  const downloadBinary =
    dependencies?.downloadBinary ?? downloadBinaryWithMetadata;
  const now = dependencies?.now ?? (() => new Date().toISOString());
  const logger = dependencies?.logger;
  const secretResolver = dependencies?.secretResolver ?? {
    async getSecret(key: string): Promise<string | null> {
      const value = process.env[key];
      if (typeof value !== 'string' || value.length === 0) {
        return null;
      }
      return value;
    },
  };

  const eventLog = createEventLog(storage);
  const latestById = new Map<string, ArtefactEvent>();
  const latestSucceededById = new Map<string, ArtefactEvent>();

  for await (const event of eventLog.streamArtefacts(movieId)) {
    latestById.set(event.artefactId, event);
    if (event.status === 'succeeded') {
      latestSucceededById.set(event.artefactId, event);
    }
  }

  const summary: RecoveryPrepassSummary = {
    checkedArtifactIds: [],
    recoveredArtifactIds: [],
    pendingArtifactIds: [],
    failedArtifactIds: [],
  };

  for (const event of latestById.values()) {
    const candidate = extractRecoverableFalCandidate(event);
    if (!candidate) {
      continue;
    }

    summary.checkedArtifactIds.push(candidate.artefactId);

    try {
      const statusResult = await checkFalStatus(
        candidate.providerRequestId,
        candidate.model,
        {
          secretResolver,
        }
      );

      if (
        statusResult.status === 'in_progress' ||
        statusResult.status === 'in_queue'
      ) {
        summary.pendingArtifactIds.push(candidate.artefactId);
        continue;
      }

      if (statusResult.status !== 'completed') {
        summary.failedArtifactIds.push(candidate.artefactId);
        continue;
      }

      const url = pickRecoveryUrl(
        candidate.artefactId,
        statusResult.urls ?? []
      );
      const downloaded = await downloadBinary(url);
      const previousMimeType = latestSucceededById.get(candidate.artefactId)
        ?.output.blob?.mimeType;
      const mimeType = resolveMimeType({
        url,
        previousMimeType,
        downloadedMimeType: downloaded.mimeType,
      });

      const blob = await persistBlobToStorage(storage, movieId, {
        data: Buffer.from(downloaded.data),
        mimeType,
      });

      const recoveredAt = now();
      const recoveredEvent: ArtefactEvent = {
        artefactId: candidate.artefactId,
        revision: candidate.event.revision,
        inputsHash: candidate.event.inputsHash,
        output: { blob },
        status: 'succeeded',
        producedBy: candidate.event.producedBy,
        diagnostics: {
          provider: candidate.provider,
          model: candidate.model,
          providerRequestId: candidate.providerRequestId,
          recoveredBy: 'viewer.preplan',
          recoveredAt,
        },
        createdAt: recoveredAt,
      };

      await eventLog.appendArtefact(movieId, recoveredEvent);
      latestSucceededById.set(candidate.artefactId, recoveredEvent);
      summary.recoveredArtifactIds.push(candidate.artefactId);
    } catch (error) {
      summary.failedArtifactIds.push(candidate.artefactId);
      logger?.warn?.('viewer.recovery.preplan.failed', {
        movieId,
        artefactId: candidate.artefactId,
        providerRequestId: candidate.providerRequestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (summary.recoveredArtifactIds.length > 0) {
    logger?.debug?.('viewer.recovery.preplan.recovered', {
      movieId,
      recoveredArtifactIds: summary.recoveredArtifactIds,
    });
  }

  return summary;
}

function extractRecoverableFalCandidate(
  event: ArtefactEvent
): FalRecoveryCandidate | null {
  if (event.status !== 'failed') {
    return null;
  }

  const diagnostics = asRecord(event.diagnostics);
  if (!diagnostics) {
    return null;
  }

  if (diagnostics.recoverable !== true) {
    return null;
  }

  const provider = readString(diagnostics, 'provider');
  if (provider !== 'fal-ai') {
    return null;
  }

  const model = readString(diagnostics, 'model');
  const providerRequestId = readString(diagnostics, 'providerRequestId');
  if (!model || !providerRequestId) {
    return null;
  }

  return {
    artefactId: event.artefactId,
    providerRequestId,
    model,
    provider,
    event,
  };
}

function pickRecoveryUrl(artefactId: string, urls: string[]): string {
  if (urls.length === 0) {
    throw new Error(`No recovery URL returned for ${artefactId}.`);
  }

  if (urls.length === 1) {
    return urls[0]!;
  }

  const parsed = parseCanonicalArtifactId(artefactId);
  const outputIndex = parsed.indices.at(-1);
  if (typeof outputIndex !== 'number') {
    throw new Error(
      `Multiple recovery URLs returned for ${artefactId}, but no output index is available.`
    );
  }

  const url = urls[outputIndex];
  if (!url) {
    throw new Error(
      `Recovery URL index ${outputIndex} is out of range for ${artefactId}.`
    );
  }
  return url;
}

function resolveMimeType(args: {
  url: string;
  previousMimeType?: string;
  downloadedMimeType?: string;
}): string {
  const { url, previousMimeType, downloadedMimeType } = args;
  if (previousMimeType) {
    return previousMimeType;
  }

  if (downloadedMimeType) {
    return downloadedMimeType;
  }

  const inferred = inferMimeTypeFromUrl(url);
  if (inferred) {
    return inferred;
  }

  throw new Error(`Unable to determine MIME type for recovered URL: ${url}`);
}

function inferMimeTypeFromUrl(url: string): string | undefined {
  const extension = getUrlExtension(url);
  switch (extension) {
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.mov':
      return 'video/quicktime';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.wav':
      return 'audio/wav';
    case '.mp3':
      return 'audio/mpeg';
    case '.m4a':
      return 'audio/mp4';
    case '.aac':
      return 'audio/aac';
    case '.json':
      return 'application/json';
    case '.txt':
      return 'text/plain';
    default:
      return undefined;
  }
}

function getUrlExtension(url: string): string {
  const pathname = new URL(url).pathname;
  const dotIndex = pathname.lastIndexOf('.');
  if (dotIndex < 0) {
    return '';
  }
  return pathname.slice(dotIndex).toLowerCase();
}

async function downloadBinaryWithMetadata(
  url: string
): Promise<DownloadResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status}).`);
  }

  const contentType = normalizeContentType(
    response.headers.get('content-type')
  );
  const payload = await response.arrayBuffer();
  return {
    data: Buffer.from(payload),
    mimeType: contentType,
  };
}

function normalizeContentType(
  contentTypeHeader: string | null
): string | undefined {
  if (!contentTypeHeader) {
    return undefined;
  }
  const [value] = contentTypeHeader.split(';');
  const mimeType = value?.trim().toLowerCase();
  if (!mimeType) {
    return undefined;
  }
  return mimeType;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readString(
  source: Record<string, unknown>,
  key: string
): string | undefined {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  return value;
}
