import type { ReactNode } from 'react';
import { Pin, PinOff, Settings2 } from 'lucide-react';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { navigateToPath } from '@/hooks/use-blueprint-route';
import renkuLogo from '../../../../web/public/logo.svg';

interface ViewerPageHeaderProps {
  subtitle: string;
  showSettingsButton?: boolean;
  showPinButton?: boolean;
  isPinned?: boolean;
  onPinToggle?: () => void;
  beforeThemeContent?: ReactNode;
  className?: string;
}

export function ViewerPageHeader({
  subtitle,
  showSettingsButton = false,
  showPinButton = false,
  isPinned = true,
  onPinToggle,
  beforeThemeContent,
  className,
}: ViewerPageHeaderProps) {
  return (
    <TooltipProvider>
      <header
        className={`rounded-[var(--radius-panel)] border border-sidebar-border bg-sidebar-bg overflow-hidden ${className ?? ''}`}
      >
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
            {beforeThemeContent}

            {showSettingsButton && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    className='h-7 w-7 bg-background/35 border-border/50 hover:bg-accent hover:text-accent-foreground'
                    onClick={() => navigateToPath('/settings')}
                    aria-label='Open Settings'
                  >
                    <Settings2 className='h-3.5 w-3.5' />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  Settings
                </TooltipContent>
              </Tooltip>
            )}

            <ThemeToggle />

            {showPinButton && onPinToggle && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='outline'
                    size='icon'
                    className='h-7 w-7 bg-background/35 border-border/50 hover:bg-accent hover:text-accent-foreground'
                    onClick={onPinToggle}
                    aria-label={isPinned ? 'Unpin Header' : 'Pin Header'}
                  >
                    {isPinned ? (
                      <PinOff className='h-3.5 w-3.5' />
                    ) : (
                      <Pin className='h-3.5 w-3.5' />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side='bottom' sideOffset={8}>
                  {isPinned ? 'Unpin Header' : 'Pin Header'}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </header>
    </TooltipProvider>
  );
}
