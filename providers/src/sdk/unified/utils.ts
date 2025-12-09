import type { ProviderJobContext } from '../../types.js';

export interface PlannerContext {
  index?: {
    segment?: number;
    image?: number;
  };
  [key: string]: unknown;
}

/**
 * Extracts planner context from provider job context.
 */
export function extractPlannerContext(request: ProviderJobContext): PlannerContext {
  const extras = request.context.extras;
  const planner = extras && typeof extras === 'object' ? (extras as Record<string, unknown>).plannerContext : null;
  return planner && typeof planner === 'object' ? (planner as PlannerContext) : {};
}
