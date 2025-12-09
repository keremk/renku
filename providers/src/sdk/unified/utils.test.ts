import { describe, expect, it } from 'vitest';
import { extractPlannerContext } from './utils.js';
import type { ProviderJobContext } from '../../types.js';

function makeRequest(
  extras: Record<string, unknown> | undefined,
): ProviderJobContext {
  return {
    jobId: 'job-ctx',
    provider: 'replicate',
    model: 'model/test',
    revision: 'rev-test',
    layerIndex: 0,
    attempt: 1,
    inputs: [],
    produces: [],
    context: {
      providerConfig: {},
      rawAttachments: [],
      environment: 'local',
      observability: undefined,
      extras,
    },
  };
}

describe('extractPlannerContext', () => {
  it('extracts planner context from valid request', () => {
    const request = makeRequest({
      plannerContext: {
        index: {
          segment: 0,
          image: 1,
        },
        customField: 'value',
      },
    });

    const result = extractPlannerContext(request);

    expect(result).toEqual({
      index: {
        segment: 0,
        image: 1,
      },
      customField: 'value',
    });
  });

  it('returns empty object when extras is null', () => {
    const request = makeRequest(undefined);
    const result = extractPlannerContext(request);

    expect(result).toEqual({});
  });

  it('returns empty object when extras is undefined', () => {
    const request = makeRequest(undefined);
    const result = extractPlannerContext(request);

    expect(result).toEqual({});
  });

  it('returns empty object when plannerContext is missing', () => {
    const request = makeRequest({ otherField: 'value' });
    const result = extractPlannerContext(request);

    expect(result).toEqual({});
  });

  it('returns empty object when plannerContext is not an object', () => {
    const request = makeRequest({ plannerContext: 'not an object' });
    const result = extractPlannerContext(request);

    expect(result).toEqual({});
  });

  it('handles planner context with only segment index', () => {
    const request = makeRequest({
      plannerContext: { index: { segment: 5 } },
    });
    const result = extractPlannerContext(request);

    expect(result).toEqual({
      index: {
        segment: 5,
      },
    });
  });

  it('handles planner context with only image index', () => {
    const request = makeRequest({
      plannerContext: { index: { image: 2 } },
    });
    const result = extractPlannerContext(request);

    expect(result).toEqual({
      index: {
        image: 2,
      },
    });
  });

  it('handles planner context without index field', () => {
    const request = makeRequest({
      plannerContext: { someOtherField: 'value' },
    });
    const result = extractPlannerContext(request);

    expect(result).toEqual({
      someOtherField: 'value',
    });
  });
});
