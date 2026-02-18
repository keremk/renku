import { describe, expect, it } from 'vitest';
import { SYSTEM_INPUTS } from '../types.js';
import {
  getSystemInputDefinition,
  injectDerivedSystemInputs,
  isSystemInputName,
  listSystemInputDefinitions,
} from './system-inputs.js';

describe('execution/system-inputs', () => {
  it('classifies system inputs by authoring behavior', () => {
    const duration = getSystemInputDefinition(SYSTEM_INPUTS.DURATION);
    const segmentDuration = getSystemInputDefinition(
      SYSTEM_INPUTS.SEGMENT_DURATION
    );
    const movieId = getSystemInputDefinition(SYSTEM_INPUTS.MOVIE_ID);

    expect(duration.kind).toBe('user');
    expect(duration.userSupplied).toBe(true);

    expect(segmentDuration.kind).toBe('derived');
    expect(segmentDuration.userSupplied).toBe(false);

    expect(movieId.kind).toBe('runtime');
    expect(movieId.userSupplied).toBe(false);
  });

  it('exposes metadata for every known system input', () => {
    const names = listSystemInputDefinitions()
      .map((entry) => entry.name)
      .sort();
    expect(names).toEqual(Object.values(SYSTEM_INPUTS).sort());
  });

  it('recognizes known system input names', () => {
    expect(isSystemInputName('Duration')).toBe(true);
    expect(isSystemInputName('NumOfSegments')).toBe(true);
    expect(isSystemInputName('SegmentDuration')).toBe(true);
    expect(isSystemInputName('MovieId')).toBe(true);
    expect(isSystemInputName('StorageRoot')).toBe(true);
    expect(isSystemInputName('StorageBasePath')).toBe(true);
    expect(isSystemInputName('Topic')).toBe(false);
  });

  it('injects derived SegmentDuration when missing', () => {
    const result = injectDerivedSystemInputs({
      'Input:Duration': 60,
      'Input:NumOfSegments': 6,
    });

    expect(result['Input:SegmentDuration']).toBe(10);
  });
});
