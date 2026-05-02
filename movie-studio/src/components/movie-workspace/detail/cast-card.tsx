import type { CastEntry } from '@/types/movie-project';
import { ReadinessDot } from '../shared/readiness-dot';

export function CastCard({ castEntry }: { castEntry: CastEntry }) {
  return (
    <article className='rounded-xl border border-border/40 bg-card p-4 shadow-lg'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='truncate text-sm font-semibold'>{castEntry.name}</h3>
          <p className='mt-1 text-xs text-muted-foreground'>
            {[castEntry.kind, castEntry.role].filter(Boolean).join(' / ') ||
              'Cast entry'}
          </p>
        </div>
        <ReadinessDot />
      </div>
      {castEntry.shortDescription ? (
        <p className='mt-3 text-sm leading-relaxed text-muted-foreground'>
          {castEntry.shortDescription}
        </p>
      ) : null}
    </article>
  );
}
