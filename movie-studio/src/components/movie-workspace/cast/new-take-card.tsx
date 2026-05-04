import { FileText, ImagePlus, Mic2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CastDesignTab } from './cast-types';

interface NewTakeCardProps {
  activeTab: CastDesignTab;
  variant?: 'description-text' | 'description-image' | 'default';
  onClick: () => void;
}

const defaultLabels: Record<CastDesignTab, string> = {
  description: 'New Description',
  'character-sheet': 'New Character Sheet Take',
  'voice-design': 'New Voice Take',
};

const cardWidthClasses: Record<CastDesignTab, string> = {
  description: 'w-[220px]',
  'character-sheet': 'w-[360px]',
  'voice-design': 'w-[360px]',
};

const previewAspectClasses: Record<CastDesignTab, string> = {
  description: 'aspect-[4/5]',
  'character-sheet': 'aspect-[16/9]',
  'voice-design': 'aspect-[16/9]',
};

const descriptionVariants = {
  'description-text': {
    label: 'New Description Text',
    description: 'Start a markdown description take',
    icon: FileText,
  },
  'description-image': {
    label: 'New Description Image',
    description: 'Create visual reference takes',
    icon: ImagePlus,
  },
};

function getCardContent(
  activeTab: CastDesignTab,
  variant: NewTakeCardProps['variant']
) {
  if (activeTab === 'description' && variant && variant !== 'default') {
    return descriptionVariants[variant];
  }

  if (activeTab === 'voice-design') {
    return {
      label: defaultLabels[activeTab],
      description: 'Open generation settings',
      icon: Mic2,
    };
  }

  return {
    label: defaultLabels[activeTab],
    description: 'Open generation settings',
    icon: Plus,
  };
}

export function NewTakeCard({
  activeTab,
  variant = 'default',
  onClick,
}: NewTakeCardProps) {
  const content = getCardContent(activeTab, variant);
  const Icon = content.icon;

  return (
    <Card
      className={cn(
        'group shrink-0 gap-0 overflow-hidden rounded-xl border border-dashed border-primary/60 bg-primary/8 py-0 shadow-lg transition-all hover:-translate-y-1 hover:border-primary hover:bg-primary/12 hover:shadow-xl',
        cardWidthClasses[activeTab]
      )}
    >
      <CardContent className='p-3'>
        <Button
          type='button'
          variant='ghost'
          onClick={onClick}
          className={cn(
            'h-auto w-full rounded-lg border border-primary/25 bg-muted/55 p-0 text-foreground ring-1 ring-border/35 hover:bg-muted/70 dark:bg-black/45 dark:hover:bg-black/55',
            previewAspectClasses[activeTab]
          )}
        >
          <span className='flex h-full w-full flex-col items-center justify-center gap-3 px-5 text-center'>
            <span className='flex h-12 w-12 items-center justify-center rounded-full border border-primary/40 bg-primary/15 text-primary shadow-sm'>
              <Icon className='h-6 w-6' />
            </span>
            <span className='text-sm font-semibold'>{content.label}</span>
            <span className='text-xs font-normal text-muted-foreground'>
              {content.description}
            </span>
          </span>
        </Button>
      </CardContent>
    </Card>
  );
}
