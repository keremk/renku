import { Button } from '@/components/ui/button';

interface OnboardingCardProps {
  step: number;
  totalSteps: number;
  title: string;
  children: React.ReactNode;
  onBack?: () => void;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  isLoading?: boolean;
}

export function OnboardingCard({
  step,
  totalSteps,
  title,
  children,
  onBack,
  onNext,
  nextLabel = 'Next',
  nextDisabled = false,
  isLoading = false,
}: OnboardingCardProps) {
  return (
    <div className='max-w-[580px] w-full rounded-xl border bg-card overflow-hidden flex flex-col shadow-2xl'>
      {/* Header */}
      <div className='h-[45px] px-4 border-b border-border/40 bg-sidebar-header-bg flex items-center justify-between shrink-0'>
        <span className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
          {title}
        </span>
        <span className='text-[11px] text-muted-foreground font-medium'>
          {step} / {totalSteps}
        </span>
      </div>

      {/* Content */}
      <div className='px-6 py-6 flex-1'>{children}</div>

      {/* Footer */}
      <div className='px-6 py-4 border-t border-border/40 bg-muted/30 flex items-center justify-between'>
        <Button
          variant='outline'
          onClick={onBack}
          disabled={step === 1 || isLoading}
          className='h-9'
        >
          ← Previous
        </Button>
        <Button
          onClick={onNext}
          disabled={nextDisabled || isLoading}
          className='h-9'
        >
          {isLoading ? 'Working...' : nextLabel}
        </Button>
      </div>
    </div>
  );
}
