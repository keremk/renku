import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import type { GenerationSettings } from './cast-types';

interface GenerationSettingsPaneProps {
  settings: GenerationSettings;
  onClose: () => void;
}

export function GenerationSettingsPane({
  settings,
  onClose,
}: GenerationSettingsPaneProps) {
  return (
    <aside className='w-[340px] shrink-0 border-l border-border/40 bg-sidebar-bg flex flex-col min-h-0'>
      <div className='h-[45px] shrink-0 border-b border-border/40 bg-sidebar-header-bg px-4 flex items-center justify-between gap-3'>
        <h3 className='truncate text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
          {settings.title}
        </h3>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='h-7 w-7'
          onClick={onClose}
          aria-label='Close generation settings'
        >
          <X className='h-4 w-4' />
        </Button>
      </div>

      <div className='flex-1 min-h-0 overflow-y-auto p-4 space-y-4'>
        {settings.fields.map((field) => (
          <label key={field.label} className='block space-y-1.5'>
            <span className='text-xs font-medium text-muted-foreground'>
              {field.label}
            </span>
            {field.label === 'Model' ? (
              <Select value={field.value}>
                <SelectTrigger className='w-full bg-background/35'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={field.value}>{field.value}</SelectItem>
                </SelectContent>
              </Select>
            ) : field.multiline ? (
              <Textarea
                value={field.value}
                readOnly
                rows={field.label === 'Prompt' ? 5 : 3}
                placeholder={field.label === 'Negative prompt' ? 'Optional' : undefined}
                className='resize-none bg-background/35 leading-relaxed'
              />
            ) : (
              <Input value={field.value} readOnly className='bg-background/35' />
            )}
          </label>
        ))}
      </div>

      <div className='shrink-0 border-t border-border/40 bg-dialog-footer-bg p-4'>
        <Button type='button' className='w-full'>
          {settings.actionLabel}
        </Button>
      </div>
    </aside>
  );
}
