import type { ReactNode } from 'react';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import { PropertyRow } from '../../shared';
import { ReadOnlyValue } from './read-only-value';
import { ResetOverrideButton } from './reset-override-button';

interface ArrayObjectCardsEditorProps {
  field: ConfigFieldDescriptor;
  rowName: ReactNode;
  description?: string;
  value: unknown;
  canResetMappedOverride: boolean;
  onReset: () => void;
}

export function ArrayObjectCardsEditor({
  field,
  rowName,
  description,
  value,
  canResetMappedOverride,
  onReset,
}: ArrayObjectCardsEditorProps) {
  return (
    <PropertyRow
      name={rowName}
      type={field.component}
      description={description}
      required={field.required}
    >
      <div className='space-y-2'>
        <span className='text-xs text-muted-foreground'>
          Array object card editing is not available yet.
        </span>
        <ReadOnlyValue value={value} />
        {canResetMappedOverride && <ResetOverrideButton onReset={onReset} />}
      </div>
    </PropertyRow>
  );
}
