/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from './theme-context';

describe('ThemeContext', () => {
  // Create fresh mocks for each test
  let localStorageMock: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    store: Record<string, string>;
  };

  let matchMediaListeners: Array<(e: MediaQueryListEvent) => void>;

  const createMatchMediaMock = (matches: boolean) => {
    return vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn((_: string, handler: (e: MediaQueryListEvent) => void) => {
        matchMediaListeners.push(handler);
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  };

  beforeEach(() => {
    // Reset localStorage mock for each test
    const store: Record<string, string> = {};
    localStorageMock = {
      getItem: vi.fn((key: string) => store[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        Object.keys(store).forEach((key) => delete store[key]);
      }),
      store,
    };
    Object.defineProperty(window, 'localStorage', { value: localStorageMock, writable: true });

    // Reset matchMedia mock to prefer light mode by default
    matchMediaListeners = [];
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: createMatchMediaMock(false),
    });

    // Reset document.documentElement classes
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('useTheme hook', () => {
    it('throws error when used outside ThemeProvider', () => {
      expect(() => renderHook(() => useTheme())).toThrow(
        'useTheme must be used within a ThemeProvider'
      );
    });

    it('returns theme context value when used within ThemeProvider', () => {
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      expect(result.current).toHaveProperty('theme');
      expect(result.current).toHaveProperty('setTheme');
      expect(result.current).toHaveProperty('toggleTheme');
    });
  });

  describe('initial theme', () => {
    it('defaults to light theme when no stored preference and system prefers light', () => {
      window.matchMedia = createMatchMediaMock(false);

      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      expect(result.current.theme).toBe('light');
    });

    it('defaults to dark theme when no stored preference and system prefers dark', () => {
      window.matchMedia = createMatchMediaMock(true);

      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      expect(result.current.theme).toBe('dark');
    });

    it('uses stored theme from localStorage over system preference', () => {
      // Set up localStorage to return 'dark'
      localStorageMock.store['theme'] = 'dark';
      localStorageMock.getItem = vi.fn((key: string) => localStorageMock.store[key] || null);
      window.matchMedia = createMatchMediaMock(false); // System prefers light

      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      expect(result.current.theme).toBe('dark');
    });
  });

  describe('setTheme', () => {
    it('updates theme to dark', () => {
      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      act(() => {
        result.current.setTheme('dark');
      });

      expect(result.current.theme).toBe('dark');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('updates theme to light', () => {
      // Start with dark theme
      localStorageMock.store['theme'] = 'dark';
      localStorageMock.getItem = vi.fn((key: string) => localStorageMock.store[key] || null);

      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      act(() => {
        result.current.setTheme('light');
      });

      expect(result.current.theme).toBe('light');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light');
    });
  });

  describe('toggleTheme', () => {
    it('toggles from light to dark', () => {
      // Explicitly set light theme
      localStorageMock.store['theme'] = 'light';
      localStorageMock.getItem = vi.fn((key: string) => localStorageMock.store[key] || null);

      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      expect(result.current.theme).toBe('light');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('dark');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('toggles from dark to light', () => {
      localStorageMock.store['theme'] = 'dark';
      localStorageMock.getItem = vi.fn((key: string) => localStorageMock.store[key] || null);

      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      expect(result.current.theme).toBe('dark');

      act(() => {
        result.current.toggleTheme();
      });

      expect(result.current.theme).toBe('light');
      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light');
    });
  });

  describe('DOM class management', () => {
    it('adds dark class to documentElement when theme is dark', () => {
      localStorageMock.store['theme'] = 'dark';
      localStorageMock.getItem = vi.fn((key: string) => localStorageMock.store[key] || null);

      renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes dark class from documentElement when theme is light', () => {
      // Start with dark class on the element
      document.documentElement.classList.add('dark');

      // Set light theme in storage
      localStorageMock.store['theme'] = 'light';
      localStorageMock.getItem = vi.fn((key: string) => localStorageMock.store[key] || null);

      renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('updates dark class when theme changes', () => {
      // Start with light theme
      localStorageMock.store['theme'] = 'light';
      localStorageMock.getItem = vi.fn((key: string) => localStorageMock.store[key] || null);

      const { result } = renderHook(() => useTheme(), {
        wrapper: ThemeProvider,
      });

      expect(document.documentElement.classList.contains('dark')).toBe(false);

      act(() => {
        result.current.setTheme('dark');
      });

      expect(document.documentElement.classList.contains('dark')).toBe(true);

      act(() => {
        result.current.setTheme('light');
      });

      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });
});
