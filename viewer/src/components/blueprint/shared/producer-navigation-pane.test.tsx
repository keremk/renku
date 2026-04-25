/**
 * @vitest-environment jsdom
 */

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProducerNavigationPane } from './producer-navigation-pane';
import type { BlueprintGraphData } from '@/types/blueprint-graph';

describe('ProducerNavigationPane', () => {
  it('renders one group when the same composite producer family is interleaved', () => {
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
      'Select producer Producer:Group.Second',
      'Select producer Producer:Other',
    ]);
    expect(screen.getAllByText('Group')).toHaveLength(1);
  });

  it('uses graph metadata for composite grouping and display labels', () => {
    const graphData: BlueprintGraphData = {
      meta: { id: 'test', name: 'Test' },
      nodes: [
        {
          id: 'Producer:SeedanceVideoGenerator.MultiShotPromptCompiler',
          type: 'producer',
          label: 'MultiShotPromptCompiler',
          namespacePath: ['SeedanceVideoGenerator', 'MultiShotPromptCompiler'],
          compositePath: ['SeedanceVideoGenerator'],
          compositeName: 'SeedanceVideoGenerator',
        },
        {
          id: 'Producer:SegmentPlainImageProducer',
          type: 'producer',
          label: 'SegmentPlainImageProducer',
          namespacePath: ['SegmentPlainImageProducer'],
        },
        {
          id: 'Producer:SeedanceVideoGenerator.MultiShotClipProducer',
          type: 'producer',
          label: 'MultiShotClipProducer',
          namespacePath: ['SeedanceVideoGenerator', 'MultiShotClipProducer'],
          compositePath: ['SeedanceVideoGenerator'],
          compositeName: 'SeedanceVideoGenerator',
        },
      ],
      edges: [],
      inputs: [],
      outputs: [],
    };

    render(
      <ProducerNavigationPane
        producerIds={[
          'Producer:SeedanceVideoGenerator.MultiShotPromptCompiler',
          'Producer:SegmentPlainImageProducer',
          'Producer:SeedanceVideoGenerator.MultiShotClipProducer',
        ]}
        graphData={graphData}
        activeProducerId={null}
        onSelectProducer={vi.fn()}
      />
    );

    expect(screen.getAllByText('Seedance Video Generator')).toHaveLength(1);
    expect(screen.getByText('Multi Shot Prompt Compiler')).toBeTruthy();
    expect(screen.getByText('Multi Shot Clip Producer')).toBeTruthy();
    expect(screen.getByText('Segment Plain Image Producer')).toBeTruthy();
  });
});
