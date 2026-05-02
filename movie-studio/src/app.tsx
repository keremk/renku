import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ProjectOpener } from '@/components/project-opener';
import { MovieWorkspace } from '@/components/movie-workspace';
import {
  fetchCurrentMovieProject,
  fetchMovieProjectLibrary,
  openMovieProject,
} from '@/data/movie-studio-client';
import type {
  MovieProjectLibrary,
  MovieStudioProject,
} from '@/types/movie-project';

function App() {
  const [project, setProject] = useState<MovieStudioProject | null>(null);
  const [library, setLibrary] = useState<MovieProjectLibrary | null>(null);
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(true);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentMovieProject()
      .then((currentProject) => {
        if (!cancelled) {
          setProject(currentProject);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProject(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingCurrent(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refreshLibrary = useCallback(async () => {
    setIsLoadingLibrary(true);
    setError(null);
    try {
      setLibrary(await fetchMovieProjectLibrary());
    } catch (libraryError) {
      setError(
        libraryError instanceof Error
          ? libraryError.message
          : 'Unable to load movie library.'
      );
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoadingCurrent && !project) {
      void refreshLibrary();
    }
  }, [isLoadingCurrent, project, refreshLibrary]);

  const handleOpenProject = useCallback(async (projectFolder: string) => {
    setIsOpening(true);
    setError(null);
    try {
      const nextProject = await openMovieProject(projectFolder);
      setProject(nextProject);
      window.history.pushState({}, '', '/project');
    } catch (openError) {
      setError(
        openError instanceof Error
          ? openError.message
          : 'Unable to open movie project.'
      );
    } finally {
      setIsOpening(false);
    }
  }, []);

  const handleHome = useCallback(() => {
    setProject(null);
    setError(null);
    window.history.pushState({}, '', '/');
    void refreshLibrary();
  }, [refreshLibrary]);

  if (isLoadingCurrent) {
    return (
      <div className='min-h-screen flex items-center justify-center bg-background text-foreground px-6'>
        <div className='max-w-xl w-full rounded-2xl border border-border/50 bg-card/60 p-8 shadow-lg flex flex-col gap-4 items-center'>
          <Loader2 className='w-5 h-5 animate-spin text-muted-foreground' />
          <p className='text-sm text-muted-foreground'>Loading Movie Studio...</p>
        </div>
      </div>
    );
  }

  if (project) {
    return <MovieWorkspace project={project} onHome={handleHome} />;
  }

  return (
    <ProjectOpener
      error={error}
      library={library}
      isLoadingLibrary={isLoadingLibrary}
      isOpening={isOpening}
      onRefresh={refreshLibrary}
      onOpen={handleOpenProject}
    />
  );
}

export default App;
