import {
  MOVIE_PROJECT_KIND,
  MOVIE_TASK_KIND,
  MOVIE_WORKFLOW_KIND,
  getMovieStudioPackageInfo,
} from './index.js';

describe('movie-core scaffold', () => {
  it('exports Movie Studio document kinds', () => {
    expect(MOVIE_PROJECT_KIND).toBe('renku.movie');
    expect(MOVIE_WORKFLOW_KIND).toBe('renku.movieWorkflow');
    expect(MOVIE_TASK_KIND).toBe('renku.movieTask');
  });

  it('identifies the new Movie Studio domain package', () => {
    expect(getMovieStudioPackageInfo()).toEqual({
      packageName: '@gorenku/movie-core',
      purpose: 'movie-studio-domain',
    });
  });
});
