/**
 * API types for the viewer generation endpoints.
 * These expose the same capabilities as the CLI `generate` command.
 */

import type { ExecutionPlan, Manifest } from '@gorenku/core';
import type { PlanCostSummary } from '@gorenku/providers';

// =============================================================================
// Request Types
// =============================================================================

/**
 * Request for POST /viewer-api/generate/plan
 * Creates an execution plan with cost estimation (does not execute).
 */
export interface PlanRequest {
  /** Blueprint name (e.g., "my-blueprint"). Resolves to: storage.root/blueprints/<name>/blueprint.yaml */
  blueprint: string;
  /** Optional: inputs file name (default: "inputs.yaml"). Resolves to: storage.root/blueprints/<blueprint>/<inputs> */
  inputs?: string;
  /** For regeneration: existing movie ID */
  movieId?: string;
  /** Layer to restart from (0-indexed) */
  reRunFrom?: number;
  /** Surgical regeneration targets (canonical format, e.g., ["Artifact:AudioProducer.GeneratedAudio[0]"]) */
  artifactIds?: string[];
}

/**
 * Request for POST /viewer-api/generate/execute
 * Executes a prepared plan. Returns immediately with job ID.
 */
export interface ExecuteRequest {
  /** Plan ID from the plan response */
  planId: string;
  /** Concurrency level (default: from CLI config or 1) */
  concurrency?: number;
  /** Stop at layer N */
  upToLayer?: number;
  /** Enable dry-run mode: simulated providers, no actual API calls */
  dryRun?: boolean;
}

/**
 * Request for POST /viewer-api/generate/jobs/:jobId/cancel
 */
export interface CancelRequest {
  jobId: string;
}

// =============================================================================
// Response Types
// =============================================================================

/**
 * Response from POST /viewer-api/generate/plan
 */
export interface PlanResponse {
  planId: string;
  movieId: string;
  revision: string;
  blueprintPath: string;
  /** Number of layers in the execution plan */
  layers: number;
  /** Total number of jobs across all layers */
  totalJobs: number;
  /** Cost estimation summary */
  costSummary: PlanCostSummary;
  /** Layer breakdown for display */
  layerBreakdown: LayerInfo[];
  /** Surgical regeneration info if artifactIds was provided */
  surgicalInfo?: SurgicalInfo[];
  /** Timestamp when this plan expires from cache */
  expiresAt: string;
}

/**
 * Layer information for plan display.
 */
export interface LayerInfo {
  index: number;
  jobCount: number;
  jobs: LayerJobInfo[];
}

/**
 * Job information within a layer.
 */
export interface LayerJobInfo {
  jobId: string;
  producer: string;
  /** Estimated cost for this job (if available) */
  estimatedCost?: number;
}

/**
 * Surgical regeneration info.
 */
export interface SurgicalInfo {
  targetArtifactId: string;
  sourceJobId: string;
}

/**
 * Response from POST /viewer-api/generate/execute
 */
export interface ExecuteResponse {
  jobId: string;
  movieId: string;
  status: JobStatus;
  /** SSE stream URL for progress events */
  streamUrl: string;
  /** Timestamp when execution started */
  startedAt: string;
}

/**
 * Response from GET /viewer-api/generate/jobs
 */
export interface JobsListResponse {
  jobs: JobInfo[];
}

/**
 * Job summary for list view.
 */
export interface JobInfo {
  jobId: string;
  movieId: string;
  status: JobStatus;
  startedAt: string;
  completedAt?: string;
  /** Progress percentage (0-100) */
  progress?: number;
  /** Current layer being executed */
  currentLayer?: number;
  /** Total layers in plan */
  totalLayers?: number;
}

/**
 * Response from GET /viewer-api/generate/jobs/:jobId
 */
export interface JobStatusResponse {
  jobId: string;
  movieId: string;
  status: JobStatus;
  startedAt: string;
  completedAt?: string;
  progress?: number;
  currentLayer?: number;
  totalLayers?: number;
  /** Job-level details */
  jobDetails?: JobDetailInfo[];
  /** Error message if failed */
  error?: string;
  /** Build summary if completed */
  summary?: BuildSummaryInfo;
}

/**
 * Detailed job information.
 */
export interface JobDetailInfo {
  jobId: string;
  producer: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  layerIndex: number;
  errorMessage?: string;
}

/**
 * Build summary after completion.
 */
export interface BuildSummaryInfo {
  status: 'succeeded' | 'failed' | 'partial';
  jobCount: number;
  counts: {
    succeeded: number;
    failed: number;
    skipped: number;
  };
  manifestRevision: string;
  manifestPath: string;
}

/**
 * Job execution status.
 */
export type JobStatus = 'pending' | 'planning' | 'running' | 'completed' | 'failed' | 'cancelled';

// =============================================================================
// SSE Event Types
// =============================================================================

/**
 * Base interface for SSE events.
 */
export interface SSEEventBase {
  type: string;
  timestamp: string;
}

/**
 * Plan ready event.
 */
export interface PlanReadyEvent extends SSEEventBase {
  type: 'plan-ready';
  planId: string;
  totalLayers: number;
  totalJobs: number;
}

/**
 * Layer start event.
 */
export interface LayerStartEvent extends SSEEventBase {
  type: 'layer-start';
  layerIndex: number;
  jobCount: number;
}

/**
 * Job start event.
 */
export interface JobStartEvent extends SSEEventBase {
  type: 'job-start';
  jobId: string;
  producer: string;
  layerIndex: number;
}

/**
 * Job complete event.
 */
export interface JobCompleteEvent extends SSEEventBase {
  type: 'job-complete';
  jobId: string;
  producer: string;
  status: 'succeeded' | 'failed' | 'skipped';
  errorMessage?: string;
}

/**
 * Layer complete event.
 */
export interface LayerCompleteEvent extends SSEEventBase {
  type: 'layer-complete';
  layerIndex: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

/**
 * Execution complete event.
 */
export interface ExecutionCompleteEvent extends SSEEventBase {
  type: 'execution-complete';
  status: 'succeeded' | 'failed' | 'partial';
  summary: BuildSummaryInfo;
}

/**
 * Error event.
 */
export interface ErrorEvent extends SSEEventBase {
  type: 'error';
  message: string;
  code?: string;
}

/**
 * Union type for all SSE events.
 */
export type SSEEvent =
  | PlanReadyEvent
  | LayerStartEvent
  | JobStartEvent
  | JobCompleteEvent
  | LayerCompleteEvent
  | ExecutionCompleteEvent
  | ErrorEvent;

// =============================================================================
// Internal Types (not exposed via API)
// =============================================================================

/**
 * Cached plan data stored in the job manager.
 */
export interface CachedPlan {
  planId: string;
  movieId: string;
  plan: ExecutionPlan;
  manifest: Manifest;
  manifestHash: string | null;
  resolvedInputs: Record<string, unknown>;
  providerOptions: Map<string, unknown>;
  blueprintPath: string;
  costSummary: PlanCostSummary;
  catalogModelsDir?: string;
  surgicalInfo?: SurgicalInfo[];
  /** When this plan was created */
  createdAt: Date;
  /** When this plan expires */
  expiresAt: Date;
  /** Async persist function from planner */
  persist: () => Promise<void>;
}

/**
 * Execution job data stored in the job manager.
 */
export interface ExecutionJob {
  jobId: string;
  movieId: string;
  planId: string;
  status: JobStatus;
  startedAt: Date;
  completedAt?: Date;
  progress: number;
  currentLayer: number;
  totalLayers: number;
  jobDetails: JobDetailInfo[];
  error?: string;
  summary?: BuildSummaryInfo;
  /** AbortController for cancellation */
  abortController: AbortController;
  /** SSE subscribers for this job */
  subscribers: Set<(event: SSEEvent) => void>;
}
