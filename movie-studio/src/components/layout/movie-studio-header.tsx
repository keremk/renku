import { Film } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import renkuLogo from '../../../../web/public/logo.svg';

interface MovieStudioHeaderProps {
  subtitle: string;
  projectTitle?: string;
  onHome?: () => void;
}

export function MovieStudioHeader({
  subtitle,
  projectTitle,
  onHome,
}: MovieStudioHeaderProps) {
  return (
    <header className='rounded-(--radius-panel) border border-sidebar-border bg-sidebar-bg overflow-hidden'>
      <div className='h-14 px-4 sm:px-5 border-b border-border/40 bg-sidebar-header-bg flex items-center justify-between gap-4'>
        <button
          type='button'
          onClick={onHome}
          className='flex items-center gap-3 rounded-md -ml-1 px-1 py-1 hover:bg-item-hover-bg/70 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          aria-label='Go to Movie Studio home'
        >
          <img
            src={renkuLogo}
            alt='Renku'
            className='h-10 w-10 rounded-md object-contain'
          />
          <div className='min-w-0 text-left'>
            <p className='text-sm font-semibold tracking-[0.02em]'>Renku</p>
            <p className='text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold'>
              {subtitle}
            </p>
          </div>
        </button>

        <div className='flex min-w-0 items-center gap-3'>
          {projectTitle ? (
            <div className='hidden sm:flex min-w-0 items-center gap-2 rounded-md border border-border/40 bg-background/35 px-3 py-1.5'>
              <Film className='h-3.5 w-3.5 shrink-0 text-muted-foreground' />
              <span className='truncate text-xs font-medium text-muted-foreground'>
                {projectTitle}
              </span>
            </div>
          ) : null}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
