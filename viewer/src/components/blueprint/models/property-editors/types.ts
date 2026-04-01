import type {
  ConfigFieldDescriptor,
  SdkPreviewField,
} from '@/types/blueprint-graph';
import type { ReactNode } from 'react';

interface FieldRendererSharedProps {
  values: Record<string, unknown>;
  isEditable: boolean;
  onChange: (key: string, value: unknown) => void;
  sdkPreviewByField: Map<string, SdkPreviewField>;
}

export interface FieldCollectionProps extends FieldRendererSharedProps {
  fields: ConfigFieldDescriptor[];
}

export interface ConfigFieldRendererProps extends FieldRendererSharedProps {
  field: ConfigFieldDescriptor;
}

export interface ScalarEditorProps {
  field: ConfigFieldDescriptor;
  value: unknown;
  isEditable: boolean;
  readOnlyMode?: 'none' | 'dynamic-connected';
  onChange: (value: unknown) => void;
}

export interface CustomFieldEditorProps {
  field: ConfigFieldDescriptor;
  rowName: ReactNode;
  description?: string;
  effectiveValue: unknown;
  isEditable: boolean;
  canResetMappedOverride: boolean;
  onChange: (value: unknown) => void;
  onReset: () => void;
}
