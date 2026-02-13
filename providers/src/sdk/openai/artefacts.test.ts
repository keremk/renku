import { describe, it, expect } from 'vitest';
import { buildArtefactsFromResponse, parseArtefactIdentifier } from './artefacts.js';

describe('buildArtefactsFromResponse', () => {
  it('trims namespace ordinals so nested fanout arrays resolve correctly', () => {
    const response = {
      ImagePrompt: ['first frame', 'second frame'],
    };
    const produces = [
      'Artifact:ImagePromptGenerator.ImagePrompt[0][0]',
      'Artifact:ImagePromptGenerator.ImagePrompt[0][1]',
    ];

    const artefacts = buildArtefactsFromResponse(response, produces, {
      producerId: 'Producer:ImagePromptGenerator.ImagePromptProducer[0]',
    });

    expect(artefacts).toHaveLength(2);
    expect(artefacts[0]?.blob?.data).toBe('first frame');
    expect(artefacts[1]?.blob?.data).toBe('second frame');
    expect(artefacts.every((artefact) => artefact.status === 'succeeded')).toBe(true);
  });

  it('skips indexing when artefacts only carry namespace ordinals', () => {
    const response = {
      ImageSummary: 'concise summary',
    };
    const produces = ['Artifact:ImagePromptGenerator.ImageSummary[0]'];

    const artefacts = buildArtefactsFromResponse(response, produces, {
      producerId: 'Producer:ImagePromptGenerator.ImagePromptProducer[0]',
    });

    expect(artefacts).toHaveLength(1);
    expect(artefacts[0]?.blob?.data).toBe('concise summary');
    expect(artefacts[0]?.status).toBe('succeeded');
  });

  describe('decomposed JSON artifacts', () => {
    it('extracts nested fields using JSON path for decomposed artifacts', () => {
      const response = {
        Title: 'Moon Landing Documentary',
        Summary: 'A story about space exploration',
        Segments: [
          { Script: 'In 1969, humanity took its first steps on the moon...' },
          { Script: 'The Apollo 11 mission was a triumph of engineering...' },
        ],
      };

      const produces = [
        'Artifact:DocProducer.VideoScript.Title',
        'Artifact:DocProducer.VideoScript.Summary',
        'Artifact:DocProducer.VideoScript.Segments[0].Script',
        'Artifact:DocProducer.VideoScript.Segments[1].Script',
      ];

      const artefacts = buildArtefactsFromResponse(response, produces, {
        producerId: 'Producer:DocProducer',
      });

      expect(artefacts).toHaveLength(4);
      expect(artefacts[0]?.blob?.data).toBe('Moon Landing Documentary');
      expect(artefacts[1]?.blob?.data).toBe('A story about space exploration');
      expect(artefacts[2]?.blob?.data).toBe('In 1969, humanity took its first steps on the moon...');
      expect(artefacts[3]?.blob?.data).toBe('The Apollo 11 mission was a triumph of engineering...');
      expect(artefacts.every((artefact) => artefact.status === 'succeeded')).toBe(true);
    });

    it('handles nested arrays in decomposed artifacts', () => {
      const response = {
        Segments: [
          { ImagePrompts: ['astronaut walking', 'earth from moon'] },
          { ImagePrompts: ['rocket launch', 'mission control'] },
        ],
      };

      const produces = [
        'Artifact:DocProducer.VideoScript.Segments[0].ImagePrompts[0]',
        'Artifact:DocProducer.VideoScript.Segments[0].ImagePrompts[1]',
        'Artifact:DocProducer.VideoScript.Segments[1].ImagePrompts[0]',
        'Artifact:DocProducer.VideoScript.Segments[1].ImagePrompts[1]',
      ];

      const artefacts = buildArtefactsFromResponse(response, produces, {
        producerId: 'Producer:DocProducer',
      });

      expect(artefacts).toHaveLength(4);
      expect(artefacts[0]?.blob?.data).toBe('astronaut walking');
      expect(artefacts[1]?.blob?.data).toBe('earth from moon');
      expect(artefacts[2]?.blob?.data).toBe('rocket launch');
      expect(artefacts[3]?.blob?.data).toBe('mission control');
      expect(artefacts.every((artefact) => artefact.status === 'succeeded')).toBe(true);
    });

    it('returns failure for missing JSON paths', () => {
      const response = {
        Title: 'Some Title',
      };

      const produces = [
        'Artifact:DocProducer.VideoScript.Title',
        'Artifact:DocProducer.VideoScript.NonExistent',
      ];

      const artefacts = buildArtefactsFromResponse(response, produces, {
        producerId: 'Producer:DocProducer',
      });

      expect(artefacts).toHaveLength(2);
      expect(artefacts[0]?.status).toBe('succeeded');
      expect(artefacts[1]?.status).toBe('failed');
      expect(artefacts[1]?.diagnostics?.reason).toBe('json_path_not_found');
    });

    it('extracts boolean fields from decomposed artifacts', () => {
      const response = {
        Characters: [
          { Name: 'Alice', HasTransition: true },
          { Name: 'Bob', HasTransition: false },
          { Name: 'Charlie', HasTransition: true },
        ],
      };

      const produces = [
        'Artifact:DirectorProducer.Script.Characters[0].Name',
        'Artifact:DirectorProducer.Script.Characters[0].HasTransition',
        'Artifact:DirectorProducer.Script.Characters[1].Name',
        'Artifact:DirectorProducer.Script.Characters[1].HasTransition',
        'Artifact:DirectorProducer.Script.Characters[2].Name',
        'Artifact:DirectorProducer.Script.Characters[2].HasTransition',
      ];

      const artefacts = buildArtefactsFromResponse(response, produces, {
        producerId: 'Producer:DirectorProducer',
      });

      expect(artefacts).toHaveLength(6);
      expect(artefacts.every((a) => a.status === 'succeeded')).toBe(true);

      // String values
      expect(artefacts[0]?.blob?.data).toBe('Alice');
      expect(artefacts[2]?.blob?.data).toBe('Bob');
      expect(artefacts[4]?.blob?.data).toBe('Charlie');

      // Boolean values should be serialized as JSON
      expect(artefacts[1]?.blob?.data).toBe('true');
      expect(artefacts[3]?.blob?.data).toBe('false');
      expect(artefacts[5]?.blob?.data).toBe('true');
    });

    it('extracts number fields from decomposed artifacts', () => {
      const response = {
        Items: [
          { Name: 'Item A', Count: 42 },
          { Name: 'Item B', Count: 0 },
        ],
      };

      const produces = [
        'Artifact:Producer.Output.Items[0].Name',
        'Artifact:Producer.Output.Items[0].Count',
        'Artifact:Producer.Output.Items[1].Name',
        'Artifact:Producer.Output.Items[1].Count',
      ];

      const artefacts = buildArtefactsFromResponse(response, produces, {
        producerId: 'Producer:Producer',
      });

      expect(artefacts).toHaveLength(4);
      expect(artefacts.every((a) => a.status === 'succeeded')).toBe(true);

      // Number values should be serialized as JSON
      expect(artefacts[1]?.blob?.data).toBe('42');
      expect(artefacts[3]?.blob?.data).toBe('0');
    });
  });
});

describe('parseArtefactIdentifier', () => {
  it('parses simple artifact identifier', () => {
    const result = parseArtefactIdentifier('Artifact:MovieTitle');
    expect(result).toEqual({
      kind: 'MovieTitle',
      baseName: 'MovieTitle',
      jsonPath: undefined,
      index: undefined,
      ordinal: undefined,
    });
  });

  it('parses artifact with namespace', () => {
    const result = parseArtefactIdentifier('Artifact:DocProducer.VideoScript');
    expect(result).toEqual({
      kind: 'DocProducer.VideoScript',
      baseName: 'VideoScript',
      jsonPath: undefined,
      index: undefined,
      ordinal: undefined,
    });
  });

  it('extracts JSON path when parent artifact name is provided', () => {
    const result = parseArtefactIdentifier(
      'Artifact:DocProducer.VideoScript.Segments[0].Script',
      'VideoScript',
    );
    expect(result?.jsonPath).toBe('Segments[0].Script');
    expect(result?.baseName).toBe('Script');
  });

  it('extracts JSON path with nested arrays', () => {
    const result = parseArtefactIdentifier(
      'Artifact:DocProducer.VideoScript.Segments[1].ImagePrompts[2]',
      'VideoScript',
    );
    expect(result?.jsonPath).toBe('Segments[1].ImagePrompts[2]');
    expect(result?.ordinal).toEqual([1, 2]);
  });

  it('parses ordinal indices from brackets', () => {
    const result = parseArtefactIdentifier('Artifact:Producer.Image[0][1]');
    expect(result?.ordinal).toEqual([0, 1]);
  });

  it('parses named indices from brackets', () => {
    const result = parseArtefactIdentifier('Artifact:Producer.Image[segment=2&image=3]');
    expect(result?.index).toEqual({ segment: 2, image: 3 });
  });
});
