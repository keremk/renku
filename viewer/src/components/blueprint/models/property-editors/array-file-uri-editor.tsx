import { Textarea } from '@/components/ui/textarea';
import { ReadOnlyValue } from './read-only-value';
import type { ScalarEditorProps } from './types';

export function ArrayFileUriEditor({
  value,
  isEditable,
  onChange,
}: ScalarEditorProps) {
  if (!isEditable) {
    return <ReadOnlyValue value={value} />;
  }

  const serialized = Array.isArray(value)
    ? value.map((item) => String(item)).join('\n')
    : '';

  return (
    <Textarea
      value={serialized}
      onChange={(event) => {
        const next = event.target.value
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);
        onChange(next.length > 0 ? next : undefined);
      }}
      className='text-xs min-h-24'
    />
  );
}
