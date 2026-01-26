/**
 * Unit tests for plan-request-builder utility.
 */

import { describe, it, expect } from 'vitest';
import {
  buildPlanRequest,
  isSurgicalMode,
  getPlanSummary,
  type PlanRequestOptions,
} from './plan-request-builder';

describe('buildPlanRequest', () => {
  const baseOptions: PlanRequestOptions = {
    blueprintName: 'test-blueprint',
    selectedArtifacts: [],
  };

  it('returns basic request when no artifacts selected and no options', () => {
    const result = buildPlanRequest(baseOptions);

    expect(result).toEqual({
      blueprint: 'test-blueprint',
    });
    expect(result.artifactIds).toBeUndefined();
    expect(result.upToLayer).toBeUndefined();
    expect(result.movieId).toBeUndefined();
  });

  it('includes movieId when provided', () => {
    const result = buildPlanRequest({
      ...baseOptions,
      movieId: 'movie-123',
    });

    expect(result.movieId).toBe('movie-123');
  });

  it('sets artifactIds when artifacts are selected', () => {
    const result = buildPlanRequest({
      ...baseOptions,
      selectedArtifacts: [
        'Artifact:AudioProducer.GeneratedAudio[0]',
        'Artifact:AudioProducer.GeneratedAudio[1]',
      ],
    });

    expect(result.artifactIds).toEqual([
      'Artifact:AudioProducer.GeneratedAudio[0]',
      'Artifact:AudioProducer.GeneratedAudio[1]',
    ]);
  });

  it('does not set artifactIds when selectedArtifacts is empty', () => {
    const result = buildPlanRequest({
      ...baseOptions,
      selectedArtifacts: [],
    });

    expect(result.artifactIds).toBeUndefined();
  });

  it('passes through upToLayer when provided', () => {
    const result = buildPlanRequest({
      ...baseOptions,
      upToLayer: 2,
    });

    expect(result.upToLayer).toBe(2);
  });

  it('handles upToLayer=0 correctly', () => {
    const result = buildPlanRequest({
      ...baseOptions,
      upToLayer: 0,
    });

    expect(result.upToLayer).toBe(0);
  });

  it('combines artifacts + upToLayer', () => {
    const result = buildPlanRequest({
      blueprintName: 'my-blueprint',
      movieId: 'movie-456',
      selectedArtifacts: ['Artifact:ScriptProducer.Script[0]'],
      upToLayer: 1,
    });

    expect(result).toEqual({
      blueprint: 'my-blueprint',
      movieId: 'movie-456',
      artifactIds: ['Artifact:ScriptProducer.Script[0]'],
      upToLayer: 1,
    });
  });

  it('ignores dirtyProducers - planner handles dirty detection', () => {
    const result = buildPlanRequest({
      ...baseOptions,
      dirtyProducers: ['AudioProducer', 'VideoProducer'],
    });

    // dirtyProducers should not affect artifactIds
    expect(result.artifactIds).toBeUndefined();
  });
});

describe('isSurgicalMode', () => {
  it('returns true when artifactIds is present and non-empty', () => {
    expect(isSurgicalMode({
      blueprint: 'test',
      artifactIds: ['Artifact:Test[0]'],
    })).toBe(true);
  });

  it('returns false when artifactIds is undefined', () => {
    expect(isSurgicalMode({
      blueprint: 'test',
    })).toBe(false);
  });

  it('returns false when artifactIds is empty array', () => {
    expect(isSurgicalMode({
      blueprint: 'test',
      artifactIds: [],
    })).toBe(false);
  });
});

describe('getPlanSummary', () => {
  it('describes surgical mode with artifact count', () => {
    const summary = getPlanSummary({
      blueprint: 'test',
      artifactIds: ['A', 'B', 'C'],
    });

    expect(summary).toBe('regenerate 3 artifact(s)');
  });

  it('describes run all mode', () => {
    const summary = getPlanSummary({
      blueprint: 'test',
    });

    expect(summary).toBe('run all dirty jobs');
  });

  it('includes layer limit', () => {
    const summary = getPlanSummary({
      blueprint: 'test',
      upToLayer: 2,
    });

    expect(summary).toBe('run all dirty jobs up to layer 2');
  });

  it('combines surgical mode with layer limit', () => {
    const summary = getPlanSummary({
      blueprint: 'test',
      artifactIds: ['A', 'B'],
      upToLayer: 1,
    });

    expect(summary).toBe('regenerate 2 artifact(s) up to layer 1');
  });

  it('handles upToLayer=0', () => {
    const summary = getPlanSummary({
      blueprint: 'test',
      upToLayer: 0,
    });

    expect(summary).toBe('run all dirty jobs up to layer 0');
  });
});
