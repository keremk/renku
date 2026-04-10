/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ExecutionProvider } from '@/contexts/execution-context';
import { StoryboardPanel } from './storyboard-panel';

describe('StoryboardPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders storyboard columns without a shared column and passes prompt text into media expand dialogs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        meta: {
          blueprintId: 'StoryFixture',
          blueprintName: 'Story Fixture',
          axisLabel: 'Scene',
          axisDimension: 'scene',
          axisCount: 1,
          hasProducedStoryState: true,
        },
        sharedSection: {
          id: 'shared',
          title: 'Shared',
          items: [],
        },
        columns: [
          {
            id: 'scene:0',
            title: 'Scene 1',
            dimension: { symbol: 'scene', index: 0 },
            groups: [
              {
                id: 'group-prompts',
                label: 'Prompts',
                items: [
                  {
                    id: 'Input:ScenePrompt[0]',
                    kind: 'input-text',
                    mediaType: 'text',
                    identity: {
                      canonicalInputId: 'Input:ScenePrompt[0]',
                    },
                    label: 'Scene Prompt 1',
                    state: 'input',
                    dependencyClass: 'local-upstream',
                    text: { value: 'Opening scene prompt', language: 'markdown' },
                    actions: {
                      canExpand: true,
                      canEdit: true,
                      canUpload: false,
                    },
                  },
                ],
              },
              {
                id: 'group-images',
                label: 'Image Producer',
                items: [
                  {
                    id: 'Artifact:ImageProducer.GeneratedImage[0]',
                    kind: 'artifact-image',
                    mediaType: 'image',
                    identity: {
                      canonicalArtifactId: 'Artifact:ImageProducer.GeneratedImage[0]',
                    },
                    label: 'Generated Image 1',
                    state: 'succeeded',
                    dependencyClass: 'local-output',
                    media: {
                      mimeType: 'image/png',
                      value: 'https://example.com/generated-image.png',
                    },
                    actions: {
                      canExpand: true,
                      canEdit: false,
                      canUpload: false,
                    },
                  },
                ],
              },
            ],
          },
        ],
        connectors: [
          {
            id: 'Input:ScenePrompt[0]->Artifact:ImageProducer.GeneratedImage[0]',
            fromItemId: 'Input:ScenePrompt[0]',
            toItemId: 'Artifact:ImageProducer.GeneratedImage[0]',
            kind: 'local',
          },
        ],
      }),
    } as Response);

    render(
      <ExecutionProvider onArtifactProduced={() => {}}>
        <StoryboardPanel blueprintPath='/tmp/storyboard.yaml' />
      </ExecutionProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Scene 1')).toBeTruthy();
    });

    expect(screen.getByText('Scene 1')).toBeTruthy();
    expect(screen.queryByText('Shared')).toBeNull();
    expect(screen.getByText('Scene Prompt 1')).toBeTruthy();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);

    const imageButton = screen.getByAltText('Generated Image 1').closest('button');
    expect(imageButton).toBeTruthy();
    fireEvent.click(imageButton!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Opening scene prompt')).toBeTruthy();
    expect(
      within(dialog).queryByText('No upstream prompt artifact is available for this output.')
    ).toBeNull();
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('resolves prompt artifacts for storyboard media when the projection only contains media cards', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/viewer-api/blueprints/storyboard')) {
        return {
          ok: true,
          json: async () => ({
            meta: {
              blueprintId: 'StoryFixture',
              blueprintName: 'Story Fixture',
              axisLabel: 'Segment',
              axisDimension: 'segment',
              axisCount: 1,
              hasProducedStoryState: true,
            },
            sharedSection: {
              id: 'shared',
              title: 'Shared',
              items: [],
            },
            columns: [
              {
                id: 'segment:0',
                title: 'Segment 1',
                dimension: { symbol: 'segment', index: 0 },
                groups: [
                  {
                    id: 'group-images',
                    label: 'Image Producer',
                    items: [
                      {
                        id: 'Artifact:ImageProducer.GeneratedImage[0]',
                        kind: 'artifact-image',
                        mediaType: 'image',
                        identity: {
                          canonicalArtifactId: 'Artifact:ImageProducer.GeneratedImage[0]',
                        },
                        label: 'Generated Image 1',
                        state: 'succeeded',
                        dependencyClass: 'local-output',
                        media: {
                          mimeType: 'image/png',
                          value: 'https://example.com/generated-image.png',
                        },
                        actions: {
                          canExpand: true,
                          canEdit: false,
                          canUpload: false,
                        },
                      },
                    ],
                  },
                ],
              },
            ],
            connectors: [],
          }),
        } as Response;
      }

      return {
        ok: true,
        text: async () => 'Resolved runtime prompt',
      } as Response;
    });

    render(
      <ExecutionProvider onArtifactProduced={() => {}}>
        <StoryboardPanel
          blueprintPath='/tmp/storyboard.yaml'
          blueprintFolder='/tmp/blueprint'
          movieId='movie-001'
          artifacts={[
            {
              id: 'Artifact:ImageProducer.GeneratedImage[0]',
              name: 'ImageProducer.GeneratedImage[0]',
              hash: 'generated-image-hash',
              size: 10,
              mimeType: 'image/png',
              status: 'succeeded',
              createdAt: null,
            },
            {
              id: 'Artifact:PromptProducer.ScenePrompt[0]',
              name: 'PromptProducer.ScenePrompt[0]',
              hash: 'prompt-hash',
              size: 12,
              mimeType: 'text/plain',
              status: 'succeeded',
              createdAt: null,
            },
          ]}
          graphData={{
            meta: {
              id: 'StoryFixture',
              name: 'Story Fixture',
            },
            nodes: [
              {
                id: 'Producer:ImageProducer',
                type: 'producer',
                label: 'ImageProducer',
                inputBindings: [
                  {
                    from: 'PromptProducer.ScenePrompt[segment]',
                    to: 'ImageProducer.Prompt[segment]',
                    sourceType: 'producer',
                    targetType: 'producer',
                    isConditional: false,
                    sourceEndpoint: {
                      kind: 'producer',
                      reference: 'PromptProducer.ScenePrompt[segment]',
                      producerName: 'PromptProducer',
                      segments: [
                        { name: 'PromptProducer', selectors: [] },
                        {
                          name: 'ScenePrompt',
                          selectors: [
                            {
                              kind: 'loop',
                              raw: 'segment',
                              symbol: 'segment',
                              offset: 0,
                            },
                          ],
                        },
                      ],
                      loopSelectors: [
                        {
                          kind: 'loop',
                          raw: 'segment',
                          symbol: 'segment',
                          offset: 0,
                        },
                      ],
                      constantSelectors: [],
                      arraySelectors: [],
                    },
                    targetEndpoint: {
                      kind: 'producer',
                      reference: 'ImageProducer.Prompt[segment]',
                      producerName: 'ImageProducer',
                      segments: [
                        { name: 'ImageProducer', selectors: [] },
                        {
                          name: 'Prompt',
                          selectors: [
                            {
                              kind: 'loop',
                              raw: 'segment',
                              symbol: 'segment',
                              offset: 0,
                            },
                          ],
                        },
                      ],
                      loopSelectors: [
                        {
                          kind: 'loop',
                          raw: 'segment',
                          symbol: 'segment',
                          offset: 0,
                        },
                      ],
                      constantSelectors: [],
                      arraySelectors: [],
                    },
                  },
                ],
              },
            ],
            edges: [],
            inputs: [],
            outputs: [],
          }}
        />
      </ExecutionProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Resolved runtime prompt')).toBeTruthy();
    });

    const imageButton = screen.getByAltText('Generated Image 1').closest('button');
    expect(imageButton).toBeTruthy();
    fireEvent.click(imageButton!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Resolved runtime prompt')).toBeTruthy();
  });
});
