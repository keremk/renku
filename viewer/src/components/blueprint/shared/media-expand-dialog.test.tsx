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
});
