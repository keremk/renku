import type { ReactNode } from 'react';
import type {
  ConfigFieldDescriptor,
  ConfigFieldVariantDescriptor,
} from '@/types/blueprint-graph';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PropertyRow } from '../../shared';
import {
  getDefaultDimensionsValue,
  getDefaultValueForComponent,
  isDimensionObject,
  isDimensionsObjectVariant,
  pickVariant,
} from './field-value-utils';
import { getLeafKey } from './path-utils';
import { ResetOverrideButton } from './reset-override-button';
import { ScalarControl } from './scalar-control';

const VIRTUAL_UNION_OPTION_VALUE = '__renku_union_virtual_custom__';

interface UnionEditorProps {
  field: ConfigFieldDescriptor;
  rowName: ReactNode;
  description?: string;
  effectiveValue: unknown;
  isEditable: boolean;
  readOnlyMode?: 'none' | 'dynamic-connected';
  canResetMappedOverride: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
}

export function UnionEditor({
  field,
  rowName,
  description,
  effectiveValue,
  isEditable,
  readOnlyMode = 'none',
  canResetMappedOverride,
  onChange,
  onReset,
}: UnionEditorProps) {
  if (!field.variants || field.variants.length === 0) {
    throw new Error(`Union field "${field.keyPath}" is missing variants.`);
  }

  if (
    field.presentation === 'enum-or-dimensions' &&
    field.unionEditor?.type === 'enum-dimensions'
  ) {
    const enumVariant = field.variants.find(
      (variant) => variant.id === field.unionEditor?.enumVariantId
    );
    const customVariant = field.variants.find(
      (variant) => variant.id === field.unionEditor?.customVariantId
    );

    if (
      enumVariant?.component === 'string-enum' &&
      customVariant &&
      isDimensionsObjectVariant(customVariant)
    ) {
      return (
        <EnumOrDimensionsEditor
          field={field}
          enumVariant={enumVariant}
          customVariant={customVariant}
          rowName={rowName}
          description={description}
          effectiveValue={effectiveValue}
          isEditable={isEditable}
          canResetMappedOverride={canResetMappedOverride}
          onChange={onChange}
          onReset={onReset}
        />
      );
    }
  }

  const activeVariant = pickVariant(field.variants, effectiveValue);

  return (
    <PropertyRow
      name={rowName}
      type='union'
      description={description}
      required={field.required}
    >
      <div className='space-y-2'>
        <Select
          value={activeVariant.id}
          onValueChange={(nextVariantId) => {
            const variant = field.variants?.find(
              (item) => item.id === nextVariantId
            );
            if (!variant) {
              return;
            }
            onChange(getDefaultValueForComponent(variant.component));
          }}
          disabled={!isEditable}
        >
          <SelectTrigger
            aria-label={`${field.label} option`}
            className='h-7 text-xs'
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {field.variants.map((variant) => (
              <SelectItem
                key={variant.id}
                value={variant.id}
                className='text-xs'
              >
                {variant.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {activeVariant.component === 'object' && activeVariant.fields ? (
          <div className='space-y-2 border border-border/60 rounded-md p-2'>
            {activeVariant.fields.map((variantField) => (
              <ScalarControl
                key={`${activeVariant.id}:${variantField.keyPath}`}
                field={variantField}
                value={getObjectVariantFieldValue(effectiveValue, variantField)}
                isEditable={isEditable}
                readOnlyMode={readOnlyMode}
                onChange={(value) =>
                  onChange(
                    buildNextObjectVariantValue(
                      effectiveValue,
                      variantField,
                      value
                    )
                  )
                }
              />
            ))}
          </div>
        ) : (
          <ScalarControl
            field={activeVariant}
            value={effectiveValue}
            isEditable={isEditable}
            readOnlyMode={readOnlyMode}
            onChange={onChange}
          />
        )}

        {canResetMappedOverride && <ResetOverrideButton onReset={onReset} />}
      </div>
    </PropertyRow>
  );
}

interface EnumOrDimensionsEditorProps {
  field: ConfigFieldDescriptor;
  enumVariant: ConfigFieldVariantDescriptor;
  customVariant: ConfigFieldVariantDescriptor;
  rowName: ReactNode;
  description?: string;
  effectiveValue: unknown;
  isEditable: boolean;
  canResetMappedOverride: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
}

function EnumOrDimensionsEditor({
  field,
  enumVariant,
  customVariant,
  rowName,
  description,
  effectiveValue,
  isEditable,
  canResetMappedOverride,
  onChange,
  onReset,
}: EnumOrDimensionsEditorProps) {
  const enumOptions = (enumVariant.schema?.enum ?? []).map((option) =>
    String(option)
  );

  const customSelection = field.unionEditor?.customSelection;
  if (!customSelection) {
    throw new Error(
      `Union field "${field.keyPath}" is missing unionEditor.customSelection.`
    );
  }

  const customOptionValue =
    customSelection.source === 'enum-value'
      ? customSelection.value
      : VIRTUAL_UNION_OPTION_VALUE;
  const customOptionLabel =
    customSelection.source === 'virtual-option'
      ? customSelection.label || customVariant.label
      : customOptionValue;

  const customValue = isDimensionObject(effectiveValue)
    ? effectiveValue
    : getDefaultDimensionsValue(customVariant);

  const isCustomActive =
    isDimensionObject(effectiveValue) || effectiveValue === customOptionValue;

  const selectedOption = isDimensionObject(effectiveValue)
    ? customOptionValue
    : typeof effectiveValue === 'string'
      ? effectiveValue
      : undefined;

  return (
    <PropertyRow
      name={rowName}
      type='union'
      description={description}
      required={field.required}
    >
      <div className='space-y-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <Select
            value={selectedOption}
            onValueChange={(next) => {
              if (next === customOptionValue) {
                onChange(customValue);
                return;
              }
              onChange(next);
            }}
            disabled={!isEditable}
          >
            <SelectTrigger
              aria-label={`${field.label} option`}
              className='h-7 w-[120px] text-xs'
            >
              <SelectValue placeholder='Select...' />
            </SelectTrigger>
            <SelectContent>
              {enumOptions.map((option) => (
                <SelectItem key={option} value={option} className='text-xs'>
                  {option}
                </SelectItem>
              ))}
              {customSelection.source === 'virtual-option' && (
                <SelectItem
                  value={VIRTUAL_UNION_OPTION_VALUE}
                  className='text-xs'
                >
                  {customOptionLabel}
                </SelectItem>
              )}
            </SelectContent>
          </Select>

          {isCustomActive && (
            <>
              <Input
                aria-label={`${field.label} width`}
                type='number'
                value={customValue.width}
                min={1}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  onChange({
                    ...customValue,
                    width: Math.max(1, Math.round(next)),
                  });
                }}
                className='h-7 w-[84px] text-xs'
              />
              <span className='text-muted-foreground text-xs'>x</span>
              <Input
                aria-label={`${field.label} height`}
                type='number'
                value={customValue.height}
                min={1}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (!Number.isFinite(next)) {
                    return;
                  }
                  onChange({
                    ...customValue,
                    height: Math.max(1, Math.round(next)),
                  });
                }}
                className='h-7 w-[84px] text-xs'
              />
            </>
          )}
        </div>

        {canResetMappedOverride && <ResetOverrideButton onReset={onReset} />}
      </div>
    </PropertyRow>
  );
}

function getObjectVariantFieldValue(
  effectiveValue: unknown,
  variantField: ConfigFieldDescriptor
): unknown {
  if (
    !effectiveValue ||
    typeof effectiveValue !== 'object' ||
    Array.isArray(effectiveValue)
  ) {
    return undefined;
  }
  const leaf = getLeafKey(variantField.keyPath);
  return (effectiveValue as Record<string, unknown>)[leaf];
}

function buildNextObjectVariantValue(
  effectiveValue: unknown,
  variantField: ConfigFieldDescriptor,
  value: unknown
): Record<string, unknown> {
  const leaf = getLeafKey(variantField.keyPath);
  const next =
    typeof effectiveValue === 'object' &&
    effectiveValue !== null &&
    !Array.isArray(effectiveValue)
      ? { ...(effectiveValue as Record<string, unknown>) }
      : {};
  next[leaf] = value;
  return next;
}
