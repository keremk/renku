import { describe, expect, it } from 'vitest';
import { reconcileBuildSelection } from './build-selection';
import type { BuildInfo } from '@/types/builds';

function makeBuild(movieId: string): BuildInfo {
  return {
    movieId,
    updatedAt: '2026-01-01T00:00:00.000Z',
    revision: null,
    hasManifest: true,
    hasInputsFile: true,
    displayName: null,
  };
}

describe('reconcileBuildSelection', () => {
  it('selects latest build when last=1 and no build is currently selected', () => {
    const result = reconcileBuildSelection({
      builds: [makeBuild('movie-new'), makeBuild('movie-old')],
      selectedBuildId: null,
      useLast: true,
    });

    expect(result).toEqual({
      nextBuildId: 'movie-new',
      shouldUpdateSelection: true,
      clearLastFlag: true,
    });
  });

  it('clears stale selected build when last=1 and build list is empty', () => {
    const result = reconcileBuildSelection({
      builds: [],
      selectedBuildId: 'movie-stale',
      useLast: true,
    });

    expect(result).toEqual({
      nextBuildId: null,
      shouldUpdateSelection: true,
      clearLastFlag: true,
    });
  });

  it('repairs stale selected build to latest when last flag is not set', () => {
    const result = reconcileBuildSelection({
      builds: [makeBuild('movie-latest'), makeBuild('movie-older')],
      selectedBuildId: 'movie-from-other-blueprint',
      useLast: false,
    });

    expect(result).toEqual({
      nextBuildId: 'movie-latest',
      shouldUpdateSelection: true,
      clearLastFlag: false,
    });
  });

  it('preserves manual deselection when no build is selected and last flag is not set', () => {
    const result = reconcileBuildSelection({
      builds: [makeBuild('movie-latest')],
      selectedBuildId: null,
      useLast: false,
    });

    expect(result).toEqual({
      nextBuildId: null,
      shouldUpdateSelection: false,
      clearLastFlag: false,
    });
  });

  it('keeps current selection when selected build exists', () => {
    const result = reconcileBuildSelection({
      builds: [makeBuild('movie-latest'), makeBuild('movie-current')],
      selectedBuildId: 'movie-current',
      useLast: false,
    });

    expect(result).toEqual({
      nextBuildId: 'movie-current',
      shouldUpdateSelection: false,
      clearLastFlag: false,
    });
  });
});
