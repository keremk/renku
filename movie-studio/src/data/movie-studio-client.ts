import type {
  MovieProjectLibrary,
  MovieStudioProject,
} from '@/types/movie-project';

interface ProjectResponse {
  project: MovieStudioProject | null;
}

interface LibraryResponse {
  library: MovieProjectLibrary;
}

interface ErrorResponse {
  error?: {
    code?: string;
    message?: string;
  };
}

export async function openMovieProject(
  projectFolder: string
): Promise<MovieStudioProject> {
  const response = await fetch('/movie-studio-api/projects/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectFolder }),
  });

  if (!response.ok) {
    throw await readRequestError(response);
  }

  const body = (await response.json()) as ProjectResponse;
  if (!body.project) {
    throw new Error('Movie Studio API returned no project.');
  }
  return body.project;
}

export async function fetchCurrentMovieProject(): Promise<MovieStudioProject | null> {
  const response = await fetch('/movie-studio-api/projects/current');
  if (!response.ok) {
    throw await readRequestError(response);
  }
  const body = (await response.json()) as ProjectResponse;
  return body.project;
}

export async function fetchMovieProjectLibrary(): Promise<MovieProjectLibrary> {
  const response = await fetch('/movie-studio-api/projects/list');
  if (!response.ok) {
    throw await readRequestError(response);
  }
  const body = (await response.json()) as LibraryResponse;
  return body.library;
}

async function readRequestError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as ErrorResponse;
    const code = body.error?.code;
    const message = body.error?.message ?? response.statusText;
    return new Error(code ? `${code}: ${message}` : message);
  } catch {
    return new Error(response.statusText);
  }
}
