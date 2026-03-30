import type { ConfigFieldDescriptor } from '@/types/blueprint-graph';
import { getLeafKey } from './path-utils';

const INLINE_CARD_EDITOR_KEYS = new Set(['subtitles', 'timeline', 'text']);

export function isInlineCardField(field: ConfigFieldDescriptor): boolean {
  if (field.component !== 'object') {
    return false;
  }

  return INLINE_CARD_EDITOR_KEYS.has(getLeafKey(field.keyPath));
}
