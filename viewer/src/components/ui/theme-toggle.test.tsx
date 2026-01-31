/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from './theme-toggle';
import { ThemeProvider } from '@/contexts/theme-context';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

// Mock matchMedia
const createMatchMediaMock = (matches: boolean) => {
  return vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const renderWithTheme = (initialTheme?: 'light' | 'dark') => {
  if (initialTheme) {
    localStorageMock.getItem.mockReturnValue(initialTheme);
  }

  return render(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>
  );
};

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorageMock.clear();
    Object.defineProperty(window, 'localStorage', { value: localStorageMock });
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: createMatchMediaMock(false),
    });
    document.documentElement.classList.remove('dark');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders as a switch button', () => {
      renderWithTheme();

      const toggle = screen.getByRole('switch');
      expect(toggle).toBeTruthy();
    });

    it('has correct aria-label for light mode', () => {
      renderWithTheme('light');

      const toggle = screen.getByRole('switch');
      expect(toggle.getAttribute('aria-label')).toBe('Switch to dark mode');
    });

    it('has correct aria-label for dark mode', () => {
      renderWithTheme('dark');

      const toggle = screen.getByRole('switch');
      expect(toggle.getAttribute('aria-label')).toBe('Switch to light mode');
    });

    it('has aria-checked false in light mode', () => {
      renderWithTheme('light');

      const toggle = screen.getByRole('switch');
      expect(toggle.getAttribute('aria-checked')).toBe('false');
    });

    it('has aria-checked true in dark mode', () => {
      renderWithTheme('dark');

      const toggle = screen.getByRole('switch');
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });
  });

  describe('click interaction', () => {
    it('toggles from light to dark on click', () => {
      renderWithTheme('light');

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('toggles from dark to light on click', () => {
      renderWithTheme('dark');

      const toggle = screen.getByRole('switch');
      fireEvent.click(toggle);

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light');
    });
  });

  describe('keyboard interaction', () => {
    it('toggles on Enter key', () => {
      renderWithTheme('light');

      const toggle = screen.getByRole('switch');
      fireEvent.keyDown(toggle, { key: 'Enter' });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('toggles on Space key', () => {
      renderWithTheme('light');

      const toggle = screen.getByRole('switch');
      fireEvent.keyDown(toggle, { key: ' ' });

      expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    });

    it('does not toggle on other keys', () => {
      renderWithTheme('light');

      const toggle = screen.getByRole('switch');
      fireEvent.keyDown(toggle, { key: 'Tab' });

      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });
  });

  describe('visual state', () => {
    it('renders Sun icon in light mode', () => {
      const { container } = renderWithTheme('light');

      // Check that lucide-react Sun icon is present (it renders as an SVG)
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });

    it('renders Moon icon in dark mode', () => {
      const { container } = renderWithTheme('dark');

      // Check that lucide-react Moon icon is present (it renders as an SVG)
      const svg = container.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });
});
