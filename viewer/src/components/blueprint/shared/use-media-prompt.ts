import { useEffect, useState } from 'react';

export interface MediaPromptState {
  promptText: string | null;
  promptError: string | null;
  isPromptLoading: boolean;
}

export function useMediaPrompt(
  promptUrl: string | undefined,
  enabled: boolean
): MediaPromptState {
  const [promptText, setPromptText] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [isPromptLoading, setIsPromptLoading] = useState(false);

  useEffect(() => {
    if (!enabled || !promptUrl) {
      setPromptText(null);
      setPromptError(null);
      setIsPromptLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    const loadPrompt = async () => {
      setIsPromptLoading(true);
      setPromptText(null);
      setPromptError(null);

      try {
        const response = await fetch(promptUrl, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Failed to load prompt (${response.status} ${response.statusText})`
          );
        }

        const text = await response.text();
        if (active) {
          setPromptText(text);
        }
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof DOMException && error.name === 'AbortError') {
          return;
        }

        const message =
          error instanceof Error ? error.message : 'Failed to load prompt';
        setPromptError(message);
      } finally {
        if (active) {
          setIsPromptLoading(false);
        }
      }
    };

    void loadPrompt();

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, promptUrl]);

  return {
    promptText,
    promptError,
    isPromptLoading,
  };
}
