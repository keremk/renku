import { Switch } from '@/components/ui/switch';
import type { ScalarEditorProps } from './types';

export function BooleanEditor({
  value,
  isEditable,
  onChange,
}: ScalarEditorProps) {
  return (
    <div className='flex h-7 items-center pl-[13px]'>
      <Switch
        checked={Boolean(value)}
        onCheckedChange={(checked) => onChange(checked)}
        disabled={!isEditable}
        size='sm'
      />
    </div>
  );
}
