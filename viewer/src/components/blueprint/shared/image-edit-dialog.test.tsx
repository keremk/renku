/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImageEditDialog } from './image-edit-dialog';
import type { ImageEditDialogProps } from './image-edit-dialog';
import type { AvailableModelOption } from '@/types/blueprint-graph';

// Mock canvas context and ResizeObserver since jsdom doesn't support them
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

  // Mock ResizeObserver
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const mockModels: AvailableModelOption[] = [
  { provider: 'fal-ai', model: 'flux-dev' },
  { provider: 'fal-ai', model: 'flux-schnell' },
  { provider: 'replicate', model: 'sdxl' },
];

const defaultProps: ImageEditDialogProps = {
  open: true,
  onOpenChange: vi.fn(),
  imageUrl: 'https://example.com/image.png',
  title: 'Edit Image \u2014 Scene #1',
  availableModels: mockModels,
  onFileUpload: vi.fn(),
};

describe('ImageEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders dialog when open', () => {
    render(<ImageEditDialog {...defaultProps} />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('does not render dialog when closed', () => {
    render(<ImageEditDialog {...defaultProps} open={false} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows dialog title', () => {
    render(<ImageEditDialog {...defaultProps} />);
    expect(
      screen.getByRole('heading', { name: 'Edit Image \u2014 Scene #1' })
    ).toBeTruthy();
  });

  it('renders three tab buttons', () => {
    render(<ImageEditDialog {...defaultProps} />);
    const tabs = screen
      .getAllByRole('button')
      .filter((btn) =>
        ['manual', 'camera', 'upload'].includes(
          btn.getAttribute('data-tab') ?? ''
        )
      );
    expect(tabs).toHaveLength(3);
  });

  it('Manual tab is active by default', () => {
    render(<ImageEditDialog {...defaultProps} />);
    const manualTab = screen
      .getAllByRole('button')
      .find((btn) => btn.getAttribute('data-tab') === 'manual');
    expect(manualTab?.className).toContain('text-foreground');
  });

  it('shows prompt textarea in Manual tab', () => {
    render(<ImageEditDialog {...defaultProps} />);
    expect(
      screen.getByPlaceholderText('Describe the image edit...')
    ).toBeTruthy();
  });

  it('shows model selector in Manual tab with available models', () => {
    render(<ImageEditDialog {...defaultProps} />);
    // Dialog renders in a portal, so use document.body for querying
    const select = document.body.querySelector('select');
    expect(select).toBeTruthy();
    const options = select?.querySelectorAll('option');
    expect(options?.length).toBe(3);
    expect(options?.[0]?.textContent).toBe('flux-dev');
    expect(options?.[1]?.textContent).toBe('flux-schnell');
    expect(options?.[2]?.textContent).toBe('sdxl');
  });

  it('shows REGENERATE button in Manual tab', () => {
    render(<ImageEditDialog {...defaultProps} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('REGENERATE');
  });

  it('switches to Camera tab on click', async () => {
    render(<ImageEditDialog {...defaultProps} />);
    const cameraTab = screen
      .getAllByRole('button')
      .find((btn) => btn.getAttribute('data-tab') === 'camera');
    fireEvent.click(cameraTab!);

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('Camera Control');
      expect(dialog.querySelector('canvas')).toBeTruthy();
    });
  });

  it('Camera tab has REGENERATE button', async () => {
    render(<ImageEditDialog {...defaultProps} />);
    const cameraTab = screen
      .getAllByRole('button')
      .find((btn) => btn.getAttribute('data-tab') === 'camera');
    fireEvent.click(cameraTab!);

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('REGENERATE');
    });
  });

  it('switches to Upload tab on click', async () => {
    render(<ImageEditDialog {...defaultProps} />);
    const uploadTab = screen
      .getAllByRole('button')
      .find((btn) => btn.getAttribute('data-tab') === 'upload');
    fireEvent.click(uploadTab!);

    await waitFor(() => {
      expect(screen.getByText(/drag and drop/i)).toBeTruthy();
    });
  });

  it('shows Cancel and Update buttons in footer', () => {
    render(<ImageEditDialog {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy();
  });

  it('calls onOpenChange(false) when Cancel is clicked', () => {
    const onOpenChange = vi.fn();
    render(<ImageEditDialog {...defaultProps} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders image preview', () => {
    render(<ImageEditDialog {...defaultProps} />);
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toBe('https://example.com/image.png');
  });

  it('hides model selector when no models available', () => {
    render(<ImageEditDialog {...defaultProps} availableModels={[]} />);
    expect(document.body.querySelector('[role="dialog"] select')).toBeNull();
  });

  it('prompts textarea char count updates on input', async () => {
    render(<ImageEditDialog {...defaultProps} />);
    const textarea = screen.getByPlaceholderText('Describe the image edit...');
    fireEvent.change(textarea, { target: { value: 'Hello world' } });

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(dialog.textContent).toContain('11 chars');
    });
  });

  it('shows estimated cost before regenerate and updates on model change', async () => {
    const onEstimateCost = vi
      .fn()
      .mockResolvedValueOnce({
        cost: 0.03,
        minCost: 0.03,
        maxCost: 0.03,
        isPlaceholder: false,
      })
      .mockResolvedValueOnce({
        cost: 0.01,
        minCost: 0.01,
        maxCost: 0.01,
        isPlaceholder: false,
      });

    render(
      <ImageEditDialog {...defaultProps} onEstimateCost={onEstimateCost} />
    );

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledWith({
        mode: 'manual',
        prompt: '',
        model: mockModels[0],
      });
      expect(screen.getByText('Estimated cost: $0.03')).toBeTruthy();
    });

    const select = document.body.querySelector('select');
    fireEvent.change(select!, { target: { value: '1' } });

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledWith({
        mode: 'manual',
        prompt: '',
        model: mockModels[1],
      });
      expect(screen.getByText('Estimated cost: $0.01')).toBeTruthy();
    });
  });

  it('shows camera cost after switching tabs without regenerating', async () => {
    const onEstimateCost = vi
      .fn()
      .mockResolvedValueOnce({
        cost: 0.03,
        minCost: 0.03,
        maxCost: 0.03,
        isPlaceholder: false,
      })
      .mockResolvedValueOnce({
        cost: 0.12,
        minCost: 0.12,
        maxCost: 0.12,
        isPlaceholder: false,
      });

    render(
      <ImageEditDialog {...defaultProps} onEstimateCost={onEstimateCost} />
    );

    await waitFor(() => {
      expect(screen.getByText('Estimated cost: $0.03')).toBeTruthy();
    });

    const cameraTab = screen
      .getAllByRole('button')
      .find((btn) => btn.getAttribute('data-tab') === 'camera');
    fireEvent.click(cameraTab!);

    await waitFor(() => {
      expect(onEstimateCost).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'camera', prompt: '' })
      );
      expect(screen.getByText('Estimated cost: $0.12')).toBeTruthy();
    });
  });

  it('regenerates preview in manual mode and shows estimated cost', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.png',
      tempId: 'tmp-123',
      estimatedCost: {
        cost: 0.0123,
        minCost: 0.01,
        maxCost: 0.02,
        isPlaceholder: false,
      },
    });

    render(<ImageEditDialog {...defaultProps} onRegenerate={onRegenerate} />);

    const textarea = screen.getByPlaceholderText('Describe the image edit...');
    fireEvent.change(textarea, { target: { value: 'add a soft sunset glow' } });
    fireEvent.click(screen.getByRole('button', { name: 'REGENERATE' }));

    await waitFor(() => {
      expect(onRegenerate).toHaveBeenCalledWith({
        mode: 'manual',
        prompt: 'add a soft sunset glow',
        model: mockModels[0],
      });
    });

    await waitFor(() => {
      expect(screen.getByRole('img').getAttribute('src')).toBe(
        'https://example.com/generated.png'
      );
      expect(screen.getByText('Estimated cost: $0.01-$0.02')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: 'Update' }).hasAttribute('disabled')
      ).toBe(false);
    });
  });

  it('applies generated preview on Update and closes dialog', async () => {
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

  it('cleans up generated preview when Cancel is clicked', async () => {
    const onRegenerate = vi.fn().mockResolvedValue({
      previewUrl: 'https://example.com/generated.png',
      tempId: 'tmp-cancel-1',
      estimatedCost: {
        cost: 0.01,
        minCost: 0.01,
        maxCost: 0.01,
        isPlaceholder: false,
      },
    });
    const onCleanupGenerated = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <ImageEditDialog
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
      expect(onCleanupGenerated).toHaveBeenCalledWith('tmp-cancel-1');
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
