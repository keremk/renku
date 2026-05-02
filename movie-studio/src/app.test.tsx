// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './app';
import { ThemeProvider } from './contexts/theme-context';
import type { MovieStudioProject } from './types/movie-project';

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.pushState({}, '', '/');
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it('renders the Renku header and project opener', async () => {
    mockFetchSequence([
      { project: null },
      {
        library: {
          storageRoot: '/tmp/movie-studio',
          movies: [],
        },
      },
    ]);

    renderApp();

    await screen.findByText('Movie Library');
    expect(screen.getByText('Renku')).toBeTruthy();
    expect(screen.getAllByPlaceholderText('Search movies').length).toBeGreaterThan(0);
  });

  it('renders the current project title after a successful load', async () => {
    mockFetchSequence([{ project: makeProject() }]);

    renderApp();

    await waitFor(() => {
      expect(screen.getAllByText('Preparation of the Siege').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Sequences').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cast').length).toBeGreaterThan(0);
  });
});

function renderApp() {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>
  );
}

function mockFetchSequence(bodies: unknown[]): void {
  const responses = bodies.map(
    (body) =>
      ({
        ok: true,
        json: async () => body,
      }) as Response
  );
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const response = responses.shift();
    if (!response) {
      throw new Error('Unexpected fetch call');
    }
    return response;
  });
}

function makeProject(): MovieStudioProject {
  return {
    projectFolder: '/tmp/movie',
    movieYamlPath: '/tmp/movie/movie.yaml',
    narrativePath: '/tmp/movie/narrative.md',
    kind: 'renku.movie',
    version: '0.1.0',
    movie: {
      id: 'movie_constantinople_preparation',
      title: 'Preparation of the Siege',
      narrativeFile: 'narrative.md',
    },
    cast: [
      {
        id: 'cast_narrator',
        name: 'Narrator',
        kind: 'narrator',
        role: 'voiceover',
      },
    ],
    sequences: [
      {
        id: 'seq_opening',
        title: 'Opening',
        shortTitle: 'Opening',
        summary: 'The opening sequence.',
        scenes: [
          {
            id: 'scene_1_1',
            title: 'Opening Scene',
            summary: 'The movie begins.',
            clips: [
              {
                id: 'clip_1_1_1',
                title: 'Opening Image',
                summary: 'Establish the movie.',
                cast: ['cast_narrator'],
              },
            ],
          },
        ],
      },
    ],
    totals: {
      cast: 1,
      sequences: 1,
      scenes: 1,
      clips: 1,
    },
  };
}
