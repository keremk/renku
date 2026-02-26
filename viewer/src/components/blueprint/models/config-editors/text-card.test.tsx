/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
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

const TEXT_SCHEMA = {
  type: 'object',
  default: TEXT_DEFAULTS,
};

describe('TextCard', () => {
  describe('Default persistence', () => {
    it('does not call onChange on mount when value is undefined and isEditable is true', () => {
      const onChange = vi.fn();

      render(
        <TextCard
          value={undefined}
          schema={TEXT_SCHEMA}
          isEditable={true}
          onChange={onChange}
        />
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onChange when value is undefined but isEditable is false', () => {
      const onChange = vi.fn();

      render(
        <TextCard
          value={undefined}
          schema={TEXT_SCHEMA}
          isEditable={false}
          onChange={onChange}
        />
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onChange when value is already defined', () => {
      const onChange = vi.fn();

      render(
        <TextCard
          value={{ font: 'Helvetica', position: 'top-center' }}
          schema={TEXT_SCHEMA}
          isEditable={true}
          onChange={onChange}
        />
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it('persists defaults only after explicit Save', async () => {
      const onChange = vi.fn();

      render(
        <TextCard
          value={undefined}
          schema={TEXT_SCHEMA}
          isEditable={true}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(TEXT_DEFAULTS);
      });
    });

    it('does not persist defaults when cancelled', () => {
      const onChange = vi.fn();

      render(
        <TextCard
          value={undefined}
          schema={TEXT_SCHEMA}
          isEditable={true}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Rendering', () => {
    it('renders safely when schema has no defaults', () => {
      const { container } = render(
        <TextCard
          value={undefined}
          schema={{ type: 'object' }}
          isEditable={false}
        />
      );

      expect(container.textContent).toContain('Text Overlay');
      expect(container.textContent).toContain('Middle Center');
    });

    it('renders the text preview with merged config', () => {
      const { container } = render(
        <TextCard
          value={{ font: 'Helvetica' }}
          schema={TEXT_SCHEMA}
          isEditable={false}
        />
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
