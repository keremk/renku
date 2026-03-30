import { Trash2 } from 'lucide-react';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ReadOnlyValue } from './read-only-value';
import { ScalarControl } from './scalar-control';
import type { ScalarEditorProps } from './types';

export function ArrayScalarEditor({
  field,
  value,
  isEditable,
  onChange,
}: ScalarEditorProps) {
  if (field.component !== 'array-scalar') {
    throw new Error(
      `ArrayScalarEditor requires array-scalar component for field "${field.keyPath}", received "${field.component}".`
    );
  }

  if (!field.item) {
    throw new Error(
      `ArrayScalarEditor requires item descriptor for field "${field.keyPath}".`
    );
  }

  if (!isSupportedArrayScalarItem(field.item.component)) {
    throw new Error(
      `ArrayScalarEditor does not support item component "${field.item.component}" for field "${field.keyPath}".`
    );
  }

  if (!isEditable) {
    return <ReadOnlyValue value={value} />;
  }

  const itemField = field.item;
  const rows = Array.isArray(value) ? value : [];

  const updateRows = (nextRows: unknown[]) => {
    onChange(nextRows.length > 0 ? nextRows : undefined);
  };

  const updateRow = (index: number, nextValue: unknown) => {
    const nextRows = [...rows];
    nextRows[index] = nextValue;
    updateRows(nextRows);
  };

  const removeRow = (index: number) => {
    updateRows(rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const addRow = () => {
    updateRows([...rows, resolveInitialRowValue(itemField)]);
  };

  return (
    <div className='space-y-2'>
      <TooltipProvider>
        <div className='overflow-x-auto rounded-md border border-border/60'>
          <table className='w-full text-xs'>
            <thead className='bg-muted/40 text-muted-foreground'>
              <tr>
                <th className='px-3 py-2 text-left font-medium'>
                  {resolveColumnLabel(itemField)}
                </th>
                <th className='w-10 px-1 py-2 text-center font-medium'>
                  <span className='sr-only'>Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-border/60'>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={2} className='px-3 py-3 text-muted-foreground'>
                    No rows yet.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={`row-${index}`}>
                    <td className='px-3 py-2 align-top'>
                      <ScalarControl
                        field={itemField}
                        value={row}
                        isEditable={isEditable}
                        onChange={(nextValue) => updateRow(index, nextValue)}
                      />
                    </td>
                    <td className='w-10 px-1 py-2 align-top'>
                      <div className='flex justify-center'>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              type='button'
                              variant='ghost'
                              size='icon'
                              className='size-7 text-muted-foreground hover:text-destructive'
                              disabled={!isEditable}
                              onClick={() => removeRow(index)}
                              aria-label={`Remove row ${index + 1}`}
                            >
                              <Trash2 className='size-3.5' />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side='top' sideOffset={6}>
                            remove
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </TooltipProvider>

      <Button
        type='button'
        variant='outline'
        size='sm'
        className='h-7 px-2 text-xs'
        disabled={!isEditable}
        onClick={addRow}
      >
        Add Row
      </Button>
    </div>
  );
}

function isSupportedArrayScalarItem(
  component: ConfigFieldDescriptor['component']
): boolean {
  return (
    component === 'string' ||
    component === 'file-uri' ||
    component === 'string-enum' ||
    component === 'number' ||
    component === 'integer' ||
    component === 'boolean'
  );
}

function resolveInitialRowValue(itemField: ConfigFieldDescriptor): unknown {
  if (itemField.schema?.default !== undefined) {
    return cloneDefault(itemField.schema.default);
  }

  if (itemField.component === 'integer' || itemField.component === 'number') {
    const minimum = itemField.schema?.minimum;
    if (typeof minimum === 'number' && Number.isFinite(minimum)) {
      return itemField.component === 'integer' ? Math.round(minimum) : minimum;
    }
  }

  return undefined;
}

function resolveColumnLabel(itemField: ConfigFieldDescriptor): string {
  if (!itemField.label || itemField.label.trim().toLowerCase() === 'item') {
    return 'Value';
  }

  return itemField.label;
}

function cloneDefault<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
