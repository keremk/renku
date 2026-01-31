/**
 * Theme toggle switch component.
 * Pill-shaped toggle with sliding thumb and animated Sun/Moon icons.
 */

import { Sun, Moon } from 'lucide-react';
import { useTheme } from '@/contexts/theme-context';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
      onClick={toggleTheme}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleTheme();
        }
      }}
      className="
        relative inline-flex items-center
        h-7 w-14
        p-0.5
        rounded-full
        bg-border dark:bg-muted
        transition-colors duration-200
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background
        cursor-pointer
      "
    >
      {/* Sliding thumb with icon */}
      <span
        className={`
          flex items-center justify-center
          h-[1.375rem] w-[1.375rem]
          rounded-full
          bg-white dark:bg-card
          shadow-sm
          transition-transform duration-200 ease-in-out
          ${isDark ? 'translate-x-7' : 'translate-x-0'}
        `}
      >
        {isDark ? (
          <Moon className="h-3.5 w-3.5 text-primary" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-primary" />
        )}
      </span>
    </button>
  );
}
