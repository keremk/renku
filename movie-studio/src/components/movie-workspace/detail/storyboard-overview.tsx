import { ReadinessDot } from '../shared/readiness-dot';
import type { ResolvedSelection } from '../model/movie-selection';

export function StoryboardOverview({
  selected,
}: {
  selected: ResolvedSelection;
}) {
  return (
    <div className='space-y-4'>
      <p className='max-w-3xl text-sm leading-relaxed text-muted-foreground'>
        {selected.summary}
      </p>
      <div className='grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-3'>
        {selected.clips.map((clip) => (
          <article
            key={clip.id}
            className='rounded-xl border border-border/40 bg-card p-4 shadow-lg space-y-3'
          >
            <div className='flex items-start justify-between gap-3'>
              <div className='min-w-0'>
                <h3 className='truncate text-sm font-semibold'>{clip.title}</h3>
                <p className='mt-1 text-xs leading-relaxed text-muted-foreground'>
                  {clip.summary ?? 'Narrative structure loaded. Production assets pending.'}
                </p>
              </div>
              <ReadinessDot />
            </div>
            <div className='aspect-video rounded-lg border border-border/40 bg-muted/40 flex items-center justify-center text-xs text-muted-foreground'>
              Narrative only
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
