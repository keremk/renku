import type { CastEntry } from '@/types/movie-project';
import { CastCard } from './cast-card';

export function CastWorkspace({ castEntry }: { castEntry: CastEntry }) {
  return (
    <div className='max-w-4xl space-y-4'>
      <CastCard castEntry={castEntry} />
      <div className='grid grid-cols-1 md:grid-cols-2 gap-3'>
        {['Base Character Sheet', 'Scene Variations', 'Voice Design', 'Prompt History'].map(
          (label) => (
            <section
              key={label}
              className='rounded-xl border border-border/40 bg-card p-4 shadow-lg'
            >
              <h3 className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
                {label}
              </h3>
              <div className='mt-3 aspect-video rounded-lg border border-border/40 bg-muted/40 flex items-center justify-center text-xs text-muted-foreground'>
                Empty
              </div>
            </section>
          )
        )}
      </div>
    </div>
  );
}
