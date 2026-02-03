/**
 * Hook to detect and subscribe to Tailwind's dark mode class changes.
 * Observes document.documentElement for class attribute changes.
 */

import { useState, useEffect } from "react";

/**
 * Returns whether dark mode is currently active based on Tailwind's dark class.
 * Automatically updates when the dark mode class changes.
 */
export function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(() => {
    return document.documentElement.classList.contains("dark");
  });

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
