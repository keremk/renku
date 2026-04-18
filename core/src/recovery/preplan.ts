import { Buffer } from 'node:buffer';
import { createEventLog } from '../event-log.js';
import { parseCanonicalArtifactId } from '../canonical-ids.js';
import { persistBlobToStorage } from '../blob-utils.js';
import { resolveArtifactOwnershipFromEvent } from '../artifact-ownership.js';
import type { ArtifactEvent } from '../types.js';
import type { StorageContext } from '../storage.js';

export type FalRecoveryStatus =
  | 'completed'
  | 'in_progress'
  | 'in_queue'
  | 'failed'
  | 'unknown';

export interface FalRecoveryStatusResult {
  status: FalRecoveryStatus;
  urls?: string[];
  error?: string;
}

export interface RecoverySecretResolver {
  getSecret(key: string): Promise<string | null>;
}

export type FalRecoveryStatusChecker = (
  requestId: string,
  model: string,
  options: {
    secretResolver: RecoverySecretResolver;
  }
) => Promise<FalRecoveryStatusResult>;

interface DownloadResult {
  data: Uint8Array;
  mimeType?: string;
}

export interface RecoveryFailure {
  artifactId: string;
  reason: string;
  providerRequestId?: string;
}

export interface RecoveryPrepassSummary {
  checkedArtifactIds: string[];
  recoveredArtifactIds: string[];
  pendingArtifactIds: string[];
  failedArtifactIds: string[];
  failedRecoveries: RecoveryFailure[];
}

export interface RecoveryPrepassDependencies {
  checkFalStatus?: FalRecoveryStatusChecker;
  downloadBinary?: (url: string) => Promise<DownloadResult>;
  secretResolver?: RecoverySecretResolver;
  now?: () => string;
  logger?: {
    debug?: (message: string, meta?: Record<string, unknown>) => void;
    warn?: (message: string, meta?: Record<string, unknown>) => void;
  };
  recoveredBy?: string;
}

interface RecoveryPrepassOptions {
  storage: StorageContext;
  movieId: string;
  dependencies?: RecoveryPrepassDependencies;
}

interface FalRecoveryCandidate {
  artifactId: string;
  providerRequestId: string;
  model: string;
  event: ArtifactEvent;
}

type CandidateParseResult =
  | { kind: 'skip' }
  | {
      kind: 'malformed';
      artifactId: string;
      reason: string;
      providerRequestId?: string;
    }
  | { kind: 'candidate'; candidate: FalRecoveryCandidate };

/**
 * Reconcile recoverable failed artifacts before planning.
 *
 * Recovery is non-blocking: every recovery failure is recorded in the summary,
 * and planning proceeds with the current event log state.
 */
export async function recoverFailedArtifactsBeforePlanning(
  options: RecoveryPrepassOptions
): Promise<RecoveryPrepassSummary> {
  const { storage, movieId, dependencies } = options;
  const checkFalStatus =
    dependencies?.checkFalStatus ?? missingFalStatusChecker;
  const downloadBinary =
    dependencies?.downloadBinary ?? downloadBinaryWithMetadata;
  const now = dependencies?.now ?? (() => new Date().toISOString());
  const logger = dependencies?.logger;
  const recoveredBy = dependencies?.recoveredBy ?? 'preplan.recovery';
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
  const latestById = new Map<string, ArtifactEvent>();
  const latestSucceededById = new Map<string, ArtifactEvent>();

  for await (const event of eventLog.streamArtifacts(movieId)) {
    latestById.set(event.artifactId, event);
    if (event.status === 'succeeded') {
      latestSucceededById.set(event.artifactId, event);
    }
  }

  const summary: RecoveryPrepassSummary = {
    checkedArtifactIds: [],
    recoveredArtifactIds: [],
    pendingArtifactIds: [],
    failedArtifactIds: [],
    failedRecoveries: [],
  };

  for (const event of latestById.values()) {
    const parseResult = parseRecoverableFalCandidate(event);
    if (parseResult.kind === 'skip') {
      continue;
    }
    if (parseResult.kind === 'malformed') {
      recordRecoveryFailure(
        summary,
        parseResult.artifactId,
        parseResult.reason,
        parseResult.providerRequestId
      );
      logger?.warn?.('recovery.preplan.malformedDiagnostics', {
        movieId,
        artifactId: parseResult.artifactId,
        reason: parseResult.reason,
      });
      continue;
    }

    const candidate = parseResult.candidate;
    summary.checkedArtifactIds.push(candidate.artifactId);

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
        summary.pendingArtifactIds.push(candidate.artifactId);
        continue;
      }

      if (statusResult.status !== 'completed') {
        recordRecoveryFailure(
          summary,
          candidate.artifactId,
          statusResult.error ??
            `Provider returned status ${statusResult.status}.`,
          candidate.providerRequestId
        );
        continue;
      }

      const url = pickRecoveryUrl(
        candidate.artifactId,
        statusResult.urls ?? []
      );
      const downloaded = await downloadBinary(url);
      const previousMimeType = latestSucceededById.get(candidate.artifactId)
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
      const ownership = resolveArtifactOwnershipFromEvent({
        artifactId: candidate.artifactId,
        event: candidate.event,
        context: `recovery.preplan artifact=${candidate.artifactId}`,
      });
      const recoveredEvent: ArtifactEvent = {
        artifactId: candidate.artifactId,
        revision: candidate.event.revision,
        inputsHash: candidate.event.inputsHash,
        output: { blob },
        status: 'succeeded',
        producerJobId: ownership.producerJobId,
        producerId: ownership.producerId,
        diagnostics: {
          provider: 'fal-ai',
          model: candidate.model,
          providerRequestId: candidate.providerRequestId,
          recoveredBy,
          recoveredAt,
        },
        createdAt: recoveredAt,
        lastRevisionBy: 'producer',
      };

      await eventLog.appendArtifact(movieId, recoveredEvent);
      latestSucceededById.set(candidate.artifactId, recoveredEvent);
      summary.recoveredArtifactIds.push(candidate.artifactId);
    } catch (error) {
      recordRecoveryFailure(
        summary,
        candidate.artifactId,
        error instanceof Error ? error.message : String(error),
        candidate.providerRequestId
      );
      logger?.warn?.('recovery.preplan.failed', {
        movieId,
        artifactId: candidate.artifactId,
        providerRequestId: candidate.providerRequestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (summary.recoveredArtifactIds.length > 0) {
    logger?.debug?.('recovery.preplan.recovered', {
      movieId,
      recoveredArtifactIds: summary.recoveredArtifactIds,
    });
  }

  return summary;
}

function recordRecoveryFailure(
  summary: RecoveryPrepassSummary,
  artifactId: string,
  reason: string,
  providerRequestId?: string
): void {
  summary.failedArtifactIds.push(artifactId);
  summary.failedRecoveries.push({ artifactId, reason, providerRequestId });
}

function parseRecoverableFalCandidate(
  event: ArtifactEvent
): CandidateParseResult {
  if (event.status !== 'failed') {
    return { kind: 'skip' };
  }

  const diagnostics = asRecord(event.diagnostics);
  if (!diagnostics) {
    return { kind: 'skip' };
  }

  if (diagnostics.recoverable !== true) {
    return { kind: 'skip' };
  }

  const provider = readString(diagnostics, 'provider');
  const providerRequestId = readString(diagnostics, 'providerRequestId');

  if (!provider) {
    return {
      kind: 'malformed',
      artifactId: event.artifactId,
      reason:
        'Recoverable artifact diagnostics are missing a provider identifier.',
      providerRequestId,
    };
  }

  if (provider !== 'fal-ai') {
    return { kind: 'skip' };
  }

  const model = readString(diagnostics, 'model');
  if (!model) {
    return {
      kind: 'malformed',
      artifactId: event.artifactId,
      reason:
        'Recoverable fal-ai artifact diagnostics are missing model metadata.',
      providerRequestId,
    };
  }

  if (!providerRequestId) {
    return {
      kind: 'malformed',
      artifactId: event.artifactId,
      reason:
        'Recoverable fal-ai artifact diagnostics are missing providerRequestId.',
    };
  }

  return {
    kind: 'candidate',
    candidate: {
      artifactId: event.artifactId,
      providerRequestId,
      model,
      event,
    },
  };
}

function pickRecoveryUrl(artifactId: string, urls: string[]): string {
  if (urls.length === 0) {
    throw new Error(`No recovery URL returned for ${artifactId}.`);
  }

  if (urls.length === 1) {
    return urls[0]!;
  }

  const parsed = parseCanonicalArtifactId(artifactId);
  const outputIndex = parsed.indices.at(-1);
  if (typeof outputIndex !== 'number') {
    throw new Error(
      `Multiple recovery URLs returned for ${artifactId}, but no output index is available.`
    );
  }

  const url = urls[outputIndex];
  if (!url) {
    throw new Error(
      `Recovery URL index ${outputIndex} is out of range for ${artifactId}.`
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

async function missingFalStatusChecker(): Promise<FalRecoveryStatusResult> {
  throw new Error(
    'fal-ai recovery status checker is required for recovery prepass.'
  );
}
