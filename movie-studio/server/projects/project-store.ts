import type { MovieStudioProject } from './types.js';

let currentProject: MovieStudioProject | null = null;

export function getCurrentMovieProject(): MovieStudioProject | null {
  return currentProject;
}

export function setCurrentMovieProject(project: MovieStudioProject): void {
  currentProject = project;
}
