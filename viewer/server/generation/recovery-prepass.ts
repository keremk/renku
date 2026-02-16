import {
  recoverFailedArtifactsBeforePlanning as recoverFailedArtifactsBeforePlanningCore,
  type RecoveryPrepassSummary,
  type RecoveryPrepassDependencies as CoreRecoveryPrepassDependencies,
  type FalRecoveryStatusChecker,
  type StorageContext,
} from '@gorenku/core';
import { checkFalJobStatus } from '@gorenku/providers';

interface RecoveryPrepassDependencies
  extends Omit<
    CoreRecoveryPrepassDependencies,
    'checkFalStatus' | 'recoveredBy'
  > {
  checkFalStatus?: FalRecoveryStatusChecker;
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
  const { dependencies } = options;
  const checkFalStatus = dependencies?.checkFalStatus ?? checkFalJobStatus;

  return recoverFailedArtifactsBeforePlanningCore({
    storage: options.storage,
    movieId: options.movieId,
    dependencies: {
      ...dependencies,
      checkFalStatus,
      recoveredBy: 'viewer.preplan',
    },
  });
}
