import { getMovieCliInfo } from './info.js';

describe('movie-cli scaffold', () => {
  it('reports the movie CLI and movie core packages', () => {
    expect(getMovieCliInfo()).toEqual({
      cli: '@gorenku/movie-cli',
      core: {
        packageName: '@gorenku/movie-core',
        purpose: 'movie-studio-domain',
      },
    });
  });
});
