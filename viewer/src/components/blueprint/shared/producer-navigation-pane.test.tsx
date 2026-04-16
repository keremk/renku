/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProducerNavigationPane } from './producer-navigation-pane';

describe('ProducerNavigationPane', () => {
  it('preserves execution order when the same composite producer family is interleaved', () => {
    render(
      <ProducerNavigationPane
        producerIds={[
          'Producer:Group.First',
          'Producer:Other',
          'Producer:Group.Second',
        ]}
        activeProducerId={null}
        onSelectProducer={vi.fn()}
      />
    );

    const producerButtons = screen
      .getAllByRole('button')
      .filter((button) =>
        button.getAttribute('aria-label')?.startsWith('Select producer ')
      )
      .map((button) => button.getAttribute('aria-label'));

    expect(producerButtons).toEqual([
      'Select producer Producer:Group.First',
      'Select producer Producer:Other',
      'Select producer Producer:Group.Second',
    ]);
    expect(screen.getAllByText('Group')).toHaveLength(2);
  });
});
