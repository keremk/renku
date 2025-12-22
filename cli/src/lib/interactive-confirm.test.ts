import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { ExecutionPlan, InputEvent } from '@gorenku/core';
import { confirmPlanExecution } from './interactive-confirm.js';

const mockClose = vi.fn();

// eslint-disable-next-line no-unused-vars
type QuestionCallback = (answer: string) => void;

vi.mock('node:readline', () => ({
  createInterface: () => ({
    question: (_prompt: string, callback: QuestionCallback) => {
      callback('y');
    },
    close: mockClose,
  }),
}));

function createPlan(): ExecutionPlan {
  return {
    revision: 'rev-0001',
    manifestBaseHash: 'base-hash',
    layers: [
      [
        {
          jobId: 'job-1',
          producer: 'ScriptProducer',
          inputs: [],
          produces: [],
          provider: 'openai',
          providerModel: 'gpt-5-mini',
          rateKey: 'openai:gpt-5-mini',
        },
      ],
    ],
    createdAt: new Date().toISOString(),
  };
}

function createMultiLayerPlan(): ExecutionPlan {
  return {
    revision: 'rev-0002',
    manifestBaseHash: 'base-hash',
    layers: [
      [
        {
          jobId: 'job-1',
          producer: 'ScriptProducer',
          inputs: [],
          produces: [],
          provider: 'openai',
          providerModel: 'gpt-5-mini',
          rateKey: 'openai:gpt-5-mini',
        },
      ],
      [],
      [
        {
          jobId: 'job-2',
          producer: 'AudioProducer',
          inputs: [],
          produces: [],
          provider: 'openai',
          providerModel: 'gpt-5-mini',
          rateKey: 'openai:gpt-5-mini',
        },
      ],
    ],
    createdAt: new Date().toISOString(),
  };
}

function createInputs(): InputEvent[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'InquiryPrompt',
      revision: 'rev-0001',
      hash: 'hash-a',
      payload: 'Tell me a story',
      editedBy: 'user',
      createdAt: now,
    },
    {
      id: 'NumOfSegments',
      revision: 'rev-0001',
      hash: 'hash-b',
      payload: 3,
      editedBy: 'user',
      createdAt: now,
    },
  ];
}

describe('confirmPlanExecution', () => {
  beforeEach(() => {
    mockClose.mockClear();
  });

  it('displays execution summary before prompting for confirmation', async () => {
    const infoSpy = vi.fn();
    const logger = {
      info: infoSpy,
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    await confirmPlanExecution(createPlan(), { inputs: createInputs(), logger });
    const logs = infoSpy.mock.calls.map((call) => call[0]);
    expect(logs.find((line) => typeof line === 'string' && line.includes('Execution Plan Summary'))).toBeDefined();
    expect(logs.find((line) => typeof line === 'string' && line.includes('Jobs by Producer'))).toBeDefined();
    expect(logs.find((line) => typeof line === 'string' && line.includes('ScriptProducer'))).toBeDefined();
  });

  it('logs which layers will run when upToLayer is provided', async () => {
    const infoSpy = vi.fn();
    const logger = { info: infoSpy, warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    await confirmPlanExecution(createMultiLayerPlan(), { logger, upToLayer: 0 });
    const message = infoSpy.mock.calls
      .map((call) => call[0])
      .find((line) => typeof line === 'string' && line.includes('Layer limit set'));
    expect(message).toContain('Running 1 layer (layers 0-0)');
  });
});
