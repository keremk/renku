import { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { PropertyRow } from '../shared';
import { ModelSelector } from './model-selector';
import { NestedModelSelector } from './nested-model-selector';
import { getNestedModelSelection } from './stt-helpers';
import { FieldCollection } from './property-editors';
import type {
  AvailableModelOption,
  ConfigFieldDescriptor,
  ModelSelectionValue,
  NestedModelConfigSchema,
  SdkPreviewField,
} from '@/types/blueprint-graph';

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

          <SchemaErrorAlert schemaError={schemaError} />
        </div>
      );
    }

    return <SchemaErrorAlert schemaError={schemaError} />;
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
        <section className='w-full max-w-2xl rounded-xl border border-[color:var(--models-pane-mapped-border)] bg-[color:var(--models-pane-mapped-bg)] px-3 py-3 md:-ml-3 md:max-w-[43.5rem]'>
          <header className='px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
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

function SchemaErrorAlert({ schemaError }: { schemaError: string }) {
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
