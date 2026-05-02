import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ReadinessDot } from '../shared/readiness-dot';

interface NavButtonProps {
  active: boolean;
  icon: ReactNode;
  label: string;
  detail: string;
  disclosure?: {
    expanded: boolean;
    label: string;
    onToggle: () => void;
  };
  compact?: boolean;
  onClick: () => void;
}

export function NavButton({
  active,
  icon,
  label,
  detail,
  disclosure,
  compact = false,
  onClick,
}: NavButtonProps) {
  return (
    <div
      className={cn(
        'w-full min-w-0 rounded-md border text-left transition-colors flex items-start gap-2',
        compact ? 'px-2 py-1.5' : 'px-3 py-2.5',
        active
          ? 'border-item-active-border bg-item-active-bg'
          : 'border-transparent hover:bg-item-hover-bg hover:border-border/50'
      )}
    >
      <button
        type='button'
        onClick={onClick}
        className='min-w-0 flex flex-1 items-start gap-2 text-left'
      >
        <span className='mt-0.5 shrink-0 text-muted-foreground'>{icon}</span>
        <span className='min-w-0 flex-1'>
          <span className='block truncate text-sm font-medium'>{label}</span>
          <span className='block truncate text-xs text-muted-foreground'>
            {detail}
          </span>
        </span>
      </button>
      {disclosure ? (
        <button
          type='button'
          aria-label={disclosure.label}
          aria-expanded={disclosure.expanded}
          onClick={disclosure.onToggle}
          className='mt-0.5 -mr-1 shrink-0 rounded-sm p-1 text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground'
        >
          {disclosure.expanded ? (
            <ChevronDown className='h-3.5 w-3.5' />
          ) : (
            <ChevronRight className='h-3.5 w-3.5' />
          )}
        </button>
      ) : (
        <ReadinessDot />
      )}
    </div>
  );
}
