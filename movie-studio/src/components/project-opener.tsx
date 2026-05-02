import { useMemo, useState } from 'react';
import { AlertTriangle, Film, FolderOpen, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MovieStudioHeader } from '@/components/layout/movie-studio-header';
import type {
  MovieProjectLibrary,
  MovieProjectListItem,
} from '@/types/movie-project';

interface ProjectOpenerProps {
  error: string | null;
  library: MovieProjectLibrary | null;
  isLoadingLibrary: boolean;
  isOpening: boolean;
  onRefresh: () => Promise<void>;
  onOpen: (projectFolder: string) => Promise<void>;
}

export function ProjectOpener({
  error,
  library,
  isLoadingLibrary,
  isOpening,
  onRefresh,
  onOpen,
}: ProjectOpenerProps) {
  const [query, setQuery] = useState('');

  const filteredMovies = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const movies = library?.movies ?? [];
    if (!normalizedQuery) {
      return movies;
    }
    return movies.filter((movie) =>
      [
        movie.title,
        movie.folderName,
        movie.logline,
        movie.format,
        movie.language,
      ]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery))
    );
  }, [library?.movies, query]);

  return (
    <div className='h-screen w-screen bg-background text-foreground p-4 flex flex-col gap-4'>
      <MovieStudioHeader subtitle='Movie Studio' />

      <main className='flex-1 min-h-0 rounded-(--radius-panel) border border-sidebar-border bg-sidebar-bg overflow-hidden flex flex-col'>
        <div className='h-[52px] px-4 border-b border-border/40 bg-sidebar-header-bg flex items-center justify-between gap-4 shrink-0'>
          <div className='min-w-0 flex items-center gap-2'>
            <FolderOpen className='w-4 h-4 shrink-0 text-muted-foreground' />
            <div className='min-w-0'>
              <h1 className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                Movie Library
              </h1>
              <p className='truncate text-xs text-muted-foreground'>
                {library?.storageRoot ?? 'Loading Movie Studio storage root...'}
              </p>
            </div>
          </div>

          <div className='flex items-center gap-2'>
            <div className='relative hidden sm:block w-[280px]'>
              <Search className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='Search movies'
                className='h-8 pl-8'
              />
            </div>
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={isLoadingLibrary}
              onClick={() => void onRefresh()}
            >
              {isLoadingLibrary ? (
                <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
              ) : (
                <FolderOpen className='mr-2 h-3.5 w-3.5' />
              )}
              Refresh
            </Button>
          </div>
        </div>

        <div className='sm:hidden border-b border-border/40 p-3'>
          <div className='relative'>
            <Search className='pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder='Search movies'
              className='h-8 pl-8'
            />
          </div>
        </div>

        {error ? (
          <div className='mx-4 mt-4 rounded-lg border border-red-500/45 bg-red-500/14 px-3 py-2 text-xs leading-relaxed text-red-700 dark:text-red-300'>
            {error}
          </div>
        ) : null}

        <div className='flex-1 min-h-0 overflow-y-auto p-4'>
          {isLoadingLibrary && !library ? (
            <div className='h-full min-h-[280px] flex items-center justify-center'>
              <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                <Loader2 className='h-4 w-4 animate-spin' />
                Loading movies...
              </div>
            </div>
          ) : filteredMovies.length === 0 ? (
            <EmptyLibrary hasQuery={query.trim() !== ''} />
          ) : (
            <div className='grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3'>
              {filteredMovies.map((movie) => (
                <MovieCard
                  key={movie.projectFolder}
                  movie={movie}
                  isOpening={isOpening}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function MovieCard({
  movie,
  isOpening,
  onOpen,
}: {
  movie: MovieProjectListItem;
  isOpening: boolean;
  onOpen: (projectFolder: string) => Promise<void>;
}) {
  const disabled = isOpening || Boolean(movie.validationError);

  return (
    <button
      type='button'
      disabled={disabled}
      onClick={() => void onOpen(movie.projectFolder)}
      className='group min-w-0 overflow-hidden rounded-xl border border-border/40 bg-card text-left shadow-lg transition-all hover:border-primary/70 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-75'
    >
      <div className='aspect-video bg-muted/50 overflow-hidden border-b border-border/40'>
        {movie.coverUrl ? (
          <img
            src={movie.coverUrl}
            alt=''
            className='h-full w-full object-cover transition-transform group-hover:scale-[1.03]'
          />
        ) : (
          <div className='h-full w-full flex items-center justify-center'>
            <Film className='h-8 w-8 text-muted-foreground' />
          </div>
        )}
      </div>

      <div className='p-3 space-y-2'>
        <div className='flex items-start justify-between gap-2'>
          <div className='min-w-0'>
            <h2 className='line-clamp-2 text-sm font-semibold leading-snug'>
              {movie.title}
            </h2>
            <p className='mt-1 truncate text-[11px] text-muted-foreground'>
              {movie.folderName}
            </p>
          </div>
          {movie.validationError ? (
            <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-300' />
          ) : null}
        </div>

        {movie.logline ? (
          <p className='line-clamp-2 text-xs leading-relaxed text-muted-foreground'>
            {movie.logline}
          </p>
        ) : null}

        {movie.validationError ? (
          <p className='line-clamp-2 text-xs leading-relaxed text-red-700 dark:text-red-300'>
            {movie.validationError.code}: {movie.validationError.message}
          </p>
        ) : (
          <div className='flex flex-wrap gap-1.5'>
            <Metric label='Seq' value={movie.totals?.sequences ?? 0} />
            <Metric label='Scenes' value={movie.totals?.scenes ?? 0} />
            <Metric label='Clips' value={movie.totals?.clips ?? 0} />
          </div>
        )}
      </div>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <span className='rounded-full border border-border/50 bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground'>
      {label}: <span className='font-semibold text-foreground'>{value}</span>
    </span>
  );
}

function EmptyLibrary({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className='h-full min-h-[320px] flex items-center justify-center'>
      <div className='max-w-md rounded-xl border border-border/40 bg-card p-6 text-center shadow-lg'>
        <FolderOpen className='mx-auto h-8 w-8 text-muted-foreground' />
        <h2 className='mt-3 text-sm font-semibold'>
          {hasQuery ? 'No matching movies' : 'No movies found'}
        </h2>
        <p className='mt-2 text-sm leading-relaxed text-muted-foreground'>
          {hasQuery
            ? 'Try a different title, folder name, format, or language.'
            : 'Movie Studio scans immediate child folders in its configured storage root and shows folders that contain movie.yaml.'}
        </p>
      </div>
    </div>
  );
}
