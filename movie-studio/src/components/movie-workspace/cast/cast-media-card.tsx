import { Check, MoreHorizontal, Settings2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { CastTake } from './cast-types';

const aspectClasses: Record<CastTake['aspect'], string> = {
  portrait: 'w-[220px]',
  square: 'w-[260px]',
  sheet: 'w-[360px]',
  wide: 'w-[420px]',
  'ratio-4-3': 'w-[320px]',
  'ratio-9-16': 'w-[220px]',
  voice: 'w-[300px]',
  text: 'w-[520px]',
};

const compactAspectClasses: Record<CastTake['aspect'], string> = {
  portrait: 'w-[140px]',
  square: 'w-[150px]',
  sheet: 'w-[250px]',
  wide: 'w-[290px]',
  'ratio-4-3': 'w-[200px]',
  'ratio-9-16': 'w-[125px]',
  voice: 'w-[220px]',
  text: 'w-[400px]',
};

const imageAspectClasses: Record<CastTake['aspect'], string> = {
  portrait: 'aspect-[4/5]',
  square: 'aspect-square',
  sheet: 'aspect-[16/9]',
  wide: 'aspect-[2/1]',
  'ratio-4-3': 'aspect-[4/3]',
  'ratio-9-16': 'aspect-[9/16]',
  voice: 'aspect-[2.4/1]',
  text: 'aspect-[2.6/1]',
};

interface CastMediaCardProps {
  take: CastTake;
  selectedSection?: boolean;
  onOpenDetails: (take: CastTake) => void;
}

export function CastMediaCard({
  take,
  selectedSection = false,
  onOpenDetails,
}: CastMediaCardProps) {
  return (
    <Card
      className={cn(
        'group shrink-0 gap-0 overflow-hidden rounded-xl border bg-card py-0 shadow-lg transition-all',
        'hover:-translate-y-1 hover:border-primary/70 hover:shadow-xl',
        selectedSection
          ? compactAspectClasses[take.aspect]
          : aspectClasses[take.aspect],
        take.selected
          ? 'border-primary/70 ring-2 ring-primary/35'
          : 'border-border/40'
      )}
    >
      <CardContent className='p-3 pb-0'>
        <div
          className={cn(
            'overflow-hidden rounded-lg bg-muted/70 dark:bg-black/65',
            'flex items-center justify-center',
            imageAspectClasses[take.aspect]
          )}
        >
          {take.imageUrl ? (
            <img
              src={take.imageUrl}
              alt=''
              className='h-full w-full rounded-lg object-contain transition-transform duration-300 group-hover:scale-[1.01]'
            />
          ) : take.text ? (
            <div className='h-full w-full overflow-hidden p-5 text-left'>
              <pre className='h-full overflow-hidden whitespace-pre-wrap font-sans text-sm leading-relaxed text-muted-foreground'>
                {take.text}
              </pre>
            </div>
          ) : (
            <div className='h-full w-full p-4 text-left text-xs leading-relaxed text-muted-foreground flex items-center'>
              Young Ottoman ruler, controlled and austere, with a restrained
              court presence.
            </div>
          )}
        </div>
      </CardContent>

      <CardFooter className='mt-3 h-12 border-t border-border/60 bg-muted/45 px-4 py-0 [.border-t]:pt-0 flex items-center justify-between gap-3'>
        <div className='min-w-0 flex items-center gap-2'>
          {take.selected && !selectedSection ? (
            <span className='flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground'>
              <Check className='h-3.5 w-3.5' />
            </span>
          ) : null}
          <div className='min-w-0'>
            <span className='block truncate text-sm font-semibold leading-none'>
              {take.title}
            </span>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type='button'
              variant='ghost'
              size='icon'
              className='h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground'
              aria-label={`${take.title} actions`}
            >
              <MoreHorizontal className='h-4 w-4' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onClick={() => onOpenDetails(take)}>
              <Settings2 className='h-4 w-4' />
              Details
            </DropdownMenuItem>
            {selectedSection ? (
              <DropdownMenuItem>
                <X className='h-4 w-4' />
                Unselect
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem>
                <Check className='h-4 w-4' />
                Select
              </DropdownMenuItem>
            )}
            {!selectedSection ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className='text-destructive focus:text-destructive'>
                  <Trash2 className='h-4 w-4' />
                  Delete
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardFooter>
    </Card>
  );
}
