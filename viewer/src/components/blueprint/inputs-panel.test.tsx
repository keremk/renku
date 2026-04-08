/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { InputsPanel } from './inputs-panel';
import type { BlueprintInputDef, BlueprintLoopGroup } from '@/types/blueprint-graph';

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

function makeLoopGroup(
  overrides?: Partial<BlueprintLoopGroup>
): BlueprintLoopGroup {
  return {
    groupId: 'LoopGroup:scene:NumOfSegments:0',
    primaryDimension: 'scene',
    countInput: 'NumOfSegments',
    countInputOffset: 0,
    members: [
      { inputName: 'SceneVideoPrompt' },
      { inputName: 'StoryboardImagePrompt' },
    ],
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('InputsPanel array input rendering', () => {
  it('renders itemType=text arrays as card sections with add text card when ungrouped', () => {
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

  it('renders itemType=string arrays as vertical list with add/remove controls when ungrouped', () => {
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

  it('renders audio and video arrays with media-style cards and add placeholders when ungrouped', () => {
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

  it('renders Resolution editor controls for resolution-type inputs', () => {
    render(
      <InputsPanel
        inputs={[makeInput('Resolution', 'resolution')]}
        inputValues={[
          {
            name: 'Resolution',
            value: { width: 1280, height: 720 },
          },
        ]}
        selectedNodeId={null}
        isEditable={true}
      />
    );

    expect(screen.getByText('Other Inputs')).toBeTruthy();
    expect(screen.getByLabelText('Resolution width')).toBeTruthy();
    expect(screen.getByLabelText('Resolution height value')).toBeTruthy();
  });
});

describe('InputsPanel loop-grouped indexed controls', () => {
  it('pages grouped text inputs with previous/next controls and 1-based index display', () => {
    render(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[
          { name: 'SceneVideoPrompt', value: ['scene 1 video', 'scene 2 video'] },
          {
            name: 'StoryboardImagePrompt',
            value: ['scene 1 storyboard', 'scene 2 storyboard'],
          },
          { name: 'NumOfSegments', value: 2 },
        ]}
        selectedNodeId={null}
        isEditable={true}
      />
    );

    // Defaults to the last index (2 in 1-based display)
    expect(screen.getByText('scene 2 video')).toBeTruthy();
    expect(screen.getByText('scene 2 storyboard')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Previous loop index' }));

    expect(screen.getByText('scene 1 video')).toBeTruthy();
    expect(screen.getByText('scene 1 storyboard')).toBeTruthy();
  });

  it('applies add/remove atomically across grouped members and auto-updates managed counter', async () => {
    vi.useFakeTimers();

    const onSave = vi.fn().mockResolvedValue(undefined);

    render(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[
          { name: 'SceneVideoPrompt', value: ['scene 1', 'scene 2'] },
          { name: 'StoryboardImagePrompt', value: ['board 1', 'board 2'] },
          { name: 'NumOfSegments', value: 2 },
        ]}
        selectedNodeId={null}
        isEditable={true}
        onSave={onSave}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add loop index' }));

    // New index creates empty slots for every member input.
    expect(screen.getByText('Add SceneVideoPrompt')).toBeTruthy();
    expect(screen.getByText('Add StoryboardImagePrompt')).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onSave).toHaveBeenCalled();
    const afterAdd = onSave.mock.calls.at(-1)?.[0] as Record<string, unknown>;

    expect(Array.isArray(afterAdd.SceneVideoPrompt)).toBe(true);
    expect((afterAdd.SceneVideoPrompt as unknown[]).length).toBe(3);
    expect(Array.isArray(afterAdd.StoryboardImagePrompt)).toBe(true);
    expect((afterAdd.StoryboardImagePrompt as unknown[]).length).toBe(3);
    expect(afterAdd.NumOfSegments).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: 'Remove last loop index' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onSave.mock.calls.length).toBeGreaterThan(1);
    const afterRemove = onSave.mock.calls.at(-1)?.[0] as Record<string, unknown>;

    expect((afterRemove.SceneVideoPrompt as unknown[]).length).toBe(2);
    expect((afterRemove.StoryboardImagePrompt as unknown[]).length).toBe(2);
    expect(afterRemove.NumOfSegments).toBe(2);
  });

  it('enforces minimum group length of 1 by disabling remove-last on first index', () => {
    render(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[
          { name: 'SceneVideoPrompt', value: ['scene 1'] },
          { name: 'StoryboardImagePrompt', value: ['board 1'] },
          { name: 'NumOfSegments', value: 1 },
        ]}
        selectedNodeId={null}
        isEditable={true}
      />
    );

    const removeButton = screen.getByRole('button', {
      name: 'Remove last loop index',
    });
    expect((removeButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('auto-normalizes mismatched member lengths/counter and shows dismissible warning', () => {
    render(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[
          { name: 'SceneVideoPrompt', value: ['scene 1'] },
          {
            name: 'StoryboardImagePrompt',
            value: ['board 1', 'board 2', 'board 3'],
          },
          { name: 'NumOfSegments', value: 1 },
        ]}
        selectedNodeId={null}
        isEditable={true}
      />
    );

    expect(
      screen.getByText(/We synchronized grouped inputs to 3 items/i)
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Dismiss loop normalization warning',
      })
    );

    expect(
      screen.queryByText(/We synchronized grouped inputs to 3 items/i)
    ).toBeNull();
  });

  it('shows loading placeholder and skips grouped normalization until inputs are loaded', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[]}
        isInputValuesLoading={true}
        selectedNodeId={null}
        isEditable={true}
        onSave={onSave}
      />
    );

    expect(screen.getByText('Loading inputs...')).toBeTruthy();
    expect(screen.queryByText(/We synchronized grouped inputs/i)).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onSave).not.toHaveBeenCalled();

    rerender(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[
          { name: 'SceneVideoPrompt', value: ['scene 1'] },
          {
            name: 'StoryboardImagePrompt',
            value: ['board 1', 'board 2', 'board 3'],
          },
          { name: 'NumOfSegments', value: 1 },
        ]}
        isInputValuesLoading={false}
        selectedNodeId={null}
        isEditable={true}
        onSave={onSave}
      />
    );

    expect(
      screen.getByText(/We synchronized grouped inputs to 3 items/i)
    ).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(onSave).toHaveBeenCalled();
  });

  it('never auto-saves transient empty grouped values while a refresh is loading', async () => {
    vi.useFakeTimers();
    const onSave = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[
          { name: 'SceneVideoPrompt', value: ['scene 1', 'scene 2'] },
          { name: 'StoryboardImagePrompt', value: ['board 1', 'board 2'] },
          { name: 'NumOfSegments', value: 2 },
        ]}
        isInputValuesLoading={false}
        selectedNodeId={null}
        isEditable={true}
        onSave={onSave}
      />
    );

    rerender(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[]}
        isInputValuesLoading={true}
        selectedNodeId={null}
        isEditable={true}
        onSave={onSave}
      />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(onSave).not.toHaveBeenCalled();
  });

  it('clears normalized warning when incoming loaded values are already aligned', () => {
    const { rerender } = render(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[
          { name: 'SceneVideoPrompt', value: ['scene 1'] },
          {
            name: 'StoryboardImagePrompt',
            value: ['board 1', 'board 2', 'board 3'],
          },
          { name: 'NumOfSegments', value: 1 },
        ]}
        selectedNodeId={null}
        isEditable={true}
      />
    );

    expect(
      screen.getByText(/We synchronized grouped inputs to 3 items/i)
    ).toBeTruthy();

    rerender(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('StoryboardImagePrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[makeLoopGroup()]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[
          {
            name: 'SceneVideoPrompt',
            value: ['scene 1', 'scene 2', 'scene 3'],
          },
          {
            name: 'StoryboardImagePrompt',
            value: ['board 1', 'board 2', 'board 3'],
          },
          { name: 'NumOfSegments', value: 3 },
        ]}
        selectedNodeId={null}
        isEditable={true}
      />
    );

    expect(screen.queryByText(/We synchronized grouped inputs/i)).toBeNull();
  });

  it('hides managed counters only when grouped management applies', () => {
    const grouped = render(
      <InputsPanel
        inputs={[
          makeInput('SceneVideoPrompt', 'array', 'text'),
          makeInput('NumOfSegments', 'int'),
        ]}
        loopGroups={[
          makeLoopGroup({ members: [{ inputName: 'SceneVideoPrompt' }] }),
        ]}
        managedCountInputs={['NumOfSegments']}
        inputValues={[
          { name: 'SceneVideoPrompt', value: ['scene 1'] },
          { name: 'NumOfSegments', value: 1 },
        ]}
        selectedNodeId={null}
        isEditable={true}
      />
    );

    expect(screen.queryByText('NumOfSegments')).toBeNull();

    grouped.unmount();

    render(
      <InputsPanel
        inputs={[
          makeInput('StyleReferenceImages', 'array', 'image'),
          makeInput('NumOfSegments', 'int'),
        ]}
        inputValues={[
          {
            name: 'StyleReferenceImages',
            value: ['file:./input-files/style-1.png'],
          },
          { name: 'NumOfSegments', value: 2 },
        ]}
        selectedNodeId={null}
        isEditable={true}
        blueprintFolder='/tmp/blueprint'
        movieId='movie-test'
      />
    );

    expect(screen.getByText('NumOfSegments')).toBeTruthy();
    expect(screen.getByText('StyleReferenceImages')).toBeTruthy();
    expect(screen.getByText('Add image')).toBeTruthy();
  });

  it('renders grouped media labels without inline index suffix and without per-card remove action', () => {
    const group: BlueprintLoopGroup = {
      groupId: 'LoopGroup:character:NumOfCharacters:0',
      primaryDimension: 'character',
      countInput: 'NumOfCharacters',
      countInputOffset: 0,
      members: [
        { inputName: 'CelebrityThenImages' },
        { inputName: 'CelebrityNowImages' },
      ],
    };

    render(
      <InputsPanel
        inputs={[
          makeInput('CelebrityThenImages', 'array', 'image'),
          makeInput('CelebrityNowImages', 'array', 'image'),
          makeInput('NumOfCharacters', 'int'),
        ]}
        loopGroups={[group]}
        managedCountInputs={['NumOfCharacters']}
        inputValues={[
          {
            name: 'CelebrityThenImages',
            value: [
              'file:./input-files/celebrity-then-1.png',
              'file:./input-files/celebrity-then-2.png',
            ],
          },
          {
            name: 'CelebrityNowImages',
            value: [
              'file:./input-files/celebrity-now-1.png',
              'file:./input-files/celebrity-now-2.png',
            ],
          },
          { name: 'NumOfCharacters', value: 2 },
        ]}
        selectedNodeId={null}
        isEditable={true}
        blueprintFolder='/tmp/blueprint'
        movieId='movie-test'
      />
    );

    expect(screen.getByText('CelebrityThenImages')).toBeTruthy();
    expect(screen.getByText('CelebrityNowImages')).toBeTruthy();
    expect(screen.queryByText(/CelebrityThenImages\[/)).toBeNull();
    expect(screen.queryByText(/CelebrityNowImages\[/)).toBeNull();
    expect(screen.queryByTitle('Remove item')).toBeNull();
  });
});
