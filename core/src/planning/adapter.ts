import { createPlanner } from './planner.js';
import type { EventLog } from '../event-log.js';
import type { Logger } from '../logger.js';
import type {
  Clock,
  ExecutionPlan,
  InputEvent,
  Manifest,
  ProducerGraph,
  RevisionId,
} from '../types.js';

export interface PlanAdapterArgs {
  movieId: string;
  manifest: Manifest | null;
  eventLog: EventLog;
  blueprint: ProducerGraph;
  targetRevision: RevisionId;
  pendingEdits?: InputEvent[];
}

export type PlanAdapter = {
  // eslint-disable-next-line no-unused-vars
  compute: (_args: PlanAdapterArgs) => Promise<ExecutionPlan>;
};

export interface PlanAdapterOptions {
  logger?: Partial<Logger>;
  clock?: Clock;
  notifications?: import('../notifications.js').NotificationBus;
}

export function createPlanAdapter(options: PlanAdapterOptions = {}): PlanAdapter {
  const planner = createPlanner({
    logger: options.logger,
    clock: options.clock,
    notifications: options.notifications,
  });

  return {
    async compute(args: PlanAdapterArgs): Promise<ExecutionPlan> {
      return planner.computePlan(args);
    },
  };
}
