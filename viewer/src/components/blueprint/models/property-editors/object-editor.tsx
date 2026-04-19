import type { ReactNode } from 'react';
import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import {
  SubtitlesCard,
  type SubtitlesCardProps,
} from '../config-editors/subtitles-card';
import { TextCard, type TextCardProps } from '../config-editors/text-card';
import {
  TimelineCard,
  type TimelineCardProps,
} from '../config-editors/timeline-card';
import { isInlineCardField } from './inline-card-utils';
import { getLeafKey, getPathValue } from './path-utils';

interface ObjectEditorProps {
  field: ConfigFieldDescriptor;
  values: Record<string, unknown>;
  isEditable: boolean;
  onChange: (key: string, value: unknown) => void;
  renderField: (field: ConfigFieldDescriptor) => ReactNode;
}

export function ObjectEditor({
  field,
  values,
  isEditable,
  onChange,
  renderField,
}: ObjectEditorProps) {
  const leafKey = getLeafKey(field.keyPath);
  const explicit = getPathValue(values, field.keyPath);

  if (leafKey === 'subtitles') {
    return (
      <SubtitlesCard
        value={explicit as SubtitlesCardProps['value']}
        schema={field.schema}
        isEditable={isEditable}
        onChange={(value) => onChange(field.keyPath, value)}
      />
    );
  }

  if (leafKey === 'timeline') {
    return (
      <TimelineCard
        value={explicit as TimelineCardProps['value']}
        schema={field.schema}
        isEditable={isEditable}
        onChange={(value) => onChange(field.keyPath, value)}
      />
    );
  }

  if (leafKey === 'text') {
    return (
      <TextCard
        value={explicit as TextCardProps['value']}
        schema={field.schema}
        isEditable={isEditable}
        onChange={(value) => onChange(field.keyPath, value)}
      />
    );
  }

  const directChildren = field.fields ?? [];
  const flattenedChildren = flattenNestedObjectChildren(directChildren);

  if (flattenedChildren.length === 0) {
    return null;
  }

  const shouldGroupChildren =
    directChildren.length > 1 && flattenedChildren.length > 1;

  if (!shouldGroupChildren) {
    return (
      <div className='space-y-4'>{flattenedChildren.map(renderField)}</div>
    );
  }

  return (
    <section className='w-full max-w-2xl rounded-xl border border-(--models-pane-object-group-border) bg-(--models-pane-object-group-bg) px-3 py-3 md:-ml-3 md:max-w-174'>
      <header className='px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground'>
        {field.label}
      </header>
      <div className='space-y-4'>{flattenedChildren.map(renderField)}</div>
    </section>
  );
}

function flattenNestedObjectChildren(
  fields: ConfigFieldDescriptor[]
): ConfigFieldDescriptor[] {
  const flattened: ConfigFieldDescriptor[] = [];

  for (const childField of fields) {
    if (
      childField.component === 'object' &&
      !childField.custom &&
      !isInlineCardField(childField) &&
      childField.fields
    ) {
      flattened.push(...flattenNestedObjectChildren(childField.fields));
      continue;
    }

    flattened.push(childField);
  }

  return flattened;
}
