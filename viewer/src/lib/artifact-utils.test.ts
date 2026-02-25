import { describe, it, expect } from 'vitest';
import {
  extractProducerFromArtifactId,
  shortenArtifactDisplayName,
  groupArtifactsByProducer,
  sortProducersByTopology,
  classifyAndGroupArtifacts,
  getArtifactLabel,
  getBlobUrl,
  type ArtifactSubGroup,
} from './artifact-utils';
import type { ArtifactInfo } from '@/types/builds';
import type { BlueprintGraphData } from '@/types/blueprint-graph';

describe('extractProducerFromArtifactId', () => {
  it('extracts producer name from simple artifact ID', () => {
    expect(
      extractProducerFromArtifactId(
        'Artifact:ScriptProducer.NarrationScript[0]'
      )
    ).toBe('ScriptProducer');
  });

  it('extracts producer name from nested artifact ID', () => {
    expect(
      extractProducerFromArtifactId(
        'Artifact:EduScriptProducer.VideoScript.Characters[0].CharacterImagePrompt'
      )
    ).toBe('EduScriptProducer');
  });

  it('extracts producer name with index', () => {
    expect(
      extractProducerFromArtifactId(
        'Artifact:CharacterImageProducer.GeneratedImage[1]'
      )
    ).toBe('CharacterImageProducer');
  });

  it('returns null for invalid format', () => {
    expect(extractProducerFromArtifactId('InvalidFormat')).toBeNull();
  });

  it('returns null for missing prefix', () => {
    expect(extractProducerFromArtifactId('Producer.Output')).toBeNull();
  });

  it('returns null for artifact ID without dot', () => {
    expect(extractProducerFromArtifactId('Artifact:ProducerOnly')).toBeNull();
  });
});

describe('shortenArtifactDisplayName', () => {
  it('removes Artifact prefix and producer name', () => {
    expect(
      shortenArtifactDisplayName('Artifact:ScriptProducer.NarrationScript[0]')
    ).toBe('NarrationScript[0]');
  });

  it('handles nested paths correctly', () => {
    expect(
      shortenArtifactDisplayName(
        'Artifact:EduScriptProducer.VideoScript.Characters[0].CharacterImagePrompt'
      )
    ).toBe('VideoScript.Characters[0].CharacterImagePrompt');
  });

  it('handles simple output name', () => {
    expect(shortenArtifactDisplayName('Artifact:DocProducer.Script')).toBe(
      'Script'
    );
  });

  it('handles artifact ID without dot', () => {
    expect(shortenArtifactDisplayName('Artifact:ProducerOnly')).toBe(
      'ProducerOnly'
    );
  });

  it('handles artifact ID without Artifact prefix', () => {
    expect(shortenArtifactDisplayName('Producer.Output')).toBe('Output');
  });
});

describe('groupArtifactsByProducer', () => {
  const makeArtifact = (id: string): ArtifactInfo => ({
    id,
    name: 'test',
    hash: 'abc123',
    size: 100,
    mimeType: 'text/plain',
    status: 'succeeded',
    createdAt: null,
  });

  it('groups artifacts by producer name', () => {
    const artifacts: ArtifactInfo[] = [
      makeArtifact('Artifact:ProducerA.Output1'),
      makeArtifact('Artifact:ProducerA.Output2'),
      makeArtifact('Artifact:ProducerB.Output1'),
    ];

    const groups = groupArtifactsByProducer(artifacts);

    expect(groups.size).toBe(2);
    expect(groups.get('ProducerA')?.length).toBe(2);
    expect(groups.get('ProducerB')?.length).toBe(1);
  });

  it('groups unrecognized artifacts under [Unknown]', () => {
    const artifacts: ArtifactInfo[] = [
      makeArtifact('Artifact:ValidProducer.Output'),
      makeArtifact('InvalidFormat'),
    ];

    const groups = groupArtifactsByProducer(artifacts);

    expect(groups.size).toBe(2);
    expect(groups.get('ValidProducer')?.length).toBe(1);
    expect(groups.get('[Unknown]')?.length).toBe(1);
  });

  it('handles empty array', () => {
    const groups = groupArtifactsByProducer([]);
    expect(groups.size).toBe(0);
  });
});

describe('sortProducersByTopology', () => {
  const makeGraphData = (nodeLabels: string[]): BlueprintGraphData => ({
    meta: { id: 'test', name: 'Test' },
    nodes: nodeLabels.map((label, index) => ({
      id: `node-${index}`,
      type: 'producer' as const,
      label,
    })),
    edges: [],
    inputs: [],
    outputs: [],
  });

  it('sorts producers by graph node order', () => {
    const graphData = makeGraphData(['ProducerA', 'ProducerB', 'ProducerC']);
    const producers = ['ProducerC', 'ProducerA', 'ProducerB'];

    const sorted = sortProducersByTopology(producers, graphData);

    expect(sorted).toEqual(['ProducerA', 'ProducerB', 'ProducerC']);
  });

  it('puts unknown producers at the end', () => {
    const graphData = makeGraphData(['ProducerA', 'ProducerB']);
    const producers = ['UnknownProducer', 'ProducerB', 'ProducerA'];

    const sorted = sortProducersByTopology(producers, graphData);

    expect(sorted).toEqual(['ProducerA', 'ProducerB', 'UnknownProducer']);
  });

  it('returns original order when no graph data', () => {
    const producers = ['ProducerC', 'ProducerA', 'ProducerB'];

    const sorted = sortProducersByTopology(producers, undefined);

    expect(sorted).toEqual(['ProducerC', 'ProducerA', 'ProducerB']);
  });

  it('handles empty producer list', () => {
    const graphData = makeGraphData(['ProducerA']);
    const sorted = sortProducersByTopology([], graphData);
    expect(sorted).toEqual([]);
  });
});

describe('classifyAndGroupArtifacts', () => {
  const makeArtifact = (id: string): ArtifactInfo => ({
    id,
    name: 'test',
    hash: 'abc123',
    size: 100,
    mimeType: 'text/plain',
    status: 'succeeded',
    createdAt: null,
  });

  it('classifies top-level scalars (no brackets)', () => {
    const artifacts = [
      makeArtifact('Artifact:StoryProducer.Storyboard.Title'),
      makeArtifact('Artifact:StoryProducer.Storyboard.MusicPrompt'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('top-level');
    expect(groups[0].label).toBeNull();
    expect(groups[0].artifacts).toHaveLength(2);
  });

  it('classifies primitive array elements (bracket is last segment)', () => {
    const artifacts = [
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.CharacterImagePrompts[0]'
      ),
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.CharacterImagePrompts[1]'
      ),
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.CharacterImagePrompts[2]'
      ),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('primitive-array');
    expect(groups[0].label).toBe('CharacterImagePrompts');
    expect(groups[0].artifacts).toHaveLength(3);
  });

  it('classifies object array elements (bracket has more segments after)', () => {
    const artifacts = [
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.Scenes[0].NarrationScript'
      ),
      makeArtifact('Artifact:StoryProducer.Storyboard.Scenes[0].HasAudio'),
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.Scenes[1].NarrationScript'
      ),
      makeArtifact('Artifact:StoryProducer.Storyboard.Scenes[1].HasAudio'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe('object-array');
    expect(groups[0].label).toBe('Scenes #1');
    expect(groups[0].artifacts).toHaveLength(2);
    expect(groups[1].type).toBe('object-array');
    expect(groups[1].label).toBe('Scenes #2');
    expect(groups[1].artifacts).toHaveLength(2);
  });

  it('handles Format 1 named dimensions (e.g., [clip=0])', () => {
    const artifacts = [
      makeArtifact('Artifact:VideoProducer.ClipVideo[clip=0]'),
      makeArtifact('Artifact:VideoProducer.ClipVideo[clip=1]'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('primitive-array');
    expect(groups[0].label).toBe('ClipVideo');
    expect(groups[0].artifacts).toHaveLength(2);
  });

  it('handles Format 1 nested dimensions as object array', () => {
    const artifacts = [
      makeArtifact('Artifact:ImageProducer.SegmentImage[segment=0][image=0]'),
      makeArtifact('Artifact:ImageProducer.SegmentImage[segment=0][image=1]'),
      makeArtifact('Artifact:ImageProducer.SegmentImage[segment=1][image=0]'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    // First bracket [segment=0] has more brackets after → object-array
    expect(groups).toHaveLength(2);
    expect(groups[0].type).toBe('object-array');
    expect(groups[0].label).toBe('SegmentImage #1');
    expect(groups[0].artifacts).toHaveLength(2);
    expect(groups[1].type).toBe('object-array');
    expect(groups[1].label).toBe('SegmentImage #2');
    expect(groups[1].artifacts).toHaveLength(1);
  });

  it('handles nested brackets in dot-path format', () => {
    const artifacts = [
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.Scenes[0].CharacterPresent[0]'
      ),
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.Scenes[0].CharacterPresent[1]'
      ),
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.Scenes[0].NarrationScript'
      ),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    // All group under Scenes[0] since Scenes[0] is the first bracket segment
    // and there's more after it
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe('object-array');
    expect(groups[0].label).toBe('Scenes #1');
    expect(groups[0].artifacts).toHaveLength(3);
  });

  it('mixes all three types and sorts correctly', () => {
    const artifacts = [
      makeArtifact('Artifact:StoryProducer.Storyboard.Title'),
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.CharacterImagePrompts[0]'
      ),
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.CharacterImagePrompts[1]'
      ),
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.Scenes[0].NarrationScript'
      ),
      makeArtifact('Artifact:StoryProducer.Storyboard.Scenes[0].HasAudio'),
      makeArtifact(
        'Artifact:StoryProducer.Storyboard.Scenes[1].NarrationScript'
      ),
      makeArtifact('Artifact:StoryProducer.Storyboard.MusicPrompt'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    // Should be: top-level, primitive-array, object-array #1, object-array #2
    expect(groups).toHaveLength(4);
    expect(groups[0].type).toBe('top-level');
    expect(groups[0].artifacts).toHaveLength(2); // Title + MusicPrompt
    expect(groups[1].type).toBe('primitive-array');
    expect(groups[1].label).toBe('CharacterImagePrompts');
    expect(groups[2].type).toBe('object-array');
    expect(groups[2].label).toBe('Scenes #1');
    expect(groups[2].artifacts).toHaveLength(2);
    expect(groups[3].type).toBe('object-array');
    expect(groups[3].label).toBe('Scenes #2');
    expect(groups[3].artifacts).toHaveLength(1);
  });

  it('sorts object array indices numerically (2 before 10)', () => {
    const artifacts = [
      makeArtifact('Artifact:P.Storyboard.Scenes[10].Script'),
      makeArtifact('Artifact:P.Storyboard.Scenes[2].Script'),
      makeArtifact('Artifact:P.Storyboard.Scenes[1].Script'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups.map((g) => g.label)).toEqual([
      'Scenes #2',
      'Scenes #3',
      'Scenes #11',
    ]);
  });

  it('handles empty artifact list', () => {
    const groups = classifyAndGroupArtifacts([]);
    expect(groups).toHaveLength(0);
  });

  it('sorts multiple primitive arrays alphabetically', () => {
    const artifacts = [
      makeArtifact('Artifact:P.Storyboard.VideoPrompts[0]'),
      makeArtifact('Artifact:P.Storyboard.CharacterPrompts[0]'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('CharacterPrompts');
    expect(groups[1].label).toBe('VideoPrompts');
  });

  it('sorts different object array names alphabetically before index', () => {
    const artifacts = [
      makeArtifact('Artifact:P.Storyboard.Scenes[0].Script'),
      makeArtifact('Artifact:P.Storyboard.Characters[0].Name'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('Characters #1');
    expect(groups[1].label).toBe('Scenes #1');
  });

  it('populates arrayName and index on primitive-array sub-groups', () => {
    const artifacts = [
      makeArtifact('Artifact:P.Storyboard.CharacterImagePrompts[0]'),
      makeArtifact('Artifact:P.Storyboard.CharacterImagePrompts[1]'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups).toHaveLength(1);
    expect(groups[0].arrayName).toBe('CharacterImagePrompts');
    expect(groups[0].index).toBeUndefined();
  });

  it('populates arrayName and index on object-array sub-groups', () => {
    const artifacts = [
      makeArtifact('Artifact:P.Storyboard.Scenes[0].Script'),
      makeArtifact('Artifact:P.Storyboard.Scenes[1].Script'),
    ];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups).toHaveLength(2);
    expect(groups[0].arrayName).toBe('Scenes');
    expect(groups[0].index).toBe(0);
    expect(groups[1].arrayName).toBe('Scenes');
    expect(groups[1].index).toBe(1);
  });

  it('does not set arrayName on top-level sub-groups', () => {
    const artifacts = [makeArtifact('Artifact:P.Storyboard.Title')];
    const groups = classifyAndGroupArtifacts(artifacts);

    expect(groups).toHaveLength(1);
    expect(groups[0].arrayName).toBeUndefined();
    expect(groups[0].index).toBeUndefined();
  });
});

describe('getArtifactLabel', () => {
  it('returns leaf name for top-level scalar (no subGroup)', () => {
    expect(getArtifactLabel('Artifact:StoryProducer.Storyboard.Title')).toBe(
      'Title'
    );
  });

  it('returns leaf name for nested top-level scalar', () => {
    expect(
      getArtifactLabel('Artifact:StoryProducer.Storyboard.MusicPrompt')
    ).toBe('MusicPrompt');
  });

  it('returns leaf name with explicit top-level subGroup', () => {
    const subGroup: ArtifactSubGroup = {
      type: 'top-level',
      label: null,
      sortKey: '0',
      artifacts: [],
    };
    expect(
      getArtifactLabel('Artifact:StoryProducer.Storyboard.Title', subGroup)
    ).toBe('Title');
  });

  it('returns #N for primitive-array items', () => {
    const subGroup: ArtifactSubGroup = {
      type: 'primitive-array',
      label: 'CharacterImagePrompts',
      sortKey: '1:CharacterImagePrompts',
      artifacts: [],
      arrayName: 'CharacterImagePrompts',
    };
    expect(
      getArtifactLabel(
        'Artifact:StoryProducer.Storyboard.CharacterImagePrompts[2]',
        subGroup
      )
    ).toBe('#3');
  });

  it('returns #1 for first primitive-array item', () => {
    const subGroup: ArtifactSubGroup = {
      type: 'primitive-array',
      label: 'CharacterImagePrompts',
      sortKey: '1:CharacterImagePrompts',
      artifacts: [],
      arrayName: 'CharacterImagePrompts',
    };
    expect(
      getArtifactLabel(
        'Artifact:StoryProducer.Storyboard.CharacterImagePrompts[0]',
        subGroup
      )
    ).toBe('#1');
  });

  it('returns leaf name for object-array text artifact', () => {
    const subGroup: ArtifactSubGroup = {
      type: 'object-array',
      label: 'Scenes #1',
      sortKey: '2:Scenes:000000',
      artifacts: [],
      arrayName: 'Scenes',
      index: 0,
    };
    expect(
      getArtifactLabel(
        'Artifact:StoryProducer.Storyboard.Scenes[0].SceneImagePrompt',
        subGroup
      )
    ).toBe('SceneImagePrompt');
  });

  it('returns leaf name for object-array boolean/compact artifact', () => {
    const subGroup: ArtifactSubGroup = {
      type: 'object-array',
      label: 'Scenes #1',
      sortKey: '2:Scenes:000000',
      artifacts: [],
      arrayName: 'Scenes',
      index: 0,
    };
    expect(
      getArtifactLabel(
        'Artifact:StoryProducer.Storyboard.Scenes[0].HasAudio',
        subGroup
      )
    ).toBe('HasAudio');
  });

  it("returns 'ArrayName #N' for nested array within object-array", () => {
    const subGroup: ArtifactSubGroup = {
      type: 'object-array',
      label: 'Scenes #1',
      sortKey: '2:Scenes:000000',
      artifacts: [],
      arrayName: 'Scenes',
      index: 0,
    };
    expect(
      getArtifactLabel(
        'Artifact:StoryProducer.Storyboard.Scenes[0].CharacterPresent[1]',
        subGroup
      )
    ).toBe('CharacterPresent #2');
  });

  it("returns 'ArrayName #1' for first nested array element", () => {
    const subGroup: ArtifactSubGroup = {
      type: 'object-array',
      label: 'Scenes #1',
      sortKey: '2:Scenes:000000',
      artifacts: [],
      arrayName: 'Scenes',
      index: 0,
    };
    expect(
      getArtifactLabel(
        'Artifact:StoryProducer.Storyboard.Scenes[0].CharacterPresent[0]',
        subGroup
      )
    ).toBe('CharacterPresent #1');
  });

  it('handles named dimensions in primitive-array', () => {
    const subGroup: ArtifactSubGroup = {
      type: 'primitive-array',
      label: 'ClipVideo',
      sortKey: '1:ClipVideo',
      artifacts: [],
      arrayName: 'ClipVideo',
    };
    expect(
      getArtifactLabel('Artifact:VideoProducer.ClipVideo[clip=1]', subGroup)
    ).toBe('#2');
  });

  it('handles simple single-segment output name', () => {
    expect(getArtifactLabel('Artifact:DocProducer.Script')).toBe('Script');
  });

  it('labels nested same-segment dimensions in object-array groups', () => {
    const subGroup: ArtifactSubGroup = {
      type: 'object-array',
      label: 'SegmentImage #1',
      sortKey: '2:SegmentImage:000000',
      artifacts: [],
      arrayName: 'SegmentImage',
      index: 0,
    };

    expect(
      getArtifactLabel(
        'Artifact:ImageProducer.SegmentImage[segment=0][image=1]',
        subGroup
      )
    ).toBe('image #2');
  });
});

describe('getBlobUrl', () => {
  it('builds blob url with all required params', () => {
    expect(getBlobUrl('demo', 'movie-1', 'hash-1')).toBe(
      '/viewer-api/blueprints/blob?folder=demo&movieId=movie-1&hash=hash-1'
    );
  });

  it('throws when required params are missing', () => {
    expect(() => getBlobUrl('', 'movie-1', 'hash-1')).toThrow(
      '[getBlobUrl] Missing required parameters: blueprintFolder'
    );
    expect(() => getBlobUrl('demo', '', 'hash-1')).toThrow(
      '[getBlobUrl] Missing required parameters: movieId'
    );
    expect(() => getBlobUrl('demo', 'movie-1', '')).toThrow(
      '[getBlobUrl] Missing required parameters: hash'
    );
  });
});
