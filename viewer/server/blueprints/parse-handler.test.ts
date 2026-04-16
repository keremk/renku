import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  loadYamlBlueprintTreeMock,
  buildBlueprintParseGraphProjectionMock,
  prepareBlueprintResolutionContextMock,
} = vi.hoisted(() => ({
  loadYamlBlueprintTreeMock: vi.fn(),
  buildBlueprintParseGraphProjectionMock: vi.fn(),
  prepareBlueprintResolutionContextMock: vi.fn(),
}));

vi.mock('@gorenku/core', () => ({
  loadYamlBlueprintTree: loadYamlBlueprintTreeMock,
  buildBlueprintParseGraphProjection: buildBlueprintParseGraphProjectionMock,
  prepareBlueprintResolutionContext: prepareBlueprintResolutionContextMock,
}));

import { parseBlueprintToGraph } from './parse-handler.js';

describe('parseBlueprintToGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates blueprint parsing and projection entirely to core services', async () => {
    const root = {
      id: 'fixture-root',
      namespacePath: [],
      document: {},
      children: new Map(),
      sourcePath: '/tmp/fixture.yaml',
    };

    const projection = {
      meta: { id: 'fixture', name: 'Fixture' },
      nodes: [],
      edges: [],
      inputs: [],
      outputs: [],
      layerAssignments: {},
      layerCount: 0,
      loopGroups: [
        {
          groupId: 'LoopGroup:scene:NumOfSegments:0',
          primaryDimension: 'scene',
          countInput: 'NumOfSegments',
          countInputOffset: 0,
          members: [{ inputName: 'SceneVideoPrompt' }],
        },
      ],
      managedCountInputs: ['NumOfSegments'],
    };

    loadYamlBlueprintTreeMock.mockResolvedValue({ root });
    prepareBlueprintResolutionContextMock.mockResolvedValue({ root });
    buildBlueprintParseGraphProjectionMock.mockReturnValue(projection);

    const result = await parseBlueprintToGraph('/tmp/fixture.yaml', '/catalog');

    expect(loadYamlBlueprintTreeMock).toHaveBeenCalledWith('/tmp/fixture.yaml', {
      catalogRoot: '/catalog',
    });
    expect(prepareBlueprintResolutionContextMock).toHaveBeenCalledWith({
      root,
      schemaSource: { kind: 'producer-metadata' },
    });
    expect(buildBlueprintParseGraphProjectionMock).toHaveBeenCalledWith(root);
    expect(result).toEqual(projection);
  });
});
