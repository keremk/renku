import { Settings2 } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';
import { navigateToPath } from '@/hooks/use-blueprint-route';
import renkuLogo from '../../../../web/public/logo.svg';

interface ViewerPageHeaderProps {
  subtitle: string;
  showSettingsButton?: boolean;
}

export function ViewerPageHeader({
  subtitle,
  showSettingsButton = false,
}: ViewerPageHeaderProps) {
  return (
    <header className='rounded-[var(--radius-panel)] border border-sidebar-border bg-sidebar-bg overflow-hidden'>
      <div className='h-[56px] px-4 sm:px-5 border-b border-border/40 bg-sidebar-header-bg flex items-center justify-between'>
        <button
          type='button'
          onClick={() => navigateToPath('/')}
          className='flex items-center gap-3 rounded-md -ml-1 px-1 py-1 hover:bg-item-hover-bg/70 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
          aria-label='Go to Home'
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

        <div className='flex items-center gap-2'>
          {showSettingsButton && (
            <Button
              type='button'
              variant='outline'
              size='icon'
              className='h-7 w-7 bg-background/35 border-border/50 hover:bg-item-hover-bg'
              onClick={() => navigateToPath('/settings')}
              aria-label='Open Settings'
            >
              <Settings2 className='h-3.5 w-3.5' />
            </Button>
          )}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
