import { ArrayFileUriEditor } from './array-file-uri-editor';
import { ArrayScalarEditor } from './array-scalar-editor';
import { BooleanEditor } from './boolean-editor';
import { FileUriEditor } from './file-uri-editor';
import { IntegerEditor } from './integer-editor';
import { NumberEditor } from './number-editor';
import { StringEditor } from './string-editor';
import { StringEnumEditor } from './string-enum-editor';
import type { ScalarEditorProps } from './types';

export function ScalarControl(props: ScalarEditorProps) {
  switch (props.field.component) {
    case 'boolean':
      return <BooleanEditor {...props} />;
    case 'string':
      return <StringEditor {...props} />;
    case 'file-uri':
      return <FileUriEditor {...props} />;
    case 'string-enum':
      return <StringEnumEditor {...props} />;
    case 'number':
      return <NumberEditor {...props} />;
    case 'integer':
      return <IntegerEditor {...props} />;
    case 'array-scalar':
      return <ArrayScalarEditor {...props} />;
    case 'array-file-uri':
      return <ArrayFileUriEditor {...props} />;
    default:
      throw new Error(
        `ScalarControl does not support component "${props.field.component}" for field "${props.field.keyPath}".`
      );
  }
}
