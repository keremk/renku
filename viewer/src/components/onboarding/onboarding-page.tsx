import { ThemeToggle } from '@/components/ui/theme-toggle';
import { OnboardingFlow } from './onboarding-flow.js';
import renkuLogo from '../../../../web/public/logo.svg';

interface OnboardingPageProps {
  onComplete: () => void;
}

export function OnboardingPage({ onComplete }: OnboardingPageProps) {
  return (
    <div className='h-screen w-screen bg-background text-foreground p-4 flex flex-col gap-4'>
      <header className='rounded-(--radius-panel) border border-sidebar-border bg-sidebar-bg overflow-hidden'>
        <div className='h-14 px-4 sm:px-5 border-b border-border/40 bg-sidebar-header-bg flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <img
              src={renkuLogo}
              alt='Renku'
              className='h-10 w-10 rounded-md object-contain'
            />
            <div className='min-w-0'>
              <p className='text-sm font-semibold tracking-[0.02em]'>Renku</p>
              <p className='text-[11px] uppercase tracking-[0.12em] text-muted-foreground font-semibold'>
                Setup
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className='flex-1 min-h-0 flex items-center justify-center'>
        <OnboardingFlow onComplete={onComplete} />
      </main>
    </div>
  );
}
