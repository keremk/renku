import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SdkPreviewFieldInstance } from '@/types/blueprint-graph';
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
  const isDynamicReadOnly =
    field.mappingSource === 'input' &&
    preview?.connected === true &&
    preview.overridePolicy === 'read_only_dynamic';
  const previewInstances = isDynamicReadOnly ? preview.instances ?? [] : [];

  const [activeInstanceIndex, setActiveInstanceIndex] = useState(0);
  useEffect(() => {
    setActiveInstanceIndex(0);
  }, [field.keyPath, previewInstances.length]);

  const boundedInstanceIndex =
    previewInstances.length > 0
      ? Math.min(activeInstanceIndex, previewInstances.length - 1)
      : 0;
  const activeInstance =
    previewInstances.length > 0
      ? previewInstances[boundedInstanceIndex]
      : undefined;

  const baseValueResolution = resolveEffectiveFieldValue({
    field,
    values,
    preview,
  });
  const effectiveValue = isDynamicReadOnly
    ? activeInstance?.value ?? preview?.value
    : baseValueResolution.effectiveValue;
  const hasExplicit = isDynamicReadOnly ? false : baseValueResolution.hasExplicit;
  const fieldIsEditable = isDynamicReadOnly ? false : isEditable;

  const canResetMappedOverride =
    fieldIsEditable && field.mappingSource === 'input' && hasExplicit;
  const statusMessages =
    getInstanceStatusMessages(activeInstance) ?? getStatusMessages(preview);
  const showInstancePager = previewInstances.length > 1;
  const readOnlyMode = isDynamicReadOnly ? 'dynamic-connected' : 'none';

  const rowName = (
    <span className='inline-flex items-center gap-2'>
      <span>{field.label}</span>
      {field.mappingSource === 'input' && hasExplicit && !isDynamicReadOnly && (
        <span className='inline-flex items-center rounded bg-primary/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-primary'>
          Override
        </span>
      )}
    </span>
  );

  const description = statusMessages || field.description;
  const resetMappedOverride = () => onChange(field.keyPath, undefined);
  const setFieldValue = (value: unknown) => onChange(field.keyPath, value);
  const wrapWithInstancePager = (content: JSX.Element) => {
    if (!showInstancePager) {
      return content;
    }

    return (
      <div className='space-y-2'>
        <ConnectedFieldInstancePager
          fieldLabel={field.label}
          instances={previewInstances}
          activeInstanceIndex={boundedInstanceIndex}
          onPrevious={() =>
            setActiveInstanceIndex((current) => Math.max(0, current - 1))
          }
          onNext={() =>
            setActiveInstanceIndex((current) =>
              Math.min(previewInstances.length - 1, current + 1)
            )
          }
        />
        {content}
      </div>
    );
  };

  if (field.custom) {
    return wrapWithInstancePager(
      <CustomFieldRenderer
        field={field}
        rowName={rowName}
        description={description}
        effectiveValue={effectiveValue}
        isEditable={fieldIsEditable}
        canResetMappedOverride={canResetMappedOverride}
        onChange={setFieldValue}
        onReset={resetMappedOverride}
      />
    );
  }

  switch (field.component) {
    case 'object':
      return wrapWithInstancePager(
        <ObjectEditor
          field={field}
          values={values}
          isEditable={fieldIsEditable}
          onChange={onChange}
          renderField={(child) => (
            <ConfigFieldRenderer
              key={child.keyPath}
              field={child}
              values={values}
              isEditable={fieldIsEditable}
              onChange={onChange}
              sdkPreviewByField={sdkPreviewByField}
            />
          )}
        />
      );

    case 'placeholder-to-be-annotated':
      return wrapWithInstancePager(
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
        wrapWithInstancePager(
          <NullableEditor
            field={field}
            valueField={field.value}
            rowName={rowName}
            description={description}
            effectiveValue={effectiveValue}
            isEditable={fieldIsEditable}
            readOnlyMode={readOnlyMode}
            canResetMappedOverride={canResetMappedOverride}
            onChange={setFieldValue}
            onReset={resetMappedOverride}
          />
        )
      );

    case 'union':
      return wrapWithInstancePager(
        <UnionEditor
          field={field}
          rowName={rowName}
          description={description}
          effectiveValue={effectiveValue}
          isEditable={fieldIsEditable}
          readOnlyMode={readOnlyMode}
          canResetMappedOverride={canResetMappedOverride}
          onChange={setFieldValue}
          onReset={resetMappedOverride}
        />
      );

    case 'array-object-cards':
      return wrapWithInstancePager(
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
      return wrapWithInstancePager(
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
              isEditable={fieldIsEditable}
              readOnlyMode={readOnlyMode}
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

function getInstanceStatusMessages(
  instance: SdkPreviewFieldInstance | undefined
): string | undefined {
  if (!instance) {
    return undefined;
  }

  const messages = [...instance.errors, ...instance.warnings].join(' ');
  return messages.length > 0 ? messages : undefined;
}

function ConnectedFieldInstancePager(args: {
  fieldLabel: string;
  instances: SdkPreviewFieldInstance[];
  activeInstanceIndex: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className='flex items-center justify-end pr-1'>
      <div className='inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/20 p-0.5'>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-6'
          onClick={args.onPrevious}
          disabled={args.activeInstanceIndex === 0}
          aria-label={`Previous ${args.fieldLabel} instance`}
        >
          <ChevronLeft className='size-3.5' />
        </Button>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-6'
          onClick={args.onNext}
          disabled={args.activeInstanceIndex >= args.instances.length - 1}
          aria-label={`Next ${args.fieldLabel} instance`}
        >
          <ChevronRight className='size-3.5' />
        </Button>
      </div>
    </div>
  );
}

function assertNever(component: never): never {
  throw new Error(`Unhandled viewer component "${component}".`);
}
