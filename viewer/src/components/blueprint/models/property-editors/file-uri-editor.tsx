import { FileUriValueControl } from './file-uri-value-control';
import type { ScalarEditorProps } from './types';

export function FileUriEditor({
  field,
  value,
  isEditable,
  readOnlyMode = 'none',
  onChange,
}: ScalarEditorProps) {
  if (field.component !== 'file-uri') {
    throw new Error(
      `FileUriEditor requires file-uri component for field "${field.keyPath}", received "${field.component}".`
    );
  }

  return (
    <FileUriValueControl
      field={field}
      value={value}
      isEditable={isEditable}
      showActionControls={readOnlyMode !== 'dynamic-connected'}
      onChange={onChange}
      onRemove={() => onChange(undefined)}
      removeLabel='Remove file'
    />
  );
}
