import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ReadOnlyValue } from './read-only-value';
import type { ScalarEditorProps } from './types';

export function StringEnumEditor({
  field,
  value,
  isEditable,
  onChange,
}: ScalarEditorProps) {
  if (!field.schema?.enum) {
    throw new Error(
      `String enum field "${field.keyPath}" is missing enum options.`
    );
  }

  if (!isEditable) {
    return <ReadOnlyValue value={value} />;
  }

  return (
    <Select
      value={value === undefined ? '' : String(value)}
      onValueChange={(next) => onChange(next)}
    >
      <SelectTrigger className='h-7 text-xs'>
        <SelectValue placeholder='Select...' />
      </SelectTrigger>
      <SelectContent>
        {(field.schema.enum as unknown[]).map((option) => (
          <SelectItem
            key={String(option)}
            value={String(option)}
            className='text-xs'
          >
            {String(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
