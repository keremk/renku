import { describe, expect, it } from 'vitest';
import {
  validateStageRange,
  isValidStartStage,
  getValidStartStages,
  deriveStageStatuses,
  deriveStageStatusesFromDisplayInfo,
  type StageRange,
  type StageValidationContext,
} from './stage-range-validator.js';

// =============================================================================
// validateStageRange Tests
// =============================================================================

describe('validateStageRange', () => {
  describe('bounds validation', () => {
    it('rejects negative start stage', () => {
      const range: StageRange = { startStage: -1, endStage: 3 };
      const context: StageValidationContext = { totalStages: 5, stageStatuses: null };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('bounds');
      expect(result.issues[0].message).toContain('negative');
    });

    it('rejects end stage exceeding total stages', () => {
      const range: StageRange = { startStage: 0, endStage: 5 };
      const context: StageValidationContext = { totalStages: 5, stageStatuses: null };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('bounds');
      expect(result.issues[0].message).toContain('exceeds');
    });

    it('allows end stage equal to last index', () => {
      const range: StageRange = { startStage: 0, endStage: 4 };
      const context: StageValidationContext = { totalStages: 5, stageStatuses: null };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('contiguity validation', () => {
    it('rejects start stage after end stage', () => {
      const range: StageRange = { startStage: 3, endStage: 1 };
      const context: StageValidationContext = {
        totalStages: 5,
        stageStatuses: ['succeeded', 'succeeded', 'succeeded', 'succeeded', 'succeeded'],
      };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(false);
      expect(result.issues.some((i) => i.type === 'non-contiguous')).toBe(true);
    });

    it('allows single stage range (start equals end)', () => {
      const range: StageRange = { startStage: 2, endStage: 2 };
      const context: StageValidationContext = {
        totalStages: 5,
        stageStatuses: ['succeeded', 'succeeded', 'not-run', 'not-run', 'not-run'],
      };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('clean run validation', () => {
    it('requires start from stage 0 for clean runs', () => {
      const range: StageRange = { startStage: 2, endStage: 4 };
      const context: StageValidationContext = { totalStages: 5, stageStatuses: null };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('clean-run');
    });

    it('allows starting from stage 0 for clean runs', () => {
      const range: StageRange = { startStage: 0, endStage: 4 };
      const context: StageValidationContext = { totalStages: 5, stageStatuses: null };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('predecessor validation', () => {
    it('allows starting from stage 0 regardless of status', () => {
      const range: StageRange = { startStage: 0, endStage: 4 };
      const context: StageValidationContext = {
        totalStages: 5,
        stageStatuses: ['failed', 'not-run', 'not-run', 'not-run', 'not-run'],
      };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(true);
    });

    it('allows starting from stage N when stage N-1 succeeded', () => {
      const range: StageRange = { startStage: 2, endStage: 4 };
      const context: StageValidationContext = {
        totalStages: 5,
        stageStatuses: ['succeeded', 'succeeded', 'not-run', 'not-run', 'not-run'],
      };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(true);
    });

    it('rejects starting from stage N when stage N-1 failed', () => {
      const range: StageRange = { startStage: 2, endStage: 4 };
      const context: StageValidationContext = {
        totalStages: 5,
        stageStatuses: ['succeeded', 'failed', 'not-run', 'not-run', 'not-run'],
      };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('predecessor-not-succeeded');
      expect(result.issues[0].message).toContain('stage 1');
      expect(result.issues[0].message).toContain('failed');
    });

    it('rejects starting from stage N when stage N-1 has not run', () => {
      const range: StageRange = { startStage: 2, endStage: 4 };
      const context: StageValidationContext = {
        totalStages: 5,
        stageStatuses: ['succeeded', 'not-run', 'not-run', 'not-run', 'not-run'],
      };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].type).toBe('predecessor-not-succeeded');
    });
  });

  describe('edge cases', () => {
    it('handles single stage total', () => {
      const range: StageRange = { startStage: 0, endStage: 0 };
      const context: StageValidationContext = { totalStages: 1, stageStatuses: null };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(true);
    });

    it('reports multiple issues when multiple validations fail', () => {
      const range: StageRange = { startStage: -1, endStage: 10 };
      const context: StageValidationContext = { totalStages: 5, stageStatuses: null };

      const result = validateStageRange(range, context);

      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// =============================================================================
// isValidStartStage Tests
// =============================================================================

describe('isValidStartStage', () => {
  it('returns false for negative index', () => {
    const context: StageValidationContext = { totalStages: 5, stageStatuses: null };
    expect(isValidStartStage(-1, context)).toBe(false);
  });

  it('returns false for index beyond total stages', () => {
    const context: StageValidationContext = { totalStages: 5, stageStatuses: null };
    expect(isValidStartStage(5, context)).toBe(false);
  });

  it('returns true only for stage 0 on clean runs', () => {
    const context: StageValidationContext = { totalStages: 5, stageStatuses: null };

    expect(isValidStartStage(0, context)).toBe(true);
    expect(isValidStartStage(1, context)).toBe(false);
    expect(isValidStartStage(2, context)).toBe(false);
  });

  it('returns true for stage 0 even if previous run failed', () => {
    const context: StageValidationContext = {
      totalStages: 3,
      stageStatuses: ['failed', 'not-run', 'not-run'],
    };
    expect(isValidStartStage(0, context)).toBe(true);
  });

  it('returns true for stage N when stage N-1 succeeded', () => {
    const context: StageValidationContext = {
      totalStages: 3,
      stageStatuses: ['succeeded', 'succeeded', 'not-run'],
    };

    expect(isValidStartStage(0, context)).toBe(true);
    expect(isValidStartStage(1, context)).toBe(true);
    expect(isValidStartStage(2, context)).toBe(true);
  });

  it('returns false for stage N when stage N-1 failed', () => {
    const context: StageValidationContext = {
      totalStages: 3,
      stageStatuses: ['succeeded', 'failed', 'not-run'],
    };

    expect(isValidStartStage(0, context)).toBe(true);
    expect(isValidStartStage(1, context)).toBe(true); // stage 0 succeeded
    expect(isValidStartStage(2, context)).toBe(false); // stage 1 failed
  });
});

// =============================================================================
// getValidStartStages Tests
// =============================================================================

describe('getValidStartStages', () => {
  it('returns only stage 0 for clean runs', () => {
    const context: StageValidationContext = { totalStages: 5, stageStatuses: null };

    const validStages = getValidStartStages(context);

    expect(validStages.size).toBe(1);
    expect(validStages.has(0)).toBe(true);
  });

  it('returns consecutive stages from 0 while predecessors succeeded', () => {
    const context: StageValidationContext = {
      totalStages: 5,
      stageStatuses: ['succeeded', 'succeeded', 'failed', 'not-run', 'not-run'],
    };

    const validStages = getValidStartStages(context);

    expect(validStages.has(0)).toBe(true);
    expect(validStages.has(1)).toBe(true);
    expect(validStages.has(2)).toBe(true); // stage 1 succeeded
    expect(validStages.has(3)).toBe(false); // stage 2 failed
    expect(validStages.has(4)).toBe(false);
  });

  it('returns all stages when all predecessors succeeded', () => {
    const context: StageValidationContext = {
      totalStages: 4,
      stageStatuses: ['succeeded', 'succeeded', 'succeeded', 'succeeded'],
    };

    const validStages = getValidStartStages(context);

    expect(validStages.size).toBe(4);
  });
});

// =============================================================================
// deriveStageStatuses Tests
// =============================================================================

describe('deriveStageStatuses', () => {
  it('returns succeeded for empty layers', () => {
    const producersByLayer = [[], ['ProducerA']];
    const artifactStatuses = new Map<string, 'succeeded' | 'failed'>([
      ['ProducerA', 'succeeded'],
    ]);

    const statuses = deriveStageStatuses(producersByLayer, artifactStatuses);

    expect(statuses[0]).toBe('succeeded'); // empty layer
    expect(statuses[1]).toBe('succeeded');
  });

  it('returns not-run when no producers have run', () => {
    const producersByLayer = [['ProducerA', 'ProducerB']];
    const artifactStatuses = new Map<string, 'succeeded' | 'failed'>();

    const statuses = deriveStageStatuses(producersByLayer, artifactStatuses);

    expect(statuses[0]).toBe('not-run');
  });

  it('returns succeeded when all producers succeeded', () => {
    const producersByLayer = [['ProducerA', 'ProducerB']];
    const artifactStatuses = new Map<string, 'succeeded' | 'failed'>([
      ['ProducerA', 'succeeded'],
      ['ProducerB', 'succeeded'],
    ]);

    const statuses = deriveStageStatuses(producersByLayer, artifactStatuses);

    expect(statuses[0]).toBe('succeeded');
  });

  it('returns failed when any producer failed', () => {
    const producersByLayer = [['ProducerA', 'ProducerB']];
    const artifactStatuses = new Map<string, 'succeeded' | 'failed'>([
      ['ProducerA', 'succeeded'],
      ['ProducerB', 'failed'],
    ]);

    const statuses = deriveStageStatuses(producersByLayer, artifactStatuses);

    expect(statuses[0]).toBe('failed');
  });

  it('returns not-run for partial execution (some ran, some did not)', () => {
    const producersByLayer = [['ProducerA', 'ProducerB']];
    const artifactStatuses = new Map<string, 'succeeded' | 'failed'>([
      ['ProducerA', 'succeeded'],
      // ProducerB not in map (didn't run)
    ]);

    const statuses = deriveStageStatuses(producersByLayer, artifactStatuses);

    expect(statuses[0]).toBe('not-run'); // conservative approach
  });

  it('handles multiple layers correctly', () => {
    const producersByLayer = [
      ['Layer0Producer'],
      ['Layer1ProducerA', 'Layer1ProducerB'],
      ['Layer2Producer'],
    ];
    const artifactStatuses = new Map<string, 'succeeded' | 'failed'>([
      ['Layer0Producer', 'succeeded'],
      ['Layer1ProducerA', 'succeeded'],
      ['Layer1ProducerB', 'failed'],
      // Layer2Producer not run
    ]);

    const statuses = deriveStageStatuses(producersByLayer, artifactStatuses);

    expect(statuses[0]).toBe('succeeded');
    expect(statuses[1]).toBe('failed'); // one producer failed
    expect(statuses[2]).toBe('not-run');
  });
});

// =============================================================================
// deriveStageStatusesFromDisplayInfo Tests
// =============================================================================

describe('deriveStageStatusesFromDisplayInfo', () => {
  it('extracts producer from artifact ID correctly', () => {
    const layerBreakdown = [
      { jobs: [{ producer: 'TextGenerator' }] },
    ];
    const artifacts = [
      { id: 'Artifact:TextGenerator.Output[0]', status: 'succeeded' },
    ];

    const statuses = deriveStageStatusesFromDisplayInfo(layerBreakdown, artifacts);

    expect(statuses[0]).toBe('succeeded');
  });

  it('handles multiple artifacts from same producer', () => {
    const layerBreakdown = [
      { jobs: [{ producer: 'MultiOutput' }] },
    ];
    const artifacts = [
      { id: 'Artifact:MultiOutput.Image[0]', status: 'succeeded' },
      { id: 'Artifact:MultiOutput.Video[0]', status: 'failed' },
    ];

    const statuses = deriveStageStatusesFromDisplayInfo(layerBreakdown, artifacts);

    // Should take worst status (failed)
    expect(statuses[0]).toBe('failed');
  });

  it('maps to not-run when artifact status is missing', () => {
    const layerBreakdown = [
      { jobs: [{ producer: 'NotRun' }] },
    ];
    const artifacts: Array<{ id: string; status: string }> = [];

    const statuses = deriveStageStatusesFromDisplayInfo(layerBreakdown, artifacts);

    expect(statuses[0]).toBe('not-run');
  });
});
