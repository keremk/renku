import { CheckCircle } from 'lucide-react';

interface StepCongratsProps {
  storageRoot: string;
  mediaProviders: string[];
  promptProviders: string[];
}

export function StepCongrats({ storageRoot, mediaProviders, promptProviders }: StepCongratsProps) {
  const configuredProviders = [...mediaProviders, ...promptProviders];

  return (
    <div className='flex flex-col items-center text-center gap-4 py-2'>
      <div className='w-16 h-16 rounded-full bg-linear-to-br from-emerald-500/20 to-emerald-600/10 flex items-center justify-center'>
        <CheckCircle className='w-8 h-8 text-emerald-500' />
      </div>

      <div className='space-y-2'>
        <h2 className='text-2xl font-semibold'>{"You're all set!"}</h2>
        <p className='text-sm text-muted-foreground'>
          Renku is initialized and ready to create AI movies.
        </p>
      </div>

      <div className='w-full text-left space-y-2 mt-2'>
        <div className='rounded-lg border border-border/40 bg-muted/30 px-4 py-3 space-y-1.5 text-sm'>
          <div className='flex items-start gap-2'>
            <span className='text-muted-foreground shrink-0'>Workspace:</span>
            <span className='font-mono text-xs break-all'>{storageRoot}</span>
          </div>
          {configuredProviders.length > 0 && (
            <div className='flex items-start gap-2'>
              <span className='text-muted-foreground shrink-0'>Providers:</span>
              <span className='text-sm'>{configuredProviders.join(', ')}</span>
            </div>
          )}
        </div>
      </div>

      <p className='text-xs text-muted-foreground'>
        Your API keys are stored in{' '}
        <code className='bg-muted px-1 py-0.5 rounded text-xs'>~/.config/renku/.env</code>
      </p>
    </div>
  );
}
