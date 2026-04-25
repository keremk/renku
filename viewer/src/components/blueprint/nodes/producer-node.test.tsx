/**
 * @vitest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProducerNode } from './producer-node';

vi.mock('@xyflow/react', () => ({
  Handle: () => null,
  Position: {
    Left: 'left',
    Right: 'right',
  },
}));

describe('ProducerNode', () => {
  it('formats declared producer labels without overflowing the node text area', () => {
    render(
      <ProducerNode
        data={{
          label: 'SeedanceStartEndClipProducer',
          description: 'Produces a start/end frame motion clip.',
          status: 'not-run-yet',
          inputBindings: [],
          outputBindings: [],
        }}
      />
    );

    const label = screen.getByText('Seedance Start End Clip Producer');

    expect(label).toBeTruthy();
    expect(label.className).toContain('line-clamp-2');
    expect(label.closest('div')?.getAttribute('title')).toBe(
      'SeedanceStartEndClipProducer\nProduces a start/end frame motion clip.'
    );
  });
});
