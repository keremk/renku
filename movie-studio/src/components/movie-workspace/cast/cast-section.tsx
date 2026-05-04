import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface CastSectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function CastSection({ title, children, className }: CastSectionProps) {
  const [open, setOpen] = useState(true);

  return (
    <Card
      className={cn(
        'min-h-0 gap-0 overflow-hidden rounded-xl border border-border/40 bg-muted/20 py-0 shadow-lg',
        className,
        !open && 'flex-none'
      )}
    >
      <CardHeader className='flex h-[45px] border-b border-border/40 bg-panel-header-bg px-5 py-0 [.border-b]:pb-0 flex-row items-center justify-between gap-3'>
        <CardTitle className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
          {title}
        </CardTitle>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='h-7 w-7 text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:ring-0'
          onClick={() => setOpen((current) => !current)}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
        >
          <ChevronDown
            className={cn('h-4 w-4 transition-transform', !open && '-rotate-90')}
          />
        </Button>
      </CardHeader>
      {open ? (
        <CardContent className='min-h-0 flex-1 px-0'>{children}</CardContent>
      ) : null}
    </Card>
  );
}
