import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { uploadAndValidate } from '@/lib/panel-utils';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { FileUploadDialog } from '../../inputs/file-upload-dialog';
import {
  FileUriValueControl,
  getEditableUploadContext,
  resolveFileUriUploadMediaType,
  toUploadInputType,
} from './file-uri-value-control';
import { useFileUriUploadContext } from './file-uri-upload-context';
import type { ScalarEditorProps } from './types';

export function ArrayFileUriEditor({
  field,
  value,
  isEditable,
  onChange,
}: ScalarEditorProps) {
  if (field.component !== 'array-file-uri') {
    throw new Error(
      `ArrayFileUriEditor requires array-file-uri component for field "${field.keyPath}", received "${field.component}".`
    );
  }

  if (!field.item || field.item.component !== 'file-uri') {
    throw new Error(
      `ArrayFileUriEditor requires file-uri item descriptor for field "${field.keyPath}".`
    );
  }

  const itemField = field.item;

  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const rows = useMemo(() => sanitizeFileUriRows(value), [value]);
  const uploadContext = useFileUriUploadContext();

  useEffect(() => {
    if (!isEditable || !Array.isArray(value)) {
      return;
    }

    const normalized = sanitizeFileUriRows(value);
    if (!areSanitizedRowsEqual(value, normalized)) {
      onChange(normalized.length > 0 ? normalized : undefined);
    }
  }, [isEditable, onChange, value]);

  const editableUploadContext = useMemo(
    () =>
      getEditableUploadContext(uploadContext, {
        fieldKeyPath: field.keyPath,
        isEditable,
      }),
    [field.keyPath, isEditable, uploadContext]
  );

  const uploadMediaType = useMemo(
    () => resolveFileUriUploadMediaType(itemField),
    [itemField]
  );

  const updateRows = useCallback(
    (nextRows: unknown[]) => {
      const normalized = sanitizeFileUriRows(nextRows);
      onChange(normalized.length > 0 ? normalized : undefined);
    },
    [onChange]
  );

  const updateRow = useCallback(
    (index: number, nextValue: unknown) => {
      if (typeof nextValue !== 'string') {
        throw new Error(
          `Array file-uri row "${field.keyPath}[${index}]" requires a string file reference.`
        );
      }

      const nextRows = [...rows];
      nextRows[index] = nextValue;
      updateRows(nextRows);
    },
    [field.keyPath, rows, updateRows]
  );

  const removeRow = useCallback(
    (index: number) => {
      updateRows(rows.filter((_, rowIndex) => rowIndex !== index));
    },
    [rows, updateRows]
  );

  const handleAddRowUpload = useCallback(
    async (files: File[]) => {
      if (!editableUploadContext) {
        throw new Error(
          `Cannot upload for field "${field.keyPath}" without editable upload context.`
        );
      }

      const result = await uploadAndValidate(
        editableUploadContext,
        files,
        toUploadInputType(uploadMediaType)
      );

      const uploaded = result.files[0];
      if (!uploaded) {
        throw new Error(
          `Upload did not return a file reference for field "${field.keyPath}".`
        );
      }

      updateRows([...rows, uploaded.fileRef]);
    },
    [editableUploadContext, field.keyPath, rows, updateRows, uploadMediaType]
  );

  return (
    <div className='space-y-2'>
      <TooltipProvider>
        <div className='rounded-md border border-border/60'>
          <table className='w-full table-fixed text-xs'>
            <thead className='bg-muted/40 text-muted-foreground'>
              <tr>
                <th className='px-3 py-2 text-left font-medium'>
                  {itemField.label &&
                  itemField.label.trim().toLowerCase() !== 'item'
                    ? itemField.label
                    : 'Value'}
                </th>
                <th className='w-11 px-1 py-2 text-center font-medium'>
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
                    <td className='px-2 py-2 align-middle'>
                      <FileUriValueControl
                        field={itemField}
                        value={row}
                        isEditable={isEditable}
                        onChange={(nextValue) => updateRow(index, nextValue)}
                        onRemove={() => removeRow(index)}
                        removeLabel={`Remove row ${index + 1}`}
                      />
                    </td>

                    <td className='w-11 px-1 py-2 align-middle'>
                      <div className='flex h-full items-center justify-center'>
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

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type='button'
              variant='outline'
              size='icon'
              className='size-7'
              disabled={!isEditable}
              onClick={() => setIsAddDialogOpen(true)}
              aria-label='Add row'
            >
              <Plus className='size-3.5' />
            </Button>
          </TooltipTrigger>
          <TooltipContent side='top' sideOffset={6}>
            add row
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <FileUploadDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        mediaType={uploadMediaType}
        multiple={false}
        onConfirm={handleAddRowUpload}
      />
    </div>
  );
}

function sanitizeFileUriRows(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      continue;
    }

    const trimmed = entry.trim();
    if (trimmed.length === 0) {
      continue;
    }

    rows.push(trimmed);
  }

  return rows;
}

function areSanitizedRowsEqual(raw: unknown[], normalized: string[]): boolean {
  const rawAsStrings = raw
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (rawAsStrings.length !== normalized.length) {
    return false;
  }

  for (let index = 0; index < rawAsStrings.length; index += 1) {
    if (rawAsStrings[index] !== normalized[index]) {
      return false;
    }
  }

  return true;
}
