import type { StorageContext } from '../storage.js';
import type { EventLog } from '../event-log.js';
import type { ManifestService } from '../manifest.js';
import type { Logger } from '../logger.js';
import type { NotificationBus } from '../notifications.js';
import type {
  Clock,
  ExecutionPlan,
  InputEvent,
  Manifest,
  ProduceFn,
  RevisionId,
  RunResult,
} from '../types.js';
import type { ProducerOptionsMap } from '../orchestration/producer-options.js';

/**
 * Context for plan execution containing all required services.
 */
export interface PlanExecutionContext {
  movieId: string;
  manifest: Manifest;
  storage: StorageContext;
  eventLog: EventLog;
  manifestService: ManifestService;
  /** ProduceFn injected by caller (from providers package) */
  produce: ProduceFn;
  logger?: Partial<Logger>;
  clock?: Clock;
  notifications?: NotificationBus;
}

/**
 * Options for creating an ExecutionService.
 */
export interface ExecutionServiceOptions {
  storage: StorageContext;
  logger?: Logger;
  notifications?: NotificationBus;
  clock?: Clock;
}

/**
 * Options for preparing a plan.
 */
export interface PreparePlanOptions {
  movieId: string;
  blueprintPath: string;
  inputsPath: string;
  catalogRoot?: string;
  isNew: boolean;
  targetArtifactIds?: string[];
  reRunFrom?: number;
}

/**
 * Information about surgical regeneration targets.
 */
export interface SurgicalInfo {
  artifactId: string;
  jobId: string;
  layer: number;
}

/**
 * Summary of estimated costs for a plan.
 */
export interface PlanCostSummary {
  totalEstimatedCost: number;
  totalJobs: number;
  layerBreakdown: LayerCostBreakdown[];
}

export interface LayerCostBreakdown {
  layerIndex: number;
  jobCount: number;
  estimatedCost: number;
  producers: ProducerCostBreakdown[];
}

export interface ProducerCostBreakdown {
  producer: string;
  provider: string;
  model: string;
  count: number;
  estimatedCost: number;
}

/**
 * Result of preparing a plan.
 */
export interface PreparePlanResult {
  plan: ExecutionPlan;
  manifest: Manifest;
  manifestHash: string | null;
  resolvedInputs: Record<string, unknown>;
  providerOptions: ProducerOptionsMap;
  inputEvents: InputEvent[];
  costSummary: PlanCostSummary;
  blueprintPath: string;
  targetRevision: RevisionId;
  surgicalInfo?: SurgicalInfo[];
  /**
   * Persist the plan and input events to storage.
   * Call this to save the plan before execution.
   */
  persist: () => Promise<void>;
}

/**
 * Options for executing a prepared plan.
 */
export interface ExecutePlanOptions {
  movieId: string;
  plan: ExecutionPlan;
  manifest: Manifest;
  manifestHash: string | null;
  /** ProduceFn injected by caller (from providers package) */
  produce: ProduceFn;
  resolvedInputs: Record<string, unknown>;
  concurrency?: number;
  upToLayer?: number;
  reRunFrom?: number;
  targetArtifactIds?: string[];
  dryRun?: boolean;
  /** AbortSignal for cancellation support */
  signal?: AbortSignal;
}

/**
 * Summary of a job's execution.
 */
export interface JobSummary {
  jobId: string;
  producer: string;
  status: 'succeeded' | 'failed' | 'skipped';
  layerIndex: number;
  errorMessage?: string;
}

/**
 * Result of executing a plan.
 */
export interface ExecutePlanResult {
  status: 'succeeded' | 'failed' | 'cancelled';
  run: RunResult;
  manifest: Manifest;
  manifestPath: string;
  manifestHash: string;
  jobs: JobSummary[];
  dryRun: boolean;
}

/**
 * Types of progress events emitted during execution.
 */
export type ProgressEventType =
  | 'plan-ready'
  | 'layer-start'
  | 'layer-empty'
  | 'layer-skipped'
  | 'job-start'
  | 'job-complete'
  | 'layer-complete'
  | 'execution-complete'
  | 'error';

/**
 * Progress event emitted during plan execution.
 */
export interface ProgressEvent {
  type: ProgressEventType;
  timestamp: string;
  layerIndex?: number;
  totalLayers?: number;
  jobId?: string;
  producer?: string;
  status?: 'running' | 'succeeded' | 'failed' | 'skipped';
  artifact?: { id: string; mimeType?: string };
  error?: { message: string; code?: string };
  progress?: { completed: number; total: number };
  message?: string;
}

/**
 * Handler for progress events.
 */
export type ProgressHandler = (event: ProgressEvent) => void;

/**
 * Options for executePlanWithConcurrency.
 */
export interface ExecutePlanWithConcurrencyOptions {
  concurrency: number;
  upToLayer?: number;
  reRunFrom?: number;
  signal?: AbortSignal;
  onProgress?: ProgressHandler;
}
