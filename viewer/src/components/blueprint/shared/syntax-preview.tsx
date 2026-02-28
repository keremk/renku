/**
 * Lightweight read-only syntax-highlighted preview for card content areas.
 * Uses the same prism-react-editor and Renku theme as TextEditorDialog.
 */

import { Editor } from 'prism-react-editor';
import { BasicSetup } from 'prism-react-editor/setups';

// Language grammars
import 'prism-react-editor/prism/languages/json';
import 'prism-react-editor/prism/languages/markdown';

// Required CSS
import 'prism-react-editor/layout.css';

// Renku editor theme (warm amber palette)
import '@/styles/prism-renku-dark.css';
import '@/styles/prism-renku-light.css';

import { cn } from '@/lib/utils';
import { useDarkMode } from '@/hooks/use-dark-mode';

export interface SyntaxPreviewProps {
  /** Text content to display */
  content: string;
  /** Language for syntax highlighting */
  language: 'json' | 'markdown';
  /** Additional CSS classes for the container */
  className?: string;
}

export function SyntaxPreview({
  content,
  language,
  className,
}: SyntaxPreviewProps) {
  const isDark = useDarkMode();

  return (
    <div
      className={cn(
        'overflow-hidden',
        isDark ? 'prism-dark' : 'prism-light',
        className
      )}
    >
      <Editor
        language={language}
        value={content}
        readOnly
        wordWrap={true}
        lineNumbers={false}
        style={{
          fontSize: '12px',
          background: 'transparent',
        }}
      >
        <BasicSetup />
      </Editor>
    </div>
  );
}
