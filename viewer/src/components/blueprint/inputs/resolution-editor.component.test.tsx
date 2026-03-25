/**
 * @vitest-environment jsdom
 */
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ResolutionEditor } from './resolution-editor';

function ResolutionHarness({
  initial,
}: {
  initial: { width: number; height: number };
}) {
  const [value, setValue] = useState<unknown>(initial);

  return (
    <div>
      <ResolutionEditor
        input={{
          name: 'Resolution',
          description: 'Resolution',
          type: 'resolution',
        }}
        value={value}
        onChange={setValue}
        isEditable={true}
      />
      <div data-testid='current-resolution'>{JSON.stringify(value)}</div>
    </div>
  );
}

describe('ResolutionEditor component rendering and custom input behavior', () => {
  it('renders 21:9 as landscape mode (width selectable, height fixed)', () => {
    render(<ResolutionHarness initial={{ width: 1680, height: 720 }} />);

    expect(
      screen.getByRole('combobox', { name: 'Aspect ratio' }).textContent
    ).toContain('Landscape 21:9');
    expect(
      screen.getByRole('combobox', { name: 'Resolution width' })
    ).toBeTruthy();
    expect(
      screen.queryByRole('combobox', { name: 'Resolution height' })
    ).toBeNull();
    expect(screen.getByTestId('resolution-height-value').textContent).toBe(
      '720'
    );
  });

  it('renders 9:16 as portrait mode (height selectable, width fixed)', () => {
    render(<ResolutionHarness initial={{ width: 1080, height: 1920 }} />);

    expect(
      screen.getByRole('combobox', { name: 'Aspect ratio' }).textContent
    ).toContain('Portrait 9:16');
    expect(
      screen.queryByRole('combobox', { name: 'Resolution width' })
    ).toBeNull();
    expect(
      screen.getByRole('combobox', { name: 'Resolution height' })
    ).toBeTruthy();
    expect(screen.getByTestId('resolution-width-value').textContent).toBe(
      '1080'
    );
  });

  it('renders 1:1 as square mode (both width and height selectable)', () => {
    render(<ResolutionHarness initial={{ width: 1080, height: 1080 }} />);

    expect(
      screen.getByRole('combobox', { name: 'Aspect ratio' }).textContent
    ).toContain('Square 1:1');
    expect(
      screen.getByRole('combobox', { name: 'Resolution width' })
    ).toBeTruthy();
    expect(
      screen.getByRole('combobox', { name: 'Resolution height' })
    ).toBeTruthy();
  });

  it('renders unsupported ratio as custom mode (both text inputs)', () => {
    render(<ResolutionHarness initial={{ width: 1000, height: 777 }} />);

    expect(
      screen.getByRole('combobox', { name: 'Aspect ratio' }).textContent
    ).toContain('Custom');
    expect(
      screen.getByRole('textbox', { name: 'Resolution width' })
    ).toBeTruthy();
    expect(
      screen.getByRole('textbox', { name: 'Resolution height' })
    ).toBeTruthy();
  });

  it('custom inputs accept only digits while typing', () => {
    render(<ResolutionHarness initial={{ width: 1000, height: 777 }} />);

    const widthInput = screen.getByRole('textbox', {
      name: 'Resolution width',
    });
    fireEvent.change(widthInput, { target: { value: '12ab3' } });
    expect((widthInput as HTMLInputElement).value).toBe('123');
  });

  it('custom width commit updates only width', () => {
    render(<ResolutionHarness initial={{ width: 1000, height: 777 }} />);

    const widthInput = screen.getByRole('textbox', {
      name: 'Resolution width',
    });
    fireEvent.change(widthInput, { target: { value: '1500' } });
    fireEvent.blur(widthInput);

    expect(screen.getByTestId('current-resolution').textContent).toBe(
      '{"width":1500,"height":777}'
    );
  });

  it('custom invalid commit restores previous value', () => {
    render(<ResolutionHarness initial={{ width: 1000, height: 777 }} />);

    const heightInput = screen.getByRole('textbox', {
      name: 'Resolution height',
    });
    fireEvent.change(heightInput, { target: { value: '0' } });
    fireEvent.blur(heightInput);

    expect((heightInput as HTMLInputElement).value).toBe('777');
    expect(screen.getByTestId('current-resolution').textContent).toBe(
      '{"width":1000,"height":777}'
    );
  });
});
