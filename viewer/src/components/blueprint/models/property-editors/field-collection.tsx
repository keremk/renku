import type { ReactNode } from 'react';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import { ConfigFieldRenderer } from './field-renderer';
import { isInlineCardField } from './inline-card-utils';
import type { FieldCollectionProps } from './types';

export function FieldCollection({
  fields,
  values,
  isEditable,
  onChange,
  sdkPreviewByField,
}: FieldCollectionProps) {
  const rows: ReactNode[] = [];
  let cardBatch: ConfigFieldDescriptor[] = [];
  let cardBatchIndex = 0;

  const flushCardBatch = () => {
    if (cardBatch.length === 0) {
      return;
    }

    const batch = cardBatch;
    cardBatch = [];
    const batchKey = `card-batch-${cardBatchIndex}`;
    cardBatchIndex += 1;

    rows.push(
      <div
        key={batchKey}
        data-testid='config-card-field-grid'
        className='flex flex-wrap items-stretch gap-4'
      >
        {batch.map((field) => (
          <div
            key={field.keyPath}
            className='w-full sm:w-[360px] sm:max-w-[360px] shrink-0'
          >
            <ConfigFieldRenderer
              field={field}
              values={values}
              isEditable={isEditable}
              onChange={onChange}
              sdkPreviewByField={sdkPreviewByField}
            />
          </div>
        ))}
      </div>
    );
  };

  for (const field of fields) {
    if (isInlineCardField(field)) {
      cardBatch.push(field);
      continue;
    }

    flushCardBatch();
    rows.push(
      <ConfigFieldRenderer
        key={field.keyPath}
        field={field}
        values={values}
        isEditable={isEditable}
        onChange={onChange}
        sdkPreviewByField={sdkPreviewByField}
      />
    );
  }

  flushCardBatch();

  if (rows.length === 0) {
    return null;
  }

  return <div className='space-y-4'>{rows}</div>;
}
