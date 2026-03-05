/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AudioEditDialog } from './audio-edit-dialog';
import type { AudioEditDialogProps } from './audio-edit-dialog';
import type { AvailableModelOption } from '@/types/blueprint-graph';

const mockModels: AvailableModelOption[] = [
  { provider: 'elevenlabs', model: 'eleven_multilingual_v2' },
  { provider: 'openai', model: 'tts-1-hd' },
];

const defaultProps: AudioEditDialogProps = {
  open: true,
  onOpenChange: vi.fn(),
  audioUrl: 'https://example.com/narration.mp3',
  title: 'Edit Audio — Narration #1',
  availableModels: mockModels,
  onFileUpload: vi.fn(),
};

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;

  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = function load() {
    this.dispatchEvent(new Event('loadedmetadata'));
  };
});

describe('AudioEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const getTab = (tabId: string) =>
    document.body.querySelector(`[data-tab="${tabId}"]`) as HTMLElement | null;

  it('renders both tab buttons', () => {
    render(<AudioEditDialog {...defaultProps} />);
    const tabs = document.body.querySelectorAll('[data-tab]');
    expect(tabs).toHaveLength(2);
  });

  it('re-run tab active by default, shows narration text area, voice ID, emotion inputs', () => {
    render(<AudioEditDialog {...defaultProps} />);

    expect(screen.getByText('Narration Text')).toBeTruthy();
    expect(
      screen.getByPlaceholderText('Enter narration text for re-run...')
    ).toBeTruthy();
    expect(screen.getByText('Voice ID')).toBeTruthy();
    expect(
      screen.getByPlaceholderText('e.g., Rachel, Liam...')
    ).toBeTruthy();
    expect(screen.getByText('Emotion')).toBeTruthy();
    expect(
      screen.getByPlaceholderText('e.g., happy, neutral, sad...')
    ).toBeTruthy();
  });

  it('shows model selector with available models including provider name', () => {
    render(<AudioEditDialog {...defaultProps} />);

    const select = screen.getByRole('combobox');
    expect(select).toBeTruthy();

    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(2);
    expect(options[0]?.textContent).toBe(
      'elevenlabs/eleven_multilingual_v2'
    );
    expect(options[1]?.textContent).toBe('openai/tts-1-hd');
  });

  it('regenerates with selected model, prompt, and inputOverrides', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.mp3',
      tempId: 'tmp-audio-1',
      estimatedCost: {
        cost: 0.01,
        minCost: 0.01,
        maxCost: 0.01,
        isPlaceholder: false,
      },
    });

    render(
      <AudioEditDialog {...defaultProps} onRegenerate={onRegenerate} />
    );

    fireEvent.change(
      screen.getByPlaceholderText('Enter narration text for re-run...'),
      { target: { value: 'Hello world narration' } }
    );
    fireEvent.change(
      screen.getByPlaceholderText('e.g., Rachel, Liam...'),
      { target: { value: 'Rachel' } }
    );
    fireEvent.change(
      screen.getByPlaceholderText('e.g., happy, neutral, sad...'),
      { target: { value: 'happy' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'rerun',
        prompt: 'Hello world narration',
        model: mockModels[0],
        inputOverrides: { VoiceId: 'Rachel', Emotion: 'happy' },
      });
    });
  });

  it('passes inputOverrides when voiceId/emotion are non-empty', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.mp3',
      tempId: 'tmp-audio-2',
      estimatedCost: {
        cost: 0.01,
        minCost: 0.01,
        maxCost: 0.01,
        isPlaceholder: false,
      },
    });

    render(
      <AudioEditDialog {...defaultProps} onRegenerate={onRegenerate} />
    );

    fireEvent.change(
      screen.getByPlaceholderText('e.g., Rachel, Liam...'),
      { target: { value: 'Liam' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledTimes(1);
      const call = onRegenerate.mock.calls[0]![0];
      expect(call.inputOverrides).toEqual({ VoiceId: 'Liam' });
    });
  });

  it('does NOT pass inputOverrides when voiceId/emotion are empty', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.mp3',
      tempId: 'tmp-audio-3',
      estimatedCost: {
        cost: 0.01,
        minCost: 0.01,
        maxCost: 0.01,
        isPlaceholder: false,
      },
    });

    render(
      <AudioEditDialog {...defaultProps} onRegenerate={onRegenerate} />
    );

    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledTimes(1);
      const call = onRegenerate.mock.calls[0]![0];
      expect(call.inputOverrides).toBeUndefined();
    });
  });

  it('switches to Upload tab and shows dropzone', () => {
    render(<AudioEditDialog {...defaultProps} />);

    fireEvent.click(getTab('upload')!);

    expect(screen.getByText(/Drag and drop/i)).toBeTruthy();
  });

  it('applies generated preview on Update', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.mp3',
      tempId: 'tmp-apply-audio',
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
      <AudioEditDialog
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
      expect(onApplyGenerated).toHaveBeenCalledWith('tmp-apply-audio');
      expect(onCleanupGenerated).toHaveBeenCalledWith('tmp-apply-audio');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('cleans up pending preview on dialog close', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.mp3',
      tempId: 'tmp-cleanup-audio',
      estimatedCost: {
        cost: 0.02,
        minCost: 0.02,
        maxCost: 0.02,
        isPlaceholder: false,
      },
    });
    const onCleanupGenerated = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <AudioEditDialog
        {...defaultProps}
        onOpenChange={onOpenChange}
        onRegenerate={onRegenerate}
        onCleanupGenerated={onCleanupGenerated}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));
    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(onCleanupGenerated).toHaveBeenCalledWith('tmp-cleanup-audio');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
