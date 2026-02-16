/**
 * Handler for rechecking failed artifact status with providers.
 * Used to recover from client-side timeouts where the job may have
 * completed on the provider's servers.
 */

import type { ServerResponse } from 'node:http';
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { respondServerError } from '../http-utils.js';
import type { ArtifactInfo } from './types.js';

/**
 * Request for POST /blueprints/builds/artifacts/recheck
 */
export interface ArtifactRecheckRequest {
  blueprintFolder: string;
  movieId: string;
  artifactId: string;
}

/**
 * Response from POST /blueprints/builds/artifacts/recheck
 */
export interface ArtifactRecheckResponse {
  status: 'recovered' | 'still_pending' | 'failed' | 'not_recoverable';
  artifact?: ArtifactInfo;
  message: string;
}

/**
 * ArtefactEvent structure for reading from event log.
 */
interface ArtefactEvent {
  artefactId: string;
  output: {
    blob?: {
      hash: string;
      size: number;
      mimeType?: string;
    };
  };
  status: 'succeeded' | 'failed' | 'skipped';
  createdAt: string;
  diagnostics?: {
    provider?: string;
    model?: string;
    providerRequestId?: string;
    recoverable?: boolean;
  };
}

/**
 * Recheck a failed artifact's status with the provider.
 *
 * This is useful when a job timed out on the client side but may have
 * completed on the provider's servers. The artifact must have a
 * `providerRequestId` in its diagnostics to be recoverable.
 */
export async function handleArtifactRecheck(
  res: ServerResponse,
  request: ArtifactRecheckRequest
): Promise<void> {
  const { blueprintFolder, movieId, artifactId } = request;
  const movieDir = path.join(blueprintFolder, 'builds', movieId);
  const logPath = path.join(movieDir, 'events', 'artefacts.log');

  try {
    // Read event log to find the artifact
    if (!existsSync(logPath)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'not_recoverable',
          message: 'Event log not found',
        } satisfies ArtifactRecheckResponse)
      );
      return;
    }

    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.split(/\r?\n/).filter((line) => line.trim());

    // Find the latest event for this artifact
    let latestEvent: ArtefactEvent | undefined;
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as ArtefactEvent;
        if (event.artefactId === artifactId) {
          latestEvent = event;
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (!latestEvent) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'not_recoverable',
          message: `Artifact ${artifactId} not found in event log`,
        } satisfies ArtifactRecheckResponse)
      );
      return;
    }

    // Check if the artifact has recovery info
    const requestId = latestEvent.diagnostics?.providerRequestId;
    const provider = latestEvent.diagnostics?.provider;
    const model = latestEvent.diagnostics?.model;
    const recoverable = latestEvent.diagnostics?.recoverable;

    if (!requestId || !provider || !model || recoverable !== true) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'not_recoverable',
          message:
            'Artifact does not have complete provider recovery diagnostics',
        } satisfies ArtifactRecheckResponse)
      );
      return;
    }

    // Check if artifact is already succeeded
    if (latestEvent.status === 'succeeded') {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          status: 'recovered',
          message: 'Artifact already succeeded',
          artifact: buildArtifactInfo(artifactId, latestEvent),
        } satisfies ArtifactRecheckResponse)
      );
      return;
    }

    // TODO: Implement actual provider status check
    // For now, we return a message indicating the feature is in development
    // In the future, this would call recoverFalJob() from providers
    //
    // The implementation would:
    // 1. Import { recoverFalJob } from '@gorenku/providers'
    // 2. Call recoverFalJob(requestId, model, { secretResolver })
    // 3. If completed, download the result and append success event to log
    // 4. Return the updated artifact info

    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        status: 'still_pending',
        message: `Job ${requestId} status check not yet implemented. Provider: ${provider}, Model: ${model}. Please retry manually or check the provider's dashboard.`,
      } satisfies ArtifactRecheckResponse)
    );
  } catch (error) {
    console.error('Error checking artifact status:', error);
    respondServerError(res, 'Failed to check artifact status');
  }
}

/**
 * Build ArtifactInfo from an event.
 */
function buildArtifactInfo(
  artifactId: string,
  event: ArtefactEvent
): ArtifactInfo {
  const cleanName = artifactId.startsWith('Artifact:')
    ? artifactId.slice(9)
    : artifactId;

  return {
    id: artifactId,
    name: cleanName,
    hash: event.output?.blob?.hash ?? '',
    size: event.output?.blob?.size ?? 0,
    mimeType: event.output?.blob?.mimeType ?? 'application/octet-stream',
    status: event.status,
    createdAt: event.createdAt ?? null,
    provider: event.diagnostics?.provider,
    model: event.diagnostics?.model,
    providerRequestId: event.diagnostics?.providerRequestId,
    recoverable: event.diagnostics?.recoverable,
  };
}
