import { Input } from '@/components/ui/input';
import { ReadOnlyValue } from './read-only-value';
import type { ScalarEditorProps } from './types';

export function StringEditor({
  value,
  isEditable,
  onChange,
}: ScalarEditorProps) {
  if (!isEditable) {
    return <ReadOnlyValue value={value} />;
  }

  return (
    <Input
      type='text'
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value || undefined)}
      className='h-7 text-xs'
    />
  );
}
