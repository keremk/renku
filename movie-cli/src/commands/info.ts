import { getMovieStudioPackageInfo } from '@gorenku/movie-core';

export interface MovieCliInfo {
  cli: '@gorenku/movie-cli';
  core: ReturnType<typeof getMovieStudioPackageInfo>;
}

export function getMovieCliInfo(): MovieCliInfo {
  return {
    cli: '@gorenku/movie-cli',
    core: getMovieStudioPackageInfo(),
  };
}
