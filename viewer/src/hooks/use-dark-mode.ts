/**
 * Hook to detect and subscribe to Tailwind's dark mode class changes.
 * Observes document.documentElement for class attribute changes.
 */

import { useSyncExternalStore } from 'react';

type DarkModeListener = () => void;

const listeners = new Set<DarkModeListener>();
let observer: MutationObserver | null = null;
let darkModeSnapshot = false;

function readDarkModeSnapshot(): boolean {
  return document.documentElement.classList.contains('dark');
}

function ensureObserver(): void {
  if (observer) {
    return;
  }

  darkModeSnapshot = readDarkModeSnapshot();
  observer = new MutationObserver(() => {
    const next = readDarkModeSnapshot();
    if (next === darkModeSnapshot) {
      return;
    }

    darkModeSnapshot = next;
    listeners.forEach((listener) => listener());
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

function subscribe(listener: DarkModeListener): () => void {
  ensureObserver();
  listeners.add(listener);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0 && observer) {
      observer.disconnect();
      observer = null;
    }
  };
}

function getSnapshot(): boolean {
  darkModeSnapshot = readDarkModeSnapshot();
  return darkModeSnapshot;
}

/**
 * Returns whether dark mode is currently active based on Tailwind's dark class.
 * Automatically updates when the dark mode class changes.
 */
export function useDarkMode(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
