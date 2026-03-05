/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CameraControl } from './camera-control';
import { generateShotDescription } from './camera-utils';
import type { CameraParams } from './camera-utils';

// Mock useDarkMode hook
vi.mock('@/hooks/use-dark-mode', () => ({
  useDarkMode: () => true,
}));

// Mock ResizeObserver since jsdom doesn't support it
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('generateShotDescription', () => {
  it('returns front view eye-level medium shot for defaults', () => {
    expect(generateShotDescription(0, 0, 1)).toBe(
      'front view eye-level shot medium shot'
    );
  });

  it('snaps azimuth to nearest 45 degrees', () => {
    expect(generateShotDescription(22, 0, 1)).toBe(
      'front view eye-level shot medium shot'
    );
    expect(generateShotDescription(46, 0, 1)).toBe(
      'front-left view eye-level shot medium shot'
    );
    expect(generateShotDescription(90, 0, 1)).toBe(
      'left view eye-level shot medium shot'
    );
  });

  it('classifies elevation labels correctly', () => {
    expect(generateShotDescription(0, -20, 1)).toContain('low-angle shot');
    expect(generateShotDescription(0, -5, 1)).toContain('slightly low shot');
    expect(generateShotDescription(0, 0, 1)).toContain('eye-level shot');
    expect(generateShotDescription(0, 20, 1)).toContain('high-angle shot');
    expect(generateShotDescription(0, 50, 1)).toContain('overhead shot');
  });

  it('classifies distance labels correctly', () => {
    expect(generateShotDescription(0, 0, 0.65)).toContain('extreme close-up');
    expect(generateShotDescription(0, 0, 0.8)).toContain('close-up');
    expect(generateShotDescription(0, 0, 1)).toContain('medium shot');
    expect(generateShotDescription(0, 0, 1.2)).toContain('full shot');
    expect(generateShotDescription(0, 0, 1.35)).toContain('wide shot');
  });

  it('combines all three labels', () => {
    const desc = generateShotDescription(270, 30, 0.7);
    expect(desc).toBe('right view high-angle shot extreme close-up');
  });

  it('handles 360 degree azimuth (wraps to 0)', () => {
    expect(generateShotDescription(360, 0, 1)).toContain('front view');
  });
});

describe('CameraControl', () => {
  const defaultParams: CameraParams = {
    azimuth: 0,
    elevation: 0,
    distance: 1,
    shotDescription: 'front view eye-level shot medium shot',
  };

  // Mock canvas context since jsdom doesn't have real canvas
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
  });

  it('renders canvas element', () => {
    const { container } = render(
      <CameraControl params={defaultParams} onChange={vi.fn()} />
    );
    expect(container.querySelector('canvas')).toBeTruthy();
  });

  it('renders three slider inputs', () => {
    render(<CameraControl params={defaultParams} onChange={vi.fn()} />);
    const sliders = screen.getAllByRole('slider');
    expect(sliders).toHaveLength(3);
  });

  it('renders shot description output', () => {
    const { container } = render(
      <CameraControl params={defaultParams} onChange={vi.fn()} />
    );
    expect(container.textContent).toContain(
      'front view eye-level shot medium shot'
    );
  });

  it('renders Camera Control header', () => {
    const { container } = render(
      <CameraControl params={defaultParams} onChange={vi.fn()} />
    );
    expect(container.textContent).toContain('Camera Control');
  });

  it('calls onChange when azimuth slider changes', () => {
    const onChange = vi.fn();
    render(<CameraControl params={defaultParams} onChange={onChange} />);
    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[0], { target: { value: '90' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ azimuth: 90 })
    );
  });

  it('calls onChange when elevation slider changes', () => {
    const onChange = vi.fn();
    render(<CameraControl params={defaultParams} onChange={onChange} />);
    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[1], { target: { value: '30' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ elevation: 30 })
    );
  });

  it('calls onChange when distance slider changes', () => {
    const onChange = vi.fn();
    render(<CameraControl params={defaultParams} onChange={onChange} />);
    const sliders = screen.getAllByRole('slider');
    fireEvent.change(sliders[2], { target: { value: '1.2' } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ distance: 1.2 })
    );
  });

  it('displays current slider values', () => {
    const params: CameraParams = {
      azimuth: 180,
      elevation: 15,
      distance: 0.8,
      shotDescription: 'back view high-angle shot close-up',
    };
    const { container } = render(
      <CameraControl params={params} onChange={vi.fn()} />
    );
    expect(container.textContent).toContain('180\u00B0');
    expect(container.textContent).toContain('15\u00B0');
    expect(container.textContent).toContain('0.80');
  });

  it('renders Prompt label in output row', () => {
    const { container } = render(
      <CameraControl params={defaultParams} onChange={vi.fn()} />
    );
    expect(container.textContent).toContain('Prompt');
  });
});
