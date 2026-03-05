/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { VideoEditDialog } from './video-edit-dialog';
import type { VideoEditDialogProps } from './video-edit-dialog';
import type { AvailableModelOption } from '@/types/blueprint-graph';

const mockModels: AvailableModelOption[] = [
  { provider: 'fal-ai', model: 'veo3.1' },
  { provider: 'replicate', model: 'google/veo-3.1-fast' },
];

const defaultProps: VideoEditDialogProps = {
  open: true,
  onOpenChange: vi.fn(),
  videoUrl: 'https://example.com/clip.mp4',
  title: 'Edit Video — Scene #1',
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
      return 12;
    },
  });

  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = function load() {
    this.dispatchEvent(new Event('loadedmetadata'));
  };
});

describe('VideoEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getTab = (tabId: string) =>
    document.body.querySelector(`[data-tab="${tabId}"]`) as HTMLElement | null;

  it('renders all three tab buttons', () => {
    render(<VideoEditDialog {...defaultProps} />);
    const tabs = document.body.querySelectorAll('[data-tab]');
    expect(tabs).toHaveLength(3);
  });

  it('regenerates in rerun mode with selected model', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-rerun.mp4',
      tempId: 'tmp-rerun-video',
      estimatedCost: {
        cost: 0.08,
        minCost: 0.08,
        maxCost: 0.08,
        isPlaceholder: false,
      },
    });

    render(<VideoEditDialog {...defaultProps} onRegenerate={onRegenerate} />);

    fireEvent.change(
      screen.getByPlaceholderText('Optional prompt tweak before re-running...'),
      {
        target: { value: 'more cinematic camera motion' },
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'rerun',
        prompt: 'more cinematic camera motion',
        model: mockModels[0],
      });
    });
  });

  it('regenerates in clip mode with clip params', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-clip.mp4',
      tempId: 'tmp-clip-video',
      estimatedCost: {
        cost: 0,
        minCost: 0,
        maxCost: 0,
        isPlaceholder: false,
      },
    });

    render(<VideoEditDialog {...defaultProps} onRegenerate={onRegenerate} />);

    const clipTab = getTab('clip');
    fireEvent.click(clipTab!);

    await waitFor(() => {
      expect(screen.getByText('Clip Timeline')).toBeTruthy();
    });

    const [startThumb] = screen.getAllByRole('slider');
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
      expect(screen.getByText('End: 00:12.00')).toBeTruthy();
    });
  });

  it('chains clip regeneration from the previous preview temp id', async () => {
    const onRegenerate = vi
      .fn()
      .mockResolvedValueOnce({
        previewUrl: 'https://example.com/generated-clip-1.mp4',
        tempId: 'tmp-clip-1',
        estimatedCost: {
          cost: 0,
          minCost: 0,
          maxCost: 0,
          isPlaceholder: false,
        },
      })
      .mockResolvedValueOnce({
        previewUrl: 'https://example.com/generated-clip-2.mp4',
        tempId: 'tmp-clip-2',
        estimatedCost: {
          cost: 0,
          minCost: 0,
          maxCost: 0,
          isPlaceholder: false,
        },
      });
    const onCleanupGenerated = vi.fn().mockResolvedValue(undefined);

    render(
      <VideoEditDialog
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
      sourceTempId: 'tmp-clip-1',
    });

    await waitFor(() => {
      expect(onCleanupGenerated).toHaveBeenCalledWith('tmp-clip-1');
    });
  });

  it('initializes clip handles to full duration in clip tab', async () => {
    render(<VideoEditDialog {...defaultProps} />);

    const clipTab = getTab('clip');
    fireEvent.click(clipTab!);

    await waitFor(() => {
      expect(screen.getByText('Start: 00:00.00')).toBeTruthy();
      expect(screen.getByText('End: 00:12.00')).toBeTruthy();
    });
  });

  it('scrubs the preview while adjusting clip handles', async () => {
    render(<VideoEditDialog {...defaultProps} />);

    const clipTab = getTab('clip');
    fireEvent.click(clipTab!);

    const video = document.body.querySelector(
      'video[aria-label="Edit Video — Scene #1"]'
    ) as HTMLVideoElement;
    const [startThumb] = screen.getAllByRole('slider');

    expect(video.currentTime).toBe(0);

    fireEvent.keyDown(startThumb, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(video.currentTime).toBeGreaterThan(0);
    });
  });

  it('starts clip playback at the clip start when play begins out of range', async () => {
    render(<VideoEditDialog {...defaultProps} />);

    const clipTab = getTab('clip');
    fireEvent.click(clipTab!);

    const video = document.body.querySelector(
      'video[aria-label="Edit Video — Scene #1"]'
    ) as HTMLVideoElement;
    video.currentTime = 12;

    fireEvent.play(video);

    expect(video.currentTime).toBe(0);
  });

  it('applies generated preview on Update', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.mp4',
      tempId: 'tmp-apply-video',
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
      <VideoEditDialog
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
      expect(onApplyGenerated).toHaveBeenCalledWith('tmp-apply-video');
      expect(onCleanupGenerated).toHaveBeenCalledWith('tmp-apply-video');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
