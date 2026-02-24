/**
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InputsPanel } from './inputs-panel';
import type { BlueprintInputDef } from '@/types/blueprint-graph';

function makeInput(
  name: string,
  type: string,
  itemType?: string
): BlueprintInputDef {
  return {
    name,
    type,
    itemType,
    required: false,
  };
}

describe('InputsPanel array input rendering', () => {
  it('renders itemType=text arrays as card sections with add text card', () => {
    render(
      <InputsPanel
        inputs={[makeInput('NarrationBlocks', 'array', 'text')]}
        inputValues={[
          {
            name: 'NarrationBlocks',
            value: ['First long paragraph', 'Second long paragraph'],
          },
        ]}
        selectedNodeId={null}
        isEditable={true}
      />
    );

    expect(screen.getByText('NarrationBlocks')).toBeTruthy();
    expect(screen.getByText('NarrationBlocks[0]')).toBeTruthy();
    expect(screen.getByText('NarrationBlocks[1]')).toBeTruthy();
    expect(screen.getByText('Add text')).toBeTruthy();
    expect(screen.queryByText('Other Inputs')).toBeNull();
  });

  it('renders itemType=string arrays as vertical list with add/remove controls', () => {
    render(
      <InputsPanel
        inputs={[makeInput('Keywords', 'array', 'string')]}
        inputValues={[
          {
            name: 'Keywords',
            value: ['history', 'cinematic'],
          },
        ]}
        selectedNodeId={null}
        isEditable={true}
      />
    );

    expect(screen.getByText('Keywords[0]')).toBeTruthy();
    expect(screen.getByText('Keywords[1]')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add item' })).toBeTruthy();
    expect(screen.getAllByRole('textbox')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(3);

    fireEvent.click(screen.getAllByTitle('Remove item')[0]!);
    expect(screen.getAllByRole('textbox')).toHaveLength(2);
    expect(screen.queryByText('Other Inputs')).toBeNull();
  });

  it('renders audio and video arrays with media-style cards and add placeholders', () => {
    render(
      <InputsPanel
        inputs={[
          makeInput('ClipAudio', 'array', 'audio'),
          makeInput('ClipVideo', 'array', 'video'),
        ]}
        inputValues={[
          {
            name: 'ClipAudio',
            value: ['file:./input-files/clip-audio.mp3'],
          },
          {
            name: 'ClipVideo',
            value: ['file:./input-files/clip-video.mp4'],
          },
        ]}
        selectedNodeId={null}
        isEditable={true}
        blueprintFolder='/tmp/blueprint'
        movieId='movie-test'
      />
    );

    expect(screen.getByText('ClipAudio[0]')).toBeTruthy();
    expect(screen.getByText('ClipVideo[0]')).toBeTruthy();
    expect(screen.getByText('Add audio')).toBeTruthy();
    expect(screen.getByText('Add video')).toBeTruthy();
  });
});
