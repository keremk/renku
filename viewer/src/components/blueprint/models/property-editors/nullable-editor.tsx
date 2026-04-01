import type { ReactNode } from 'react';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import { Switch } from '@/components/ui/switch';
import { PropertyRow } from '../../shared';
import { ResetOverrideButton } from './reset-override-button';
import { ScalarControl } from './scalar-control';

interface NullableEditorProps {
  field: ConfigFieldDescriptor;
  valueField: ConfigFieldDescriptor;
  rowName: ReactNode;
  description?: string;
  effectiveValue: unknown;
  isEditable: boolean;
  readOnlyMode?: 'none' | 'dynamic-connected';
  canResetMappedOverride: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
}

export function NullableEditor({
  field,
  valueField,
  rowName,
  description,
  effectiveValue,
  isEditable,
  readOnlyMode = 'none',
  canResetMappedOverride,
  onChange,
  onReset,
}: NullableEditorProps) {
  const isNull = effectiveValue === null;

  return (
    <PropertyRow
      name={rowName}
      type='nullable'
      description={description}
      required={field.required}
    >
      <div className='flex flex-wrap items-start gap-2'>
        <div className='flex h-7 items-center pl-[13px]'>
          <Switch
            aria-label={`Use null value for ${field.label}`}
            checked={isNull}
            onCheckedChange={(checked) => onChange(checked ? null : undefined)}
            disabled={!isEditable}
            size='sm'
          />
        </div>

        {!isNull && (
          <div className='min-w-48 flex-1'>
            <ScalarControl
              field={valueField}
              value={effectiveValue}
              isEditable={isEditable}
              readOnlyMode={readOnlyMode}
              onChange={onChange}
            />
          </div>
        )}

        {canResetMappedOverride && (
          <div className='h-7 flex items-center'>
            <ResetOverrideButton onReset={onReset} />
          </div>
        )}
      </div>
    </PropertyRow>
  );
}
