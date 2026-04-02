import { ArrayObjectTableEditor } from './array-object-table';
import { ColorPickerEditor } from './color-picker';
import { VoiceIdEditor } from './voice-id-editor';
import { parseVoiceIdCustomConfig } from './voice-id-config';
import { PropertyRow } from '../../shared';
import { ResetOverrideButton } from './reset-override-button';
import { getLeafKey } from './path-utils';
import type { ReactElement } from 'react';
import type { CustomFieldEditorProps } from './types';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';

interface CustomRendererDefinition {
  render: (props: CustomFieldEditorProps) => ReactElement;
  validate: (field: ConfigFieldDescriptor) => string | undefined;
}

const CUSTOM_RENDERER_REGISTRY: Record<string, CustomRendererDefinition> = {
  'color-picker': {
    render: (props) => <ColorPickerEditor {...props} />,
    validate: validateColorPickerField,
  },
  'array-object-table': {
    render: (props) => <ArrayObjectTableEditor {...props} />,
    validate: validateArrayObjectTableField,
  },
  'voice-id-selector': {
    render: (props) => <VoiceIdEditor {...props} />,
    validate: validateVoiceIdField,
  },
};

export function CustomFieldRenderer(props: CustomFieldEditorProps) {
  const customName =
    typeof props.field.custom === 'string' ? props.field.custom.trim() : '';

  if (customName.length === 0) {
    return (
      <UnsupportedCustomRenderer
        {...props}
        customName='<missing>'
        reason='Custom renderer name is missing from this field annotation.'
      />
    );
  }

  const definition = CUSTOM_RENDERER_REGISTRY[customName];
  if (!definition) {
    return (
      <UnsupportedCustomRenderer
        {...props}
        customName={customName}
        reason='No renderer implementation is registered yet.'
      />
    );
  }

  const compatibilityIssue = definition.validate(props.field);
  if (compatibilityIssue) {
    return (
      <UnsupportedCustomRenderer
        {...props}
        customName={customName}
        reason={compatibilityIssue}
      />
    );
  }

  return definition.render(props);
}

function UnsupportedCustomRenderer(
  props: CustomFieldEditorProps & {
    customName: string;
    reason: string;
  }
) {
  return (
    <PropertyRow
      name={props.rowName}
      type={props.field.component}
      description={props.description}
      required={props.field.required}
    >
      <div className='space-y-2'>
        <div
          role='note'
          className='rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground'
        >
          <p className='font-medium text-foreground'>
            Custom renderer "{props.customName}" is not implemented.
          </p>
          <p className='mt-1'>{props.reason}</p>
        </div>
        {props.canResetMappedOverride && (
          <ResetOverrideButton onReset={props.onReset} />
        )}
      </div>
    </PropertyRow>
  );
}

function validateColorPickerField(
  field: ConfigFieldDescriptor
): string | undefined {
  if (field.component !== 'object') {
    return `Expected object component, received "${field.component}".`;
  }

  if (!Array.isArray(field.fields) || field.fields.length === 0) {
    return 'Expected object fields with numeric r/g/b channels.';
  }

  const channelByLeaf = new Map<string, ConfigFieldDescriptor>();
  for (const childField of field.fields) {
    channelByLeaf.set(getLeafKey(childField.keyPath).toLowerCase(), childField);
  }

  const r = channelByLeaf.get('r');
  const g = channelByLeaf.get('g');
  const b = channelByLeaf.get('b');

  if (!r || !g || !b) {
    return 'Expected object fields with numeric r/g/b channels.';
  }

  if (!isNumericComponent(r.component)) {
    return 'Expected numeric "r" channel (integer or number).';
  }
  if (!isNumericComponent(g.component)) {
    return 'Expected numeric "g" channel (integer or number).';
  }
  if (!isNumericComponent(b.component)) {
    return 'Expected numeric "b" channel (integer or number).';
  }

  return undefined;
}

function validateArrayObjectTableField(
  field: ConfigFieldDescriptor
): string | undefined {
  if (field.component !== 'array-object-cards') {
    return `Expected array-object-cards component, received "${field.component}".`;
  }

  if (!field.item || field.item.component !== 'object') {
    return 'Expected item descriptor with object component.';
  }

  const colorPickerCandidates: ConfigFieldDescriptor[] = [];

  if (field.item.custom === 'color-picker') {
    colorPickerCandidates.push(field.item);
  }

  if (Array.isArray(field.item.fields)) {
    for (const childField of field.item.fields) {
      if (childField.custom === 'color-picker') {
        colorPickerCandidates.push(childField);
      }
    }
  }

  for (const candidate of colorPickerCandidates) {
    const issue = validateColorPickerField(candidate);
    if (issue) {
      return `Invalid nested color-picker at "${candidate.keyPath}": ${issue}`;
    }
  }

  return undefined;
}

function validateVoiceIdField(
  field: ConfigFieldDescriptor
): string | undefined {
  if (field.component !== 'string' && field.component !== 'string-enum') {
    return `Expected string component, received "${field.component}".`;
  }

  try {
    parseVoiceIdCustomConfig(field);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  return undefined;
}

function isNumericComponent(
  component: ConfigFieldDescriptor['component']
): boolean {
  return component === 'integer' || component === 'number';
}
