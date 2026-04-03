import type { ReactNode } from 'react';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import { Switch } from '@/components/ui/switch';
import { PropertyRow } from '../../shared';
import { ReadOnlyValue } from './read-only-value';
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
            {renderNullableValueControl({
              valueField,
              value: effectiveValue,
              isEditable,
              readOnlyMode,
              onChange,
            })}
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

function renderNullableValueControl(args: {
  valueField: ConfigFieldDescriptor;
  value: unknown;
  isEditable: boolean;
  readOnlyMode: 'none' | 'dynamic-connected';
  onChange: (value: unknown) => void;
}) {
  switch (args.valueField.component) {
    case 'string':
    case 'file-uri':
    case 'string-enum':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'array-scalar':
    case 'array-file-uri':
      return (
        <ScalarControl
          field={args.valueField}
          value={args.value}
          isEditable={args.isEditable}
          readOnlyMode={args.readOnlyMode}
          onChange={args.onChange}
        />
      );

    case 'array-object-cards':
      return (
        <div className='space-y-2'>
          <span className='text-xs text-muted-foreground'>
            Array object card editing is not available yet.
          </span>
          <ReadOnlyValue value={args.value} />
        </div>
      );

    case 'object':
    case 'nullable':
    case 'union':
    case 'placeholder-to-be-annotated':
      return (
        <div className='space-y-2'>
          <span className='text-xs text-muted-foreground'>
            "{args.valueField.component}" nullable values are read-only in this
            viewer.
          </span>
          <ReadOnlyValue value={args.value} />
        </div>
      );

    default:
      return assertNever(args.valueField.component);
  }
}

function assertNever(component: never): never {
  throw new Error(`Unhandled nullable value component "${component}".`);
}
