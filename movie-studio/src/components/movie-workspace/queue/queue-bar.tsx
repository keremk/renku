import { FolderOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { MovieStudioProject } from '@/types/movie-project';
import { StatPill } from '@movie-workspace/shared/stat-pill';

export function QueueBar({ project }: { project: MovieStudioProject }) {
  return (
    <footer className='h-20 rounded-(--radius-panel) border border-sidebar-border bg-sidebar-bg overflow-hidden shrink-0 flex items-center justify-between gap-4 px-4'>
      <div className='min-w-0'>
        <h2 className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
          Queue And Cost
        </h2>
        <p className='mt-1 text-sm text-muted-foreground'>
          No generation jobs queued. Cost tracking will attach to clip and cast
          artifacts in a later pass.
        </p>
      </div>
      <div className='hidden md:flex items-center gap-2'>
        <StatPill label='Sequences' value={project.totals.sequences} />
        <StatPill label='Scenes' value={project.totals.scenes} />
        <StatPill label='Clips' value={project.totals.clips} />
      </div>
      <Button type='button' variant='outline' disabled>
        <FolderOpen className='mr-2 h-4 w-4' />
        Queue Empty
      </Button>
    </footer>
  );
}
