import { Input } from '@/components/ui/input';
import { ReadOnlyValue } from './read-only-value';
import type { ScalarEditorProps } from './types';

export function NumberEditor({
  field,
  value,
  isEditable,
  onChange,
}: ScalarEditorProps) {
  if (!isEditable) {
    return <ReadOnlyValue value={value} />;
  }

  return (
    <Input
      type='number'
      value={typeof value === 'number' ? value : ''}
      min={field.schema?.minimum}
      max={field.schema?.maximum}
      step={0.1}
      onChange={(event) => {
        const next = event.target.value;
        if (next === '') {
          onChange(undefined);
          return;
        }
        const parsed = Number(next);
        onChange(Number.isFinite(parsed) ? parsed : undefined);
      }}
      className='h-7 w-[120px] text-xs'
    />
  );
}
