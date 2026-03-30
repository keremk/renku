import type { ReactNode } from 'react';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import { Button } from '@/components/ui/button';
import { PropertyRow } from '../../shared';
import { ColorPickerControl } from './color-picker';
import { resolveObjectInitialValue } from './field-value-utils';
import { getLeafKey } from './path-utils';
import { ReadOnlyValue } from './read-only-value';
import { ResetOverrideButton } from './reset-override-button';
import { ScalarControl } from './scalar-control';
import type { CustomFieldEditorProps } from './types';

export function ArrayObjectTableEditor({
  field,
  rowName,
  description,
  effectiveValue,
  isEditable,
  canResetMappedOverride,
  onChange,
  onReset,
}: CustomFieldEditorProps) {
  if (field.component !== 'array-object-cards') {
    throw new Error(
      `Custom renderer "array-object-table" requires array-object-cards component for field "${field.keyPath}".`
    );
  }

  if (!field.item || field.item.component !== 'object') {
    throw new Error(
      `Custom renderer "array-object-table" requires object item descriptor for field "${field.keyPath}".`
    );
  }

  const rows = Array.isArray(effectiveValue) ? effectiveValue : [];

  const updateRows = (nextRows: unknown[]) => {
    onChange(nextRows);
  };

  const updateRow = (index: number, value: unknown) => {
    const nextRows = [...rows];
    nextRows[index] = value;
    updateRows(nextRows);
  };

  const removeRow = (index: number) => {
    updateRows(rows.filter((_, rowIndex) => rowIndex !== index));
  };

  const addRow = () => {
    const nextRows = [
      ...rows,
      buildInitialRow(field.item as ConfigFieldDescriptor),
    ];
    updateRows(nextRows);
  };

  return (
    <PropertyRow
      name={rowName}
      type={field.component}
      description={description}
      required={field.required}
    >
      <div className='space-y-2'>
        <div className='overflow-x-auto rounded-md border border-border/60'>
          <table className='w-full text-xs'>
            <thead className='bg-muted/40 text-muted-foreground'>
              <tr>
                {renderHeaders(field.item)}
                <th className='px-3 py-2 text-left font-medium'>Actions</th>
              </tr>
            </thead>
            <tbody className='divide-y divide-border/60'>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={getColumnCount(field.item) + 1}
                    className='px-3 py-3 text-muted-foreground'
                  >
                    No rows yet.
                  </td>
                </tr>
              ) : (
                rows.map((row, index) => (
                  <tr key={`row-${index}`}>
                    {renderRowCells({
                      itemField: field.item as ConfigFieldDescriptor,
                      row,
                      rowIndex: index,
                      isEditable,
                      onChange: (nextRow) => updateRow(index, nextRow),
                    })}
                    <td className='px-3 py-2 align-top'>
                      <Button
                        type='button'
                        variant='ghost'
                        size='sm'
                        className='h-7 px-2 text-xs'
                        disabled={!isEditable}
                        onClick={() => removeRow(index)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
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

          {canResetMappedOverride && <ResetOverrideButton onReset={onReset} />}
        </div>
      </div>
    </PropertyRow>
  );
}

function renderHeaders(itemField: ConfigFieldDescriptor): ReactNode {
  if (itemField.custom === 'color-picker') {
    return <th className='px-3 py-2 text-left font-medium'>Color</th>;
  }

  const columns = itemField.fields ?? [];
  return columns.map((columnField) => (
    <th key={columnField.keyPath} className='px-3 py-2 text-left font-medium'>
      {columnField.label}
    </th>
  ));
}

function getColumnCount(itemField: ConfigFieldDescriptor): number {
  if (itemField.custom === 'color-picker') {
    return 1;
  }

  return itemField.fields?.length ?? 0;
}

function renderRowCells(args: {
  itemField: ConfigFieldDescriptor;
  row: unknown;
  rowIndex: number;
  isEditable: boolean;
  onChange: (nextRow: unknown) => void;
}): ReactNode {
  if (args.itemField.custom === 'color-picker') {
    return (
      <td className='px-3 py-2 align-top'>
        <ColorPickerControl
          field={args.itemField}
          value={args.row}
          isEditable={args.isEditable}
          onChange={args.onChange}
          ariaLabel={`Pick color for row ${args.rowIndex + 1}`}
        />
      </td>
    );
  }

  const columns = args.itemField.fields ?? [];
  return columns.map((columnField) => {
    const leaf = getLeafKey(columnField.keyPath);
    const rowObject = toObjectRecord(args.row);
    const columnValue = rowObject?.[leaf];

    return (
      <td key={columnField.keyPath} className='px-3 py-2 align-top'>
        {renderCellEditor({
          columnField,
          value: columnValue,
          isEditable: args.isEditable,
          onChange: (nextValue) => {
            const nextRow = rowObject ? { ...rowObject } : {};
            nextRow[leaf] = nextValue;
            args.onChange(nextRow);
          },
        })}
      </td>
    );
  });
}

function renderCellEditor(args: {
  columnField: ConfigFieldDescriptor;
  value: unknown;
  isEditable: boolean;
  onChange: (value: unknown) => void;
}): ReactNode {
  if (args.columnField.custom === 'color-picker') {
    return (
      <ColorPickerControl
        field={args.columnField}
        value={args.value}
        isEditable={args.isEditable}
        onChange={args.onChange}
        ariaLabel={`Pick color for ${args.columnField.label}`}
      />
    );
  }

  if (isScalarComponent(args.columnField.component)) {
    return (
      <ScalarControl
        field={args.columnField}
        value={args.value}
        isEditable={args.isEditable}
        onChange={args.onChange}
      />
    );
  }

  return <ReadOnlyValue value={args.value} />;
}

function isScalarComponent(
  component: ConfigFieldDescriptor['component']
): boolean {
  return (
    component === 'string' ||
    component === 'file-uri' ||
    component === 'string-enum' ||
    component === 'number' ||
    component === 'integer' ||
    component === 'boolean' ||
    component === 'array-scalar' ||
    component === 'array-file-uri'
  );
}

function buildInitialRow(itemField: ConfigFieldDescriptor): unknown {
  if (itemField.custom === 'color-picker') {
    return resolveObjectInitialValue(itemField);
  }

  const columns = itemField.fields ?? [];
  const nextRow: Record<string, unknown> = {};

  for (const columnField of columns) {
    const leaf = getLeafKey(columnField.keyPath);
    const initialValue = resolveInitialCellValue(columnField);
    if (initialValue !== undefined) {
      nextRow[leaf] = initialValue;
    }
  }

  return nextRow;
}

function resolveInitialCellValue(field: ConfigFieldDescriptor): unknown {
  if (field.schema?.default !== undefined) {
    return field.schema.default;
  }

  if (field.component === 'integer' || field.component === 'number') {
    const minimum = field.schema?.minimum;
    if (typeof minimum === 'number' && Number.isFinite(minimum)) {
      return field.component === 'integer' ? Math.round(minimum) : minimum;
    }
  }

  return undefined;
}

function toObjectRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
