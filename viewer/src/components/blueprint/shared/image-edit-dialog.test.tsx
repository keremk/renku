/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImageEditDialog } from './image-edit-dialog';
import type { ImageEditDialogProps } from './image-edit-dialog';
import type { AvailableModelOption } from '@/types/blueprint-graph';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    scale: vi.fn(),
    fillStyle: '',
    fillRect: vi.fn(),
    fillText: vi.fn(),
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    roundRect: vi.fn(),
    setLineDash: vi.fn(),
  })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const mockModels: AvailableModelOption[] = [
  { provider: 'fal-ai', model: 'flux-dev' },
  { provider: 'fal-ai', model: 'flux-schnell' },
];

const mockEditModels: AvailableModelOption[] = [
  { provider: 'fal-ai', model: 'flux-pro/kontext' },
  { provider: 'fal-ai', model: 'nano-banana-2/edit' },
];

const defaultProps: ImageEditDialogProps = {
  open: true,
  onOpenChange: vi.fn(),
  imageUrl: 'https://example.com/image.png',
  title: 'Edit Image — Scene #1',
  availableModels: mockModels,
  promptArtifactId: 'Artifact:PromptProducer.ImagePrompt[0]',
  onFileUpload: vi.fn(),
};

describe('ImageEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  const getTab = (tabId: string) =>
    document.body.querySelector(`[data-tab="${tabId}"]`) as HTMLElement | null;

  it('renders all four tab buttons', () => {
    render(<ImageEditDialog {...defaultProps} />);
    const tabs = document.body.querySelectorAll('[data-tab]');
    expect(tabs).toHaveLength(4);
  });

  it('Re-run tab is active by default', () => {
    render(<ImageEditDialog {...defaultProps} />);
    const rerunTab = getTab('rerun');
    expect(rerunTab?.className).toContain('text-foreground');
    const select = document.body.querySelector('select');
    expect(select).toBeTruthy();
  });

  it('switches to Edit tab and shows model selector', async () => {
    render(
      <ImageEditDialog {...defaultProps} availableEditModels={mockEditModels} />
    );
    const editTab = getTab('edit');
    fireEvent.click(editTab!);

    await waitFor(() => {
      const select = document.body.querySelector('select');
      expect(select).toBeTruthy();
      const options = select?.querySelectorAll('option');
      expect(options?.length).toBe(2);
      expect(options?.[0]?.textContent).toBe('flux-pro/kontext');
    });
  });

  it('switches to Reframe tab and shows camera control', async () => {
    render(<ImageEditDialog {...defaultProps} />);
    const cameraTab = getTab('camera');
    fireEvent.click(cameraTab!);

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('Camera Control');
    });
  });

  it('switches to Upload tab', async () => {
    render(<ImageEditDialog {...defaultProps} />);
    const uploadTab = getTab('upload');
    fireEvent.click(uploadTab!);

    await waitFor(() => {
      expect(screen.getByText(/drag and drop/i)).toBeTruthy();
      expect(screen.getByRole('img').getAttribute('src')).toBe(
        'https://example.com/image.png'
      );
    });
  });

  it('estimates and regenerates in rerun mode', async () => {
    const onEstimateCost = vi.fn().mockResolvedValue({
      cost: 0.03,
      minCost: 0.03,
      maxCost: 0.03,
      isPlaceholder: false,
    });
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-rerun.png',
      tempId: 'tmp-rerun',
      estimatedCost: {
        cost: 0.01,
        minCost: 0.01,
        maxCost: 0.02,
        isPlaceholder: false,
      },
    });

    render(
      <ImageEditDialog
        {...defaultProps}
        onEstimateCost={onEstimateCost}
        onRegenerate={onRegenerate}
      />
    );

    fireEvent.change(
      screen.getByPlaceholderText('Optional prompt tweak before re-running...'),
      { target: { value: 'slightly more dramatic lighting' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledWith({
        mode: 'rerun',
        prompt: '',
        model: mockModels[0],
      });
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'rerun',
        prompt: 'slightly more dramatic lighting',
        model: mockModels[0],
      });
      expect(screen.getByRole('img').getAttribute('src')).toBe(
        'https://example.com/generated-rerun.png'
      );
    });
  });

  it('pre-selects provided initial model on rerun tab', async () => {
    render(
      <ImageEditDialog
        {...defaultProps}
        initialModel={{ provider: 'fal-ai', model: 'flux-schnell' }}
      />
    );

    await waitFor(() => {
      const select = document.body.querySelector('select') as HTMLSelectElement;
      expect(select.value).toBe('1');
    });
  });

  it('does not re-estimate when rerun prompt changes', async () => {
    const onEstimateCost = vi.fn().mockResolvedValue({
      cost: 0.03,
      minCost: 0.03,
      maxCost: 0.03,
      isPlaceholder: false,
    });

    render(
      <ImageEditDialog {...defaultProps} onEstimateCost={onEstimateCost} />
    );

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledTimes(1);
    });

    fireEvent.change(
      screen.getByPlaceholderText('Optional prompt tweak before re-running...'),
      { target: { value: 'new rerun prompt' } }
    );

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledTimes(1);
    });
  });

  it('re-estimates when edit model changes', async () => {
    const onEstimateCost = vi.fn().mockResolvedValue({
      cost: 0.03,
      minCost: 0.03,
      maxCost: 0.03,
      isPlaceholder: false,
    });

    render(
      <ImageEditDialog
        {...defaultProps}
        availableEditModels={mockEditModels}
        onEstimateCost={onEstimateCost}
      />
    );

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledTimes(1);
    });

    const editTab = getTab('edit');
    fireEvent.click(editTab!);

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledTimes(2);
      expect(onEstimateCost).toHaveBeenNthCalledWith(2, {
        mode: 'edit',
        prompt: '',
        model: mockEditModels[0],
      });
    });

    const select = document.body.querySelector('select');
    fireEvent.change(select!, { target: { value: '1' } });

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledTimes(3);
      expect(onEstimateCost).toHaveBeenNthCalledWith(3, {
        mode: 'edit',
        prompt: '',
        model: mockEditModels[1],
      });
    });
  });

  it('does not re-estimate when camera controls change', async () => {
    const onEstimateCost = vi.fn().mockResolvedValue({
      cost: 0.03,
      minCost: 0.03,
      maxCost: 0.03,
      isPlaceholder: false,
    });

    render(
      <ImageEditDialog {...defaultProps} onEstimateCost={onEstimateCost} />
    );

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledTimes(1);
    });

    const cameraTab = getTab('camera');
    fireEvent.click(cameraTab!);

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledTimes(2);
    });

    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[0]!, { target: { value: '120' } });

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledTimes(2);
    });
  });

  it('regenerates in edit mode with selected model', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-edit.png',
      tempId: 'tmp-edit',
      estimatedCost: {
        cost: 0.02,
        minCost: 0.02,
        maxCost: 0.02,
        isPlaceholder: false,
      },
    });

    render(
      <ImageEditDialog
        {...defaultProps}
        availableEditModels={mockEditModels}
        onRegenerate={onRegenerate}
      />
    );

    const editTab = getTab('edit');
    fireEvent.click(editTab!);

    fireEvent.change(
      screen.getByPlaceholderText(
        'Describe only the changes you want to apply to the current image (for example: "add warm sunset lighting").'
      ),
      {
        target: { value: 'turn this into a watercolor style' },
      }
    );
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'edit',
        prompt: 'turn this into a watercolor style',
        model: mockEditModels[0],
      });
    });
  });

  it('falls back to rerun models in edit mode while edit models are unavailable', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-edit-fallback.png',
      tempId: 'tmp-edit-fallback',
      estimatedCost: {
        cost: 0.02,
        minCost: 0.02,
        maxCost: 0.02,
        isPlaceholder: false,
      },
    });

    render(<ImageEditDialog {...defaultProps} onRegenerate={onRegenerate} />);

    fireEvent.click(getTab('edit')!);

    await waitFor(() => {
      const select = document.body.querySelector('select');
      expect(select).toBeTruthy();
      const options = select?.querySelectorAll('option');
      expect(options?.[0]?.textContent).toBe('flux-dev');
    });

    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'edit',
        prompt: '',
        model: mockModels[0],
      });
    });
  });

  it('does not reset the active edit session when edit models arrive later', async () => {
    const { rerender } = render(<ImageEditDialog {...defaultProps} />);

    fireEvent.click(getTab('edit')!);
    fireEvent.change(
      screen.getByPlaceholderText(
        'Describe only the changes you want to apply to the current image (for example: "add warm sunset lighting").'
      ),
      {
        target: { value: 'keep this edit prompt' },
      }
    );

    rerender(
      <ImageEditDialog {...defaultProps} availableEditModels={mockEditModels} />
    );

    await waitFor(() => {
      expect(
        screen.getByDisplayValue('keep this edit prompt')
      ).toBeTruthy();
      expect(getTab('edit')?.className).toContain('text-foreground');
      const options = document.body.querySelectorAll('option');
      expect(options).toHaveLength(2);
      expect(options[0]?.textContent).toBe('flux-pro/kontext');
    });
  });

  it('keeps rerun models separate from edit-only models', async () => {
    const onEstimateCost = vi.fn().mockResolvedValue({
      cost: 0.03,
      minCost: 0.03,
      maxCost: 0.03,
      isPlaceholder: false,
    });
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-rerun.png',
      tempId: 'tmp-rerun',
      estimatedCost: {
        cost: 0.01,
        minCost: 0.01,
        maxCost: 0.02,
        isPlaceholder: false,
      },
    });

    render(
      <ImageEditDialog
        {...defaultProps}
        availableEditModels={mockEditModels}
        onEstimateCost={onEstimateCost}
        onRegenerate={onRegenerate}
      />
    );

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledWith({
        mode: 'rerun',
        prompt: '',
        model: mockModels[0],
      });
    });

    const editTab = getTab('edit');
    fireEvent.click(editTab!);

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledWith({
        mode: 'edit',
        prompt: '',
        model: mockEditModels[0],
      });
    });

    const rerunTab = getTab('rerun');
    fireEvent.click(rerunTab!);
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'rerun',
        prompt: '',
        model: mockModels[0],
      });
    });
  });

  it('regenerates in reframe mode with camera params', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-camera.png',
      tempId: 'tmp-camera',
      estimatedCost: {
        cost: 0.04,
        minCost: 0.04,
        maxCost: 0.04,
        isPlaceholder: false,
      },
    });

    render(<ImageEditDialog {...defaultProps} onRegenerate={onRegenerate} />);

    const cameraTab = getTab('camera');
    fireEvent.click(cameraTab!);
    expect(
      screen.queryByPlaceholderText(
        'Optional prompt tweak before re-running...'
      )
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'camera', prompt: '' })
      );
    });
  });

  it('regenerates in edit mode when edit models exist but rerun models do not', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-edit-only.png',
      tempId: 'tmp-edit-only',
      estimatedCost: {
        cost: 0.02,
        minCost: 0.02,
        maxCost: 0.02,
        isPlaceholder: false,
      },
    });

    render(
      <ImageEditDialog
        {...defaultProps}
        availableModels={[]}
        availableEditModels={mockEditModels}
        onRegenerate={onRegenerate}
      />
    );

    fireEvent.click(getTab('edit')!);

    const regenerateButton = screen.getByRole('button', { name: 'REGENERATE' });
    expect(regenerateButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(regenerateButton);

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'edit',
        prompt: '',
        model: mockEditModels[0],
      });
      expect(
        screen.queryByText('No models are available for edit preview.')
      ).toBeNull();
    });
  });

  it('applies generated preview on Update', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.png',
      tempId: 'tmp-apply-1',
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
      <ImageEditDialog
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
      expect(onApplyGenerated).toHaveBeenCalledWith('tmp-apply-1');
      expect(onCleanupGenerated).toHaveBeenCalledWith('tmp-apply-1');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('clears stale rerun prompt state when reopened without a prompt artifact id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('Original prompt text'),
    });
    vi.stubGlobal('fetch', fetchMock);

    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated-rerun.png',
      tempId: 'tmp-rerun-reset',
      estimatedCost: {
        cost: 0.01,
        minCost: 0.01,
        maxCost: 0.01,
        isPlaceholder: false,
      },
    });

    const { rerender } = render(
      <ImageEditDialog
        {...defaultProps}
        promptUrl='/prompt.txt'
        promptArtifactId='Artifact:PromptProducer.ImagePrompt[0]'
        onRegenerate={onRegenerate}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Original prompt text')).toBeTruthy();
    });

    rerender(
      <ImageEditDialog
        {...defaultProps}
        open={false}
        promptUrl='/prompt.txt'
        promptArtifactId='Artifact:PromptProducer.ImagePrompt[0]'
        onRegenerate={onRegenerate}
      />
    );

    rerender(
      <ImageEditDialog
        {...defaultProps}
        promptUrl={undefined}
        promptArtifactId={undefined}
        onRegenerate={onRegenerate}
      />
    );

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(
        'Prompt overrides are unavailable for this artifact right now. Re-run will use the original prompt as-is.'
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe('');
      expect(textarea.disabled).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'rerun',
        prompt: '',
        model: mockModels[0],
      });
    });
  });
});
