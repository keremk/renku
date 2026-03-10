/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MediaExpandDialog } from './media-expand-dialog';

describe('MediaExpandDialog', () => {
  it('renders image preview with contain sizing constraints', () => {
    render(
      <MediaExpandDialog
        open={true}
        onOpenChange={() => undefined}
        title='Expanded image'
        url='https://example.com/image.png'
        mediaType='image'
      />
    );

    const image = screen.getByRole('img');
    expect(image.className).toContain('object-contain');
    expect(image.className).toContain('w-full');
    expect(image.className).toContain('h-full');
  });

  it('uses constrained dialog layout and fixed prompt viewport', () => {
    render(
      <MediaExpandDialog
        open={true}
        onOpenChange={() => undefined}
        title='Expanded image'
        url='https://example.com/image.png'
        mediaType='image'
        promptText={'line 1\nline 2\nline 3\nline 4\nline 5'}
      />
    );

    const dialogContent = document.querySelector(
      '[data-slot="dialog-content"]'
    );
    expect(dialogContent).not.toBeNull();
    expect(dialogContent?.className).toContain('flex');
    expect(dialogContent?.className).toContain('flex-col');

    const prompt = screen.getByText(/line 1/);
    expect(prompt.tagName).toBe('PRE');
    expect(prompt.className).toContain('h-[4.75rem]');
    expect(prompt.className).toContain('overflow-y-auto');
  });
});
