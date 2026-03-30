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

  return <div className='space-y-4'>{field.fields?.map(renderField)}</div>;
}
