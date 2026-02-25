import type { BuildInfo } from '@/types/builds';

interface ReconcileBuildSelectionParams {
  builds: BuildInfo[];
  selectedBuildId: string | null;
  useLast: boolean;
}

interface ReconcileBuildSelectionResult {
  nextBuildId: string | null;
  shouldUpdateSelection: boolean;
  clearLastFlag: boolean;
}

export function reconcileBuildSelection({
  builds,
  selectedBuildId,
  useLast,
}: ReconcileBuildSelectionParams): ReconcileBuildSelectionResult {
  const latestBuildId = builds.length > 0 ? builds[0].movieId : null;

  if (useLast) {
    return {
      nextBuildId: latestBuildId,
      shouldUpdateSelection: selectedBuildId !== latestBuildId,
      clearLastFlag: true,
    };
  }

  if (!selectedBuildId) {
    return {
      nextBuildId: null,
      shouldUpdateSelection: false,
      clearLastFlag: false,
    };
  }

  const selectedBuildExists = builds.some(
    (build) => build.movieId === selectedBuildId
  );
  if (selectedBuildExists) {
    return {
      nextBuildId: selectedBuildId,
      shouldUpdateSelection: false,
      clearLastFlag: false,
    };
  }

  return {
    nextBuildId: latestBuildId,
    shouldUpdateSelection: true,
    clearLastFlag: false,
  };
}
