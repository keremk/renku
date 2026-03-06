/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MusicEditDialog } from './music-edit-dialog';
import type { MusicEditDialogProps } from './music-edit-dialog';
import type { AvailableModelOption } from '@/types/blueprint-graph';

const mockModels: AvailableModelOption[] = [
  { provider: 'minimax', model: 'music-1.5' },
  { provider: 'elevenlabs', model: 'elevenlabs/music' },
];

const defaultProps: MusicEditDialogProps = {
  open: true,
  onOpenChange: vi.fn(),
  musicUrl: 'https://example.com/music.mp3',
  title: 'Edit Music — Track #1',
  availableModels: mockModels,
  onFileUpload: vi.fn(),
};

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  Object.defineProperty(HTMLMediaElement.prototype, 'duration', {
    configurable: true,
    get() {
      return 18;
    },
  });

  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.load = function load() {
    this.dispatchEvent(new Event('loadedmetadata'));
  };
});

describe('MusicEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getTab = (tabId: string) =>
    document.body.querySelector(`[data-tab="${tabId}"]`) as HTMLElement | null;

  it('renders all three tab buttons', () => {
    render(<MusicEditDialog {...defaultProps} />);
    const tabs = document.body.querySelectorAll('[data-tab]');
    expect(tabs).toHaveLength(3);
  });

  it('regenerates in rerun mode with selected model', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-rerun.mp3',
      tempId: 'tmp-rerun-music',
      estimatedCost: {
        cost: 0.04,
        minCost: 0.04,
        maxCost: 0.04,
        isPlaceholder: false,
      },
    });

    render(<MusicEditDialog {...defaultProps} onRegenerate={onRegenerate} />);

    fireEvent.change(
      screen.getByPlaceholderText('Optional prompt tweak before re-running...'),
      {
        target: { value: 'cinematic strings with warm piano' },
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'rerun',
        prompt: 'cinematic strings with warm piano',
        model: mockModels[0],
      });
    });
  });

  it('regenerates in clip mode with clip params', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-clip.mp3',
      tempId: 'tmp-clip-music',
      estimatedCost: {
        cost: 0,
        minCost: 0,
        maxCost: 0,
        isPlaceholder: false,
      },
    });

    render(<MusicEditDialog {...defaultProps} onRegenerate={onRegenerate} />);

    fireEvent.click(getTab('clip')!);

    await waitFor(() => {
      expect(screen.getByText('Clip Timeline')).toBeTruthy();
    });

    let startThumb: HTMLElement | undefined;
    await waitFor(() => {
      const thumbs = screen.getAllByRole('slider');
      startThumb = thumbs[0];
      expect(startThumb).toBeTruthy();
    });
    if (!startThumb) {
      throw new Error('Expected clip slider thumb to render.');
    }
    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    const call = onRegenerate.mock.calls[0]![0];
    expect(call.mode).toBe('clip');
    expect(call.prompt).toBe('');
    expect(call.clipParams.startTimeSeconds).toBeGreaterThan(0);
    expect(call.clipParams.endTimeSeconds).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByText('Start: 00:00.00')).toBeTruthy();
      expect(screen.getByText('End: 00:18.00')).toBeTruthy();
    });
  });

  it('chains clip regeneration from the previous preview temp id', async () => {
    const onRegenerate = vi
      .fn()
      .mockResolvedValueOnce({
        previewUrl: 'https://example.com/generated-clip-1.mp3',
        tempId: 'tmp-clip-music-1',
        estimatedCost: {
          cost: 0,
          minCost: 0,
          maxCost: 0,
          isPlaceholder: false,
        },
      })
      .mockResolvedValueOnce({
        previewUrl: 'https://example.com/generated-clip-2.mp3',
        tempId: 'tmp-clip-music-2',
        estimatedCost: {
          cost: 0,
          minCost: 0,
          maxCost: 0,
          isPlaceholder: false,
        },
      });
    const onCleanupGenerated = vi.fn().mockResolvedValue(undefined);

    render(
      <MusicEditDialog
        {...defaultProps}
        onRegenerate={onRegenerate}
        onCleanupGenerated={onCleanupGenerated}
      />
    );

    fireEvent.click(getTab('clip')!);

    await waitFor(() => {
      expect(screen.getByText('Clip Timeline')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));
    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));
    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledTimes(2);
    });

    expect(onRegenerate.mock.calls[1]?.[0]).toMatchObject({
      mode: 'clip',
      sourceTempId: 'tmp-clip-music-1',
    });

    await waitFor(() => {
      expect(onCleanupGenerated).toHaveBeenCalledWith('tmp-clip-music-1');
    });
  });

  it('scrubs the preview while adjusting clip handles', async () => {
    render(<MusicEditDialog {...defaultProps} />);

    fireEvent.click(getTab('clip')!);

    const audio = document.body.querySelector(
      'audio[aria-label="Edit Music — Track #1"]'
    ) as HTMLAudioElement;
    let startThumb: HTMLElement | undefined;
    await waitFor(() => {
      const thumbs = screen.getAllByRole('slider');
      startThumb = thumbs[0];
      expect(startThumb).toBeTruthy();
    });
    if (!startThumb) {
      throw new Error('Expected clip slider thumb to render.');
    }

    expect(audio.currentTime).toBe(0);

    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(audio.currentTime).toBeGreaterThan(0);
    });

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('keeps clip tab active when prop identity changes while open', async () => {
    const { rerender } = render(
      <MusicEditDialog
        {...defaultProps}
        initialModel={{ provider: 'minimax', model: 'music-1.5' }}
      />
    );

    fireEvent.click(getTab('clip')!);

    await waitFor(() => {
      expect(screen.getByText('Clip Timeline')).toBeTruthy();
    });

    rerender(
      <MusicEditDialog
        {...defaultProps}
        availableModels={[...mockModels]}
        initialModel={{ provider: 'minimax', model: 'music-1.5' }}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Clip Timeline')).toBeTruthy();
      expect(
        screen.queryByPlaceholderText(
          'Optional prompt tweak before re-running...'
        )
      ).toBeNull();
    });
  });

  it('resets play button state when preview URL changes', async () => {
    const { rerender } = render(<MusicEditDialog {...defaultProps} />);

    const audio = document.body.querySelector(
      'audio[aria-label="Edit Music — Track #1"]'
    ) as HTMLAudioElement;

    fireEvent.play(audio);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Pause preview' })
      ).toBeTruthy();
    });

    rerender(
      <MusicEditDialog
        {...defaultProps}
        musicUrl='https://example.com/music-v2.mp3'
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Play preview' })).toBeTruthy();
    });
  });

  it('scrubs from clicked waveform location and starts playback', async () => {
    render(<MusicEditDialog {...defaultProps} />);

    const audio = document.body.querySelector(
      'audio[aria-label="Edit Music — Track #1"]'
    ) as HTMLAudioElement;

    Object.defineProperty(audio, 'duration', {
      configurable: true,
      value: 18,
    });

    const surface = screen.getByTestId('music-waveform-surface');
    Object.defineProperty(surface, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        width: 200,
        height: 100,
        right: 200,
        bottom: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });

    fireEvent.click(surface, { clientX: 100 });

    await waitFor(() => {
      expect(audio.currentTime).toBeGreaterThan(8.5);
      expect(audio.currentTime).toBeLessThan(9.5);
    });

    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it('applies generated preview on Update', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.mp3',
      tempId: 'tmp-apply-music',
      estimatedCost: {
        cost: 0.02,
        minCost: 0.02,
        maxCost: 0.02,
        isPlaceholder: false,
      },
    });
    const onApplyGenerated = vi.fn().mockResolvedValue(undefined);
    const onCleanupGenerated = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <MusicEditDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        onRegenerate={onRegenerate}
        onApplyGenerated={onApplyGenerated}
        onCleanupGenerated={onCleanupGenerated}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));
    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    await waitFor(() => {
      expect(onApplyGenerated).toHaveBeenCalledWith('tmp-apply-music');
      expect(onCleanupGenerated).toHaveBeenCalledWith('tmp-apply-music');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
