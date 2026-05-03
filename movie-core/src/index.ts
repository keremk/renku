export const MOVIE_PROJECT_KIND = 'renku.movie' as const;
export const MOVIE_WORKFLOW_KIND = 'renku.movieWorkflow' as const;
export const MOVIE_TASK_KIND = 'renku.movieTask' as const;

export type MovieProjectKind = typeof MOVIE_PROJECT_KIND;
export type MovieWorkflowKind = typeof MOVIE_WORKFLOW_KIND;
export type MovieTaskKind = typeof MOVIE_TASK_KIND;

export interface MovieStudioPackageInfo {
  packageName: '@gorenku/movie-core';
  purpose: 'movie-studio-domain';
}

export function getMovieStudioPackageInfo(): MovieStudioPackageInfo {
  return {
    packageName: '@gorenku/movie-core',
    purpose: 'movie-studio-domain',
  };
}
