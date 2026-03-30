import type { ReactNode } from 'react';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import { PropertyRow } from '../../shared';

interface PlaceholderEditorProps {
  field: ConfigFieldDescriptor;
  rowName: ReactNode;
  description?: string;
}

export function PlaceholderEditor({
  field,
  rowName,
  description,
}: PlaceholderEditorProps) {
  return (
    <PropertyRow
      name={rowName}
      type={field.component}
      description={description}
      required={field.required}
    >
      <span className='text-xs text-muted-foreground'>Unavailable</span>
    </PropertyRow>
  );
}
