import { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PropertyRow } from '../shared';
import { ModelSelector } from './model-selector';
import { NestedModelSelector } from './nested-model-selector';
import { getNestedModelSelection } from './stt-helpers';
import { getEditorComponent } from './config-editors';
import type {
  AvailableModelOption,
  ConfigFieldVariantDescriptor,
  ConfigFieldDescriptor,
  ModelSelectionValue,
  NestedModelConfigSchema,
  SdkPreviewField,
} from '@/types/blueprint-graph';

const VIRTUAL_UNION_OPTION_VALUE = '__renku_union_virtual_custom__';

interface ConfigPropertiesEditorProps {
  fields?: ConfigFieldDescriptor[];
  values: Record<string, unknown>;
  isEditable: boolean;
  onChange: (key: string, value: unknown) => void;
  schemaError?: string | null;
  producerId?: string;
  availableModels?: AvailableModelOption[];
  currentModelSelection?: ModelSelectionValue;
  isComposition?: boolean;
  onModelChange?: (selection: ModelSelectionValue) => void;
  nestedModelSchemas?: NestedModelConfigSchema[];
  onNestedModelChange?: (
    nestedSchema: NestedModelConfigSchema,
    provider: string,
    model: string
  ) => void;
  sdkPreview?: SdkPreviewField[];
}

export function ConfigPropertiesEditor({
  fields,
  values,
  isEditable,
  onChange,
  schemaError,
  producerId,
  availableModels,
  currentModelSelection,
  isComposition = false,
  onModelChange,
  nestedModelSchemas,
  onNestedModelChange,
  sdkPreview = [],
}: ConfigPropertiesEditorProps) {
  const effectiveFields = useMemo(() => fields ?? [], [fields]);
  const renderableFields = useMemo(
    () =>
      effectiveFields.filter(
        (field) =>
          field.mappingSource !== 'artifact' && field.mappingSource !== 'mixed'
      ),
    [effectiveFields]
  );
  const mappedFields = useMemo(
    () => renderableFields.filter((field) => field.mappingSource === 'input'),
    [renderableFields]
  );
  const unmappedFields = useMemo(
    () => renderableFields.filter((field) => field.mappingSource !== 'input'),
    [renderableFields]
  );

  const showModelSelection =
    producerId && availableModels && onModelChange && !isComposition;

  const sdkPreviewByField = useMemo(() => {
    const map = new Map<string, SdkPreviewField>();
    for (const field of sdkPreview) {
      map.set(field.field, field);
    }
    return map;
  }, [sdkPreview]);

  if (schemaError) {
    if (showModelSelection) {
      return (
        <div className='space-y-4'>
          <PropertyRow name='Model' type='select' required>
            <ModelSelector
              producerId={producerId}
              availableModels={availableModels}
              currentSelection={currentModelSelection}
              isEditable={isEditable}
              onChange={onModelChange}
            />
          </PropertyRow>

          <div className='flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm'>
            <AlertCircle className='size-4 shrink-0 mt-0.5' />
            <div>
              <p className='font-medium'>Failed to load config schema</p>
              <p className='text-xs mt-1 text-destructive/80'>{schemaError}</p>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className='flex items-start gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm'>
        <AlertCircle className='size-4 shrink-0 mt-0.5' />
        <div>
          <p className='font-medium'>Failed to load config schema</p>
          <p className='text-xs mt-1 text-destructive/80'>{schemaError}</p>
        </div>
      </div>
    );
  }

  if (!showModelSelection && renderableFields.length === 0) {
    return null;
  }

  return (
    <div className='space-y-4'>
      {showModelSelection && (
        <PropertyRow name='Model' type='select' required>
          <ModelSelector
            producerId={producerId}
            availableModels={availableModels}
            currentSelection={currentModelSelection}
            isEditable={isEditable}
            onChange={onModelChange}
          />
        </PropertyRow>
      )}

      {nestedModelSchemas &&
        nestedModelSchemas.length > 0 &&
        onNestedModelChange &&
        nestedModelSchemas.map((nestedSchema) => {
          const nestedSel = getNestedModelSelection(
            currentModelSelection,
            nestedSchema.declaration.configPath
          );
          return (
            <PropertyRow
              key={nestedSchema.declaration.name}
              name={
                nestedSchema.declaration.description ??
                nestedSchema.declaration.name
              }
              type='select'
              required={nestedSchema.declaration.required}
            >
              <NestedModelSelector
                nestedSchema={nestedSchema}
                currentProvider={nestedSel?.provider}
                currentModel={nestedSel?.model}
                isEditable={isEditable}
                onChange={(provider, model) =>
                  onNestedModelChange(nestedSchema, provider, model)
                }
              />
            </PropertyRow>
          );
        })}

      {mappedFields.length > 0 && (
        <section className='max-w-[43rem] space-y-3 rounded-xl border border-[color:var(--models-pane-mapped-border)] bg-[color:var(--models-pane-mapped-bg)] p-3'>
          <header className='px-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
            Connected Inputs
          </header>
          <FieldCollection
            fields={mappedFields}
            values={values}
            isEditable={isEditable}
            onChange={onChange}
            sdkPreviewByField={sdkPreviewByField}
          />
        </section>
      )}

      {unmappedFields.length > 0 && (
        <FieldCollection
          fields={unmappedFields}
          values={values}
          isEditable={isEditable}
          onChange={onChange}
          sdkPreviewByField={sdkPreviewByField}
        />
      )}
    </div>
  );
}

interface FieldCollectionProps {
  fields: ConfigFieldDescriptor[];
  values: Record<string, unknown>;
  isEditable: boolean;
  onChange: (key: string, value: unknown) => void;
  sdkPreviewByField: Map<string, SdkPreviewField>;
}

function FieldCollection({
  fields,
  values,
  isEditable,
  onChange,
  sdkPreviewByField,
}: FieldCollectionProps) {
  const rows: React.ReactNode[] = [];
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

interface ConfigFieldRendererProps {
  field: ConfigFieldDescriptor;
  values: Record<string, unknown>;
  isEditable: boolean;
  onChange: (key: string, value: unknown) => void;
  sdkPreviewByField: Map<string, SdkPreviewField>;
}

function ConfigFieldRenderer({
  field,
  values,
  isEditable,
  onChange,
  sdkPreviewByField,
}: ConfigFieldRendererProps) {
  if (field.mappingSource === 'artifact' || field.mappingSource === 'mixed') {
    return null;
  }

  if (field.component === 'object') {
    const leafKey = getLeafKey(field.keyPath);
    const Editor = getEditorComponent(leafKey);
    if (Editor) {
      const explicit = getPathValue(values, field.keyPath);
      return (
        <Editor
          value={explicit}
          schema={field.schema}
          isEditable={isEditable}
          onChange={(value) => onChange(field.keyPath, value)}
        />
      );
    }

    return (
      <div className='space-y-4'>
        {field.fields?.map((child) => (
          <ConfigFieldRenderer
            key={child.keyPath}
            field={child}
            values={values}
            isEditable={isEditable}
            onChange={onChange}
            sdkPreviewByField={sdkPreviewByField}
          />
        ))}
      </div>
    );
  }

  if (field.component === 'placeholder-to-be-annotated') {
    return (
      <PropertyRow
        name={field.label}
        description='This field needs a custom annotation before it can be edited.'
      >
        <span className='text-xs text-muted-foreground'>Unavailable</span>
      </PropertyRow>
    );
  }

  const preview = sdkPreviewByField.get(field.keyPath);
  const explicit = getPathValue(values, field.keyPath);
  const hasExplicit = hasPath(values, field.keyPath);
  const mappedValue =
    field.mappingSource === 'input' ? preview?.value : undefined;
  const schemaDefault = field.schema?.default;
  const effectiveValue = hasExplicit
    ? explicit
    : mappedValue !== undefined
      ? mappedValue
      : schemaDefault;

  const canResetMappedOverride =
    isEditable && field.mappingSource === 'input' && hasExplicit;

  const statusMessages = preview
    ? [...preview.errors, ...preview.warnings].join(' ')
    : undefined;

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

  if (field.component === 'nullable' && field.value) {
    const isNull = effectiveValue === null;
    return (
      <PropertyRow
        name={rowName}
        type='nullable'
        description={statusMessages || field.description}
        required={field.required}
      >
        <div className='space-y-2'>
          <div className='flex items-center gap-2'>
            <Switch
              checked={isNull}
              onCheckedChange={(checked) =>
                onChange(field.keyPath, checked ? null : undefined)
              }
              disabled={!isEditable}
              size='sm'
            />
            <span className='text-xs text-muted-foreground'>Set null</span>
            {canResetMappedOverride && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                className='h-6 px-2 text-xs'
                onClick={() => onChange(field.keyPath, undefined)}
              >
                Reset
              </Button>
            )}
          </div>
          {!isNull && (
            <ScalarControl
              field={field.value}
              value={effectiveValue}
              isEditable={isEditable}
              onChange={(value) => onChange(field.keyPath, value)}
            />
          )}
        </div>
      </PropertyRow>
    );
  }

  if (
    field.component === 'union' &&
    field.variants &&
    field.variants.length > 0
  ) {
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
        const enumOptions = (enumVariant.schema?.enum ?? []).map((option) =>
          String(option)
        );

        const customSelection = field.unionEditor.customSelection;
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
          isDimensionObject(effectiveValue) ||
          effectiveValue === customOptionValue;

        const selectedOption = isDimensionObject(effectiveValue)
          ? customOptionValue
          : typeof effectiveValue === 'string'
            ? effectiveValue
            : undefined;

        return (
          <PropertyRow
            name={rowName}
            type='union'
            description={statusMessages || field.description}
            required={field.required}
          >
            <div className='space-y-2'>
              <div className='flex flex-wrap items-center gap-2'>
                <Select
                  value={selectedOption}
                  onValueChange={(next) => {
                    if (next === customOptionValue) {
                      onChange(field.keyPath, customValue);
                      return;
                    }
                    onChange(field.keyPath, next);
                  }}
                  disabled={!isEditable}
                >
                  <SelectTrigger
                    aria-label={`${field.label} option`}
                    className='h-7 w-[180px] text-xs'
                  >
                    <SelectValue placeholder='Select...' />
                  </SelectTrigger>
                  <SelectContent>
                    {enumOptions.map((option) => (
                      <SelectItem
                        key={option}
                        value={option}
                        className='text-xs'
                      >
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
                        onChange(field.keyPath, {
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
                        onChange(field.keyPath, {
                          ...customValue,
                          height: Math.max(1, Math.round(next)),
                        });
                      }}
                      className='h-7 w-[84px] text-xs'
                    />
                  </>
                )}
              </div>

              {canResetMappedOverride && (
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='h-6 px-2 text-xs'
                  onClick={() => onChange(field.keyPath, undefined)}
                >
                  Reset
                </Button>
              )}
            </div>
          </PropertyRow>
        );
      }
    }

    const activeVariant = pickVariant(field.variants, effectiveValue);

    return (
      <PropertyRow
        name={rowName}
        type='union'
        description={statusMessages || field.description}
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
              onChange(
                field.keyPath,
                getDefaultValueForComponent(variant.component)
              );
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
                  value={
                    typeof effectiveValue === 'object' &&
                    effectiveValue !== null
                      ? (effectiveValue as Record<string, unknown>)[
                          getLeafKey(variantField.keyPath)
                        ]
                      : undefined
                  }
                  isEditable={isEditable}
                  onChange={(value) => {
                    const leaf = getLeafKey(variantField.keyPath);
                    const next =
                      typeof effectiveValue === 'object' &&
                      effectiveValue !== null &&
                      !Array.isArray(effectiveValue)
                        ? { ...(effectiveValue as Record<string, unknown>) }
                        : {};
                    next[leaf] = value;
                    onChange(field.keyPath, next);
                  }}
                />
              ))}
            </div>
          ) : (
            <ScalarControl
              field={activeVariant}
              value={effectiveValue}
              isEditable={isEditable}
              onChange={(value) => onChange(field.keyPath, value)}
            />
          )}

          {canResetMappedOverride && (
            <Button
              type='button'
              variant='ghost'
              size='sm'
              className='h-6 px-2 text-xs'
              onClick={() => onChange(field.keyPath, undefined)}
            >
              Reset
            </Button>
          )}
        </div>
      </PropertyRow>
    );
  }

  return (
    <PropertyRow
      name={rowName}
      type={field.component}
      description={statusMessages || field.description}
      required={field.required}
    >
      <div className='space-y-2'>
        <ScalarControl
          field={field}
          value={effectiveValue}
          isEditable={isEditable}
          onChange={(value) => onChange(field.keyPath, value)}
        />
        {canResetMappedOverride && (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            className='h-6 px-2 text-xs'
            onClick={() => onChange(field.keyPath, undefined)}
          >
            Reset
          </Button>
        )}
      </div>
    </PropertyRow>
  );
}

function ScalarControl(args: {
  field: ConfigFieldDescriptor;
  value: unknown;
  isEditable: boolean;
  onChange: (value: unknown) => void;
}) {
  const { field, value, isEditable, onChange } = args;

  if (field.component === 'boolean') {
    return (
      <div className='flex justify-start'>
        <Switch
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked)}
          disabled={!isEditable}
          size='sm'
        />
      </div>
    );
  }

  if (field.component === 'string-enum' && field.schema?.enum) {
    if (!isEditable) {
      return <ReadOnlyValue value={value} />;
    }
    return (
      <Select
        value={value === undefined ? '' : String(value)}
        onValueChange={(next) => onChange(next)}
      >
        <SelectTrigger className='h-7 text-xs'>
          <SelectValue placeholder='Select...' />
        </SelectTrigger>
        <SelectContent>
          {(field.schema.enum as unknown[]).map((option) => (
            <SelectItem
              key={String(option)}
              value={String(option)}
              className='text-xs'
            >
              {String(option)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.component === 'number' || field.component === 'integer') {
    if (!isEditable) {
      return <ReadOnlyValue value={value} />;
    }
    return (
      <Input
        type='number'
        value={typeof value === 'number' ? value : ''}
        min={field.schema?.minimum}
        max={field.schema?.maximum}
        step={field.component === 'integer' ? 1 : 0.1}
        onChange={(event) => {
          const next = event.target.value;
          if (next === '') {
            onChange(undefined);
            return;
          }
          const parsed = Number(next);
          onChange(Number.isFinite(parsed) ? parsed : undefined);
        }}
        className='h-7 text-xs'
      />
    );
  }

  if (
    field.component === 'array-scalar' ||
    field.component === 'array-file-uri'
  ) {
    if (!isEditable) {
      return <ReadOnlyValue value={value} />;
    }
    const serialized = Array.isArray(value)
      ? value.map((item) => String(item)).join('\n')
      : '';
    return (
      <Textarea
        value={serialized}
        onChange={(event) => {
          const next = event.target.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
          onChange(next.length > 0 ? next : undefined);
        }}
        className='text-xs min-h-24'
      />
    );
  }

  if (!isEditable) {
    return <ReadOnlyValue value={value} />;
  }

  return (
    <Input
      type='text'
      value={typeof value === 'string' ? value : ''}
      onChange={(event) => onChange(event.target.value || undefined)}
      className='h-7 text-xs'
    />
  );
}

function ReadOnlyValue({ value }: { value: unknown }) {
  const text =
    value === undefined
      ? '—'
      : Array.isArray(value) || (value && typeof value === 'object')
        ? JSON.stringify(value)
        : String(value);
  return <span className='text-muted-foreground text-right block'>{text}</span>;
}

function pickVariant(
  variants: ConfigFieldVariantDescriptor[],
  value: unknown
): ConfigFieldVariantDescriptor {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return (
      variants.find((variant) => variant.component === 'object') ?? variants[0]
    );
  }

  if (typeof value === 'string') {
    return (
      variants.find((variant) => variant.component === 'string-enum') ??
      variants.find((variant) => variant.component === 'string') ??
      variants[0]
    );
  }

  return variants[0];
}

function getDefaultValueForComponent(
  component: ConfigFieldDescriptor['component']
): unknown {
  if (component === 'object') {
    return {};
  }
  if (component === 'array-file-uri' || component === 'array-scalar') {
    return [];
  }
  if (component === 'boolean') {
    return false;
  }
  return undefined;
}

function getPathValue(values: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = values;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function hasPath(values: Record<string, unknown>, path: string): boolean {
  const parts = path.split('.');
  let current: unknown = values;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return false;
    }
    if (!(part in (current as Record<string, unknown>))) {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return true;
}

function getLeafKey(path: string): string {
  const segments = path.split('.');
  return segments[segments.length - 1] ?? path;
}

function isInlineCardField(field: ConfigFieldDescriptor): boolean {
  if (field.component !== 'object') {
    return false;
  }

  const leafKey = getLeafKey(field.keyPath);
  return getEditorComponent(leafKey) !== null;
}

function isDimensionObject(
  value: unknown
): value is { width: number; height: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.width === 'number' &&
    Number.isFinite(candidate.width) &&
    typeof candidate.height === 'number' &&
    Number.isFinite(candidate.height)
  );
}

function isDimensionsObjectVariant(
  variant: ConfigFieldVariantDescriptor
): boolean {
  if (variant.component !== 'object' || !variant.fields) {
    return false;
  }

  let hasWidth = false;
  let hasHeight = false;

  for (const field of variant.fields) {
    const leaf = getLeafKey(field.keyPath);
    if (
      leaf === 'width' &&
      (field.component === 'integer' || field.component === 'number')
    ) {
      hasWidth = true;
    }

    if (
      leaf === 'height' &&
      (field.component === 'integer' || field.component === 'number')
    ) {
      hasHeight = true;
    }
  }

  return hasWidth && hasHeight;
}

function getDefaultDimensionsValue(variant: ConfigFieldVariantDescriptor): {
  width: number;
  height: number;
} {
  const widthField = variant.fields?.find(
    (field) => getLeafKey(field.keyPath) === 'width'
  );
  const heightField = variant.fields?.find(
    (field) => getLeafKey(field.keyPath) === 'height'
  );

  const width = resolveDimensionInitialValue(widthField);
  const height = resolveDimensionInitialValue(heightField);

  if (width === undefined || height === undefined) {
    throw new Error(
      `Union field "${variant.keyPath}" is missing schema defaults/minimums for custom dimensions.`
    );
  }

  return {
    width,
    height,
  };
}

function resolveDimensionInitialValue(
  field: ConfigFieldDescriptor | undefined
): number | undefined {
  if (!field) {
    return undefined;
  }

  const schemaDefault = field.schema?.default;
  if (typeof schemaDefault === 'number' && Number.isFinite(schemaDefault)) {
    return Math.max(1, Math.round(schemaDefault));
  }

  const minimum = field.schema?.minimum;
  if (typeof minimum === 'number' && Number.isFinite(minimum)) {
    return Math.max(1, Math.round(minimum));
  }

  return undefined;
}
