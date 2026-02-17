/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { TextCard, type TextConfig } from './text-card';

const TEXT_DEFAULTS: Required<TextConfig> = {
  font: 'Arial',
  fontSize: 56,
  fontBaseColor: '#FFFFFF',
  backgroundColor: '#000000',
  backgroundOpacity: 0.35,
  position: 'middle-center',
  edgePaddingPercent: 8,
};

describe('TextCard', () => {
  describe('Auto-persist defaults', () => {
    it('calls onChange with defaults when value is undefined and isEditable is true', async () => {
      const onChange = vi.fn();

      render(
        <TextCard value={undefined} isEditable={true} onChange={onChange} />
      );

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(TEXT_DEFAULTS);
      });
    });

    it('does not call onChange when value is undefined but isEditable is false', () => {
      const onChange = vi.fn();

      render(
        <TextCard value={undefined} isEditable={false} onChange={onChange} />
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onChange when value is already defined', () => {
      const onChange = vi.fn();

      render(
        <TextCard
          value={{ font: 'Helvetica', position: 'top-center' }}
          isEditable={true}
          onChange={onChange}
        />
      );

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Rendering', () => {
    it('renders the text preview with merged config', () => {
      const { container } = render(
        <TextCard value={{ font: 'Helvetica' }} isEditable={false} />
      );

      expect(container.textContent).toContain('Helvetica');
      expect(container.textContent).toContain('56px');
      expect(container.textContent).toContain('Middle Center');
    });

    it('shows edit button when isEditable is true', () => {
      const { container } = render(
        <TextCard value={TEXT_DEFAULTS} isEditable={true} onChange={vi.fn()} />
      );

      expect(container.textContent).toContain('Edit');
    });

    it('hides edit button when isEditable is false', () => {
      const { container } = render(
        <TextCard value={TEXT_DEFAULTS} isEditable={false} />
      );

      expect(container.querySelector('button')?.textContent).not.toBe('Edit');
    });
  });
});
