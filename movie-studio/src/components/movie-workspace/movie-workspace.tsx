import { useMemo, useState } from 'react';
import { MovieStudioHeader } from '@/components/layout/movie-studio-header';
import type { MovieStudioProject, Selection } from '@/types/movie-project';
import { DetailArea } from './detail/detail-area';
import { buildMovieLookup } from './model/movie-selection';
import { MovieNavigation } from './navigation/movie-navigation';
import { QueueBar } from './queue/queue-bar';

interface MovieWorkspaceProps {
  project: MovieStudioProject;
  onHome: () => void;
}

export function MovieWorkspace({ project, onHome }: MovieWorkspaceProps) {
  const [selection, setSelection] = useState<Selection>({ type: 'storyboard' });
  const lookup = useMemo(() => buildMovieLookup(project), [project]);

  return (
    <div className='h-screen w-screen bg-background text-foreground p-3 flex flex-col gap-3'>
      <MovieStudioHeader
        subtitle='Movie Studio'
        projectTitle={project.movie.title}
        onHome={onHome}
      />

      <main className='flex-1 min-h-0 grid grid-cols-[300px_minmax(0,1fr)] gap-3'>
        <MovieNavigation
          project={project}
          selection={selection}
          onSelect={setSelection}
        />
        <DetailArea project={project} selection={selection} lookup={lookup} />
      </main>

      <QueueBar project={project} />
    </div>
  );
}
