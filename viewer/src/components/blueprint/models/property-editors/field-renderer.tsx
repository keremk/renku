import { PropertyRow } from '../../shared';
import { ArrayObjectCardsEditor } from './array-object-cards-editor';
import {
  getStatusMessages,
  resolveEffectiveFieldValue,
} from './field-value-utils';
import { CustomFieldRenderer } from './custom-field-renderer';
import { NullableEditor } from './nullable-editor';
import { ObjectEditor } from './object-editor';
import { PlaceholderEditor } from './placeholder-editor';
import { ResetOverrideButton } from './reset-override-button';
import { ScalarControl } from './scalar-control';
import type { ConfigFieldRendererProps } from './types';
import { UnionEditor } from './union-editor';

export function ConfigFieldRenderer({
  field,
  values,
  isEditable,
  onChange,
  sdkPreviewByField,
}: ConfigFieldRendererProps) {
  if (field.mappingSource === 'artifact' || field.mappingSource === 'mixed') {
    return null;
  }

  const preview = sdkPreviewByField.get(field.keyPath);
  const { effectiveValue, hasExplicit } = resolveEffectiveFieldValue({
    field,
    values,
    preview,
  });

  const canResetMappedOverride =
    isEditable && field.mappingSource === 'input' && hasExplicit;
  const statusMessages = getStatusMessages(preview);

  const rowName = (
    <span className='inline-flex items-center gap-2'>
      <span>{field.label}</span>
      {field.mappingSource === 'input' && hasExplicit && (
        <span className='inline-flex items-center rounded bg-primary/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary'>
          Override
        </span>
      )}
    </span>
  );

  const description = statusMessages || field.description;
  const resetMappedOverride = () => onChange(field.keyPath, undefined);
  const setFieldValue = (value: unknown) => onChange(field.keyPath, value);

  if (field.custom) {
    return (
      <CustomFieldRenderer
        field={field}
        rowName={rowName}
        description={description}
        effectiveValue={effectiveValue}
        isEditable={isEditable}
        canResetMappedOverride={canResetMappedOverride}
        onChange={setFieldValue}
        onReset={resetMappedOverride}
      />
    );
  }

  switch (field.component) {
    case 'object':
      return (
        <ObjectEditor
          field={field}
          values={values}
          isEditable={isEditable}
          onChange={onChange}
          renderField={(child) => (
            <ConfigFieldRenderer
              key={child.keyPath}
              field={child}
              values={values}
              isEditable={isEditable}
              onChange={onChange}
              sdkPreviewByField={sdkPreviewByField}
            />
          )}
        />
      );

    case 'placeholder-to-be-annotated':
      return (
        <PlaceholderEditor
          field={field}
          rowName={rowName}
          description={description}
        />
      );

    case 'nullable':
      if (!field.value) {
        throw new Error(
          `Nullable field "${field.keyPath}" is missing value descriptor.`
        );
      }
      return (
        <NullableEditor
          field={field}
          valueField={field.value}
          rowName={rowName}
          description={description}
          effectiveValue={effectiveValue}
          isEditable={isEditable}
          canResetMappedOverride={canResetMappedOverride}
          onChange={setFieldValue}
          onReset={resetMappedOverride}
        />
      );

    case 'union':
      return (
        <UnionEditor
          field={field}
          rowName={rowName}
          description={description}
          effectiveValue={effectiveValue}
          isEditable={isEditable}
          canResetMappedOverride={canResetMappedOverride}
          onChange={setFieldValue}
          onReset={resetMappedOverride}
        />
      );

    case 'array-object-cards':
      return (
        <ArrayObjectCardsEditor
          field={field}
          rowName={rowName}
          description={description}
          value={effectiveValue}
          canResetMappedOverride={canResetMappedOverride}
          onReset={resetMappedOverride}
        />
      );

    case 'string':
    case 'file-uri':
    case 'string-enum':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'array-scalar':
    case 'array-file-uri':
      return (
        <PropertyRow
          name={rowName}
          type={field.component}
          description={description}
          required={field.required}
        >
          <div className='space-y-2'>
            <ScalarControl
              field={field}
              value={effectiveValue}
              isEditable={isEditable}
              onChange={setFieldValue}
            />
            {canResetMappedOverride && (
              <ResetOverrideButton onReset={resetMappedOverride} />
            )}
          </div>
        </PropertyRow>
      );

    default:
      return assertNever(field.component);
  }
}

function assertNever(component: never): never {
  throw new Error(`Unhandled viewer component "${component}".`);
}
