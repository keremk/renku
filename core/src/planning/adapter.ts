import { createPlanner, type ComputePlanResult } from './planner.js';
import type { EventLog } from '../event-log.js';
import type { Logger } from '../logger.js';
import type {
  ArtifactRegenerationConfig,
  Clock,
  ExecutionPlan,
  InputEvent,
  Manifest,
  ProducerGraph,
  RevisionId,
} from '../types.js';
import type { PlanExplanation } from './explanation.js';

export interface PlanAdapterArgs {
  movieId: string;
  manifest: Manifest | null;
  eventLog: EventLog;
  blueprint: ProducerGraph;
  targetRevision: RevisionId;
  pendingEdits?: InputEvent[];
  /** Force re-run from this layer index onwards (0-indexed). Jobs at this layer and above will be included in the plan. */
  reRunFrom?: number;
  /** Surgical artifact regeneration configs - regenerate only the target artifacts and downstream dependencies. */
  artifactRegenerations?: ArtifactRegenerationConfig[];
  /** Limit plan to layers 0 through upToLayer (0-indexed). Jobs in later layers are excluded from the plan. */
  upToLayer?: number;
  /** If true, collect explanation data for why jobs are scheduled */
  collectExplanation?: boolean;
}

export interface PlanAdapterResult {
  plan: ExecutionPlan;
  /** Explanation of why jobs were scheduled (only if collectExplanation was true) */
  explanation?: PlanExplanation;
}

export type PlanAdapter = {
  // eslint-disable-next-line no-unused-vars
  compute: (_args: PlanAdapterArgs) => Promise<PlanAdapterResult>;
};

export interface PlanAdapterOptions {
  logger?: Partial<Logger>;
  clock?: Clock;
  notifications?: import('../notifications.js').NotificationBus;
  /** If true, collect explanation data for why jobs are scheduled */
  collectExplanation?: boolean;
}

export function createPlanAdapter(options: PlanAdapterOptions = {}): PlanAdapter {
  const planner = createPlanner({
    logger: options.logger,
    clock: options.clock,
    notifications: options.notifications,
    collectExplanation: options.collectExplanation,
  });

  return {
    async compute(args: PlanAdapterArgs): Promise<PlanAdapterResult> {
      const result: ComputePlanResult = await planner.computePlan(args);
      return result;
    },
  };
}
