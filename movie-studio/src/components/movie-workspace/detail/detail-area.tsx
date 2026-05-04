import type { MovieStudioProject, Selection } from '@/types/movie-project';
import { CastWorkspace } from '@movie-workspace/cast/cast-workspace';
import type { MovieLookup } from '@movie-workspace/model/movie-selection';
import { resolveMovieSelection } from '@movie-workspace/model/movie-selection';
import { CastingOverview } from './casting-overview';
import { ClipWorkspace } from './clip-workspace';
import { StoryboardOverview } from './storyboard-overview';

interface DetailAreaProps {
  project: MovieStudioProject;
  selection: Selection;
  lookup: MovieLookup;
}

export function DetailArea({ project, selection, lookup }: DetailAreaProps) {
  const selected = resolveMovieSelection(selection, lookup);

  if (selection.type === 'cast' && selected.castEntry) {
    return <CastWorkspace castEntry={selected.castEntry} />;
  }

  return (
    <section className='min-h-0 rounded-(--radius-panel) border border-panel-border bg-panel-bg overflow-hidden flex flex-col'>
      <div className='h-[45px] px-4 border-b border-border/40 bg-panel-header-bg flex items-center justify-between shrink-0'>
        <div className='min-w-0'>
          <h2 className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
            {selected.kicker}
          </h2>
          <p className='truncate text-sm font-semibold'>{selected.title}</p>
        </div>
        <span className='rounded-full border border-amber-500/45 bg-amber-500/14 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300'>
          Scaffold
        </span>
      </div>

      <div className='flex-1 min-h-0 overflow-y-auto p-4'>
        {selection.type === 'clip' && selected.clip ? (
          <ClipWorkspace clip={selected.clip} project={project} />
        ) : selection.type === 'casting' ? (
          <CastingOverview cast={project.cast} />
        ) : (
          <StoryboardOverview selected={selected} />
        )}
      </div>
    </section>
  );
}
