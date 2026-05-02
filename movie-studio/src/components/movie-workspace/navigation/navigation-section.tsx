import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavigationSectionProps {
  title: string;
  detail: string;
  icon: ReactNode;
  active: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggle: () => void;
  children: ReactNode;
}

export function NavigationSection({
  title,
  detail,
  icon,
  active,
  expanded,
  onSelect,
  onToggle,
  children,
}: NavigationSectionProps) {
  return (
    <section className='space-y-1.5'>
      <div
        className={cn(
          'w-full rounded-md border px-2 py-1.5 transition-colors flex items-start gap-2',
          active
            ? 'border-item-active-border bg-item-active-bg'
            : 'border-transparent hover:bg-item-hover-bg hover:border-border/50'
        )}
      >
        <button
          type='button'
          onClick={onSelect}
          className='min-w-0 flex flex-1 items-start gap-2 text-left'
        >
          <span className='mt-0.5 shrink-0 text-muted-foreground'>{icon}</span>
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm font-semibold'>{title}</span>
            <span className='block truncate text-xs text-muted-foreground'>
              {detail}
            </span>
          </span>
        </button>
        <button
          type='button'
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
          aria-expanded={expanded}
          onClick={onToggle}
          className='mt-0.5 -mr-1 shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'
        >
          {expanded ? (
            <ChevronDown className='h-3.5 w-3.5' />
          ) : (
            <ChevronRight className='h-3.5 w-3.5' />
          )}
        </button>
      </div>
      {expanded ? (
        <div className='ml-4 border-l border-border/30 pl-2 space-y-1'>
          {children}
        </div>
      ) : null}
    </section>
  );
}
