/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  render,
  waitFor,
  screen,
  fireEvent,
  within,
} from '@testing-library/react';
import { TimelineCard, type TimelineConfig } from './timeline-card';

const originalResizeObserver = globalThis.ResizeObserver;

beforeAll(() => {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
});

afterAll(() => {
  globalThis.ResizeObserver = originalResizeObserver;
});

const TIMELINE_DEFAULTS: TimelineConfig = {
  tracks: ['Video', 'Audio', 'Music'],
  masterTracks: ['Audio'],
  audioClip: { artifact: 'AudioSegments', volume: 1 },
  videoClip: { artifact: 'VideoSegments' },
  musicClip: { artifact: 'Music', volume: 0.3 },
};

const TIMELINE_SCHEMA = {
  type: 'object',
  default: TIMELINE_DEFAULTS,
};

describe('TimelineCard', () => {
  describe('Default persistence', () => {
    it('does not call onChange on mount when value is undefined and isEditable is true', () => {
      const onChange = vi.fn();

      render(
        <TimelineCard value={undefined} isEditable={true} onChange={onChange} />
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onChange when value is undefined but isEditable is false', () => {
      const onChange = vi.fn();

      render(
        <TimelineCard
          value={undefined}
          isEditable={false}
          onChange={onChange}
        />
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onChange when value is already defined', () => {
      const onChange = vi.fn();
      const customConfig: TimelineConfig = {
        tracks: ['Image', 'Audio'],
        masterTracks: ['Audio'],
      };

      render(
        <TimelineCard
          value={customConfig}
          isEditable={true}
          onChange={onChange}
        />
      );

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not call onChange when onChange is undefined', () => {
      const { container } = render(
        <TimelineCard
          value={undefined}
          isEditable={true}
          onChange={undefined}
        />
      );

      expect(container).toBeTruthy();
    });

    it('persists defaults only after explicit Save', async () => {
      const onChange = vi.fn();

      render(
        <TimelineCard
          value={undefined}
          schema={TIMELINE_SCHEMA}
          isEditable={true}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(TIMELINE_DEFAULTS);
      });
    });

    it('does not persist defaults when cancelled', () => {
      const onChange = vi.fn();

      render(
        <TimelineCard
          value={undefined}
          schema={TIMELINE_SCHEMA}
          isEditable={true}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(onChange).not.toHaveBeenCalled();
    });

    it('does not persist defaults when dismissed with Escape', () => {
      const onChange = vi.fn();

      render(
        <TimelineCard
          value={undefined}
          schema={TIMELINE_SCHEMA}
          isEditable={true}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      fireEvent.keyDown(document, { key: 'Escape' });

      expect(onChange).not.toHaveBeenCalled();
    });
  });

  describe('Rendering', () => {
    it('renders track badges for configured tracks', () => {
      const { container } = render(
        <TimelineCard
          value={{
            tracks: ['Video', 'Audio', 'Music'],
            masterTracks: ['Audio'],
          }}
          isEditable={false}
        />
      );

      expect(container.textContent).toContain('Video');
      expect(container.textContent).toContain('Audio');
      expect(container.textContent).toContain('Music');
    });

    it('renders volume summary for clips with volume', () => {
      const { container } = render(
        <TimelineCard
          value={{
            tracks: ['Audio', 'Music'],
            masterTracks: ['Audio'],
            audioClip: { artifact: 'AudioSegments', volume: 1 },
            musicClip: { artifact: 'Music', volume: 0.3 },
          }}
          isEditable={false}
        />
      );

      expect(container.textContent).toContain('Audio: 100%');
      expect(container.textContent).toContain('Music: 30%');
    });

    it('merges partial config with defaults', () => {
      const { container } = render(
        <TimelineCard value={{ tracks: ['Image'] }} isEditable={false} />
      );

      // Should show Image track from value
      expect(container.textContent).toContain('Image');
    });

    it('shows edit button when isEditable is true', () => {
      const { container } = render(
        <TimelineCard
          value={TIMELINE_DEFAULTS}
          isEditable={true}
          onChange={vi.fn()}
        />
      );

      expect(container.textContent).toContain('Edit');
    });

    it('hides edit button when isEditable is false', () => {
      const { container } = render(
        <TimelineCard value={TIMELINE_DEFAULTS} isEditable={false} />
      );

      const buttons = container.querySelectorAll('button');
      const editButton = Array.from(buttons).find(
        (b) => b.textContent === 'Edit'
      );
      expect(editButton).toBeUndefined();
    });

    it('renders the Timeline footer label', () => {
      const { container } = render(
        <TimelineCard value={TIMELINE_DEFAULTS} isEditable={false} />
      );

      expect(container.textContent).toContain('Timeline');
    });

    it('shows Transcription as a track toggle in the edit dialog', async () => {
      render(
        <TimelineCard
          value={TIMELINE_DEFAULTS}
          isEditable={true}
          onChange={vi.fn()}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      expect(await screen.findByText('Transcription')).toBeTruthy();
    });

    it('saves Transcription track with transcriptionClip artifact', async () => {
      const onChange = vi.fn();

      render(
        <TimelineCard
          value={TIMELINE_DEFAULTS}
          isEditable={true}
          onChange={onChange}
        />
      );

      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

      const transcriptionLabel = await screen.findByText('Transcription');
      const transcriptionRow = transcriptionLabel.closest('div');
      expect(transcriptionRow).toBeTruthy();
      const transcriptionSwitch = within(
        transcriptionRow as HTMLElement
      ).getByRole('switch');
      fireEvent.click(transcriptionSwitch);

      fireEvent.click(screen.getByRole('button', { name: 'Save' }));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith(
          expect.objectContaining({
            tracks: ['Video', 'Audio', 'Music', 'Transcription'],
            transcriptionClip: expect.objectContaining({
              artifact: 'TranscriptionAudio',
            }),
          })
        );
      });
    });
  });
});
