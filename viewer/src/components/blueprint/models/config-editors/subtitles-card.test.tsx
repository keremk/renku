/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { SubtitlesCard, type SubtitleConfig } from './subtitles-card';

// Default values for subtitle configuration (must match the component)
const SUBTITLE_DEFAULTS: Required<SubtitleConfig> = {
  font: 'Arial',
  fontSize: 48,
  fontBaseColor: '#FFFFFF',
  fontHighlightColor: '#FFD700',
  backgroundColor: '#000000',
  backgroundOpacity: 0,
  position: 'bottom-center',
  edgePaddingPercent: 8,
  maxWordsPerLine: 4,
  highlightEffect: true,
};

describe('SubtitlesCard', () => {
  describe('Auto-persist defaults', () => {
    it('calls onChange with defaults when value is undefined and isEditable is true', async () => {
      const onChange = vi.fn();

      render(
        <SubtitlesCard
          value={undefined}
          isEditable={true}
          onChange={onChange}
        />
      );

      // The useEffect should fire and call onChange with defaults
      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(SUBTITLE_DEFAULTS);
      });
    });

    it('does not call onChange when value is undefined but isEditable is false', () => {
      const onChange = vi.fn();

      render(
        <SubtitlesCard
          value={undefined}
          isEditable={false}
          onChange={onChange}
        />
      );

      // Should not be called since not editable
      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onChange when value is already defined', () => {
      const onChange = vi.fn();
      const customConfig: SubtitleConfig = { font: 'Helvetica', fontSize: 32 };

      render(
        <SubtitlesCard
          value={customConfig}
          isEditable={true}
          onChange={onChange}
        />
      );

      // Should not be called since value is defined
      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onChange when onChange is undefined', () => {
      // This test just ensures no error is thrown
      const { container } = render(
        <SubtitlesCard
          value={undefined}
          isEditable={true}
          onChange={undefined}
        />
      );

      // Component should render without errors
      expect(container).toBeTruthy();
    });
  });

  describe('Rendering', () => {
    it('renders the subtitle preview with merged config', () => {
      const { container } = render(
        <SubtitlesCard value={{ font: 'Helvetica' }} isEditable={false} />
      );

      // Check that the component renders
      expect(container.textContent).toContain('Helvetica');
      expect(container.textContent).toContain('48px'); // fontSize from defaults
    });

    it('shows edit button when isEditable is true', () => {
      const { container } = render(
        <SubtitlesCard
          value={{ font: 'Arial' }}
          isEditable={true}
          onChange={vi.fn()}
        />
      );

      expect(container.textContent).toContain('Edit');
    });

    it('hides edit button when isEditable is false', () => {
      const { container } = render(
        <SubtitlesCard value={{ font: 'Arial' }} isEditable={false} />
      );

      // Should not have an Edit button
      expect(container.querySelector('button')?.textContent).not.toBe('Edit');
    });
  });
});
