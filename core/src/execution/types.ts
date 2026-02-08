import type { StorageContext } from '../storage.js';
import type { EventLog } from '../event-log.js';
import type { ManifestService } from '../manifest.js';
import type { Logger } from '../logger.js';
import type { NotificationBus } from '../notifications.js';
import type {
  Clock,
  ExecutionPlan,
  Manifest,
  ProduceFn,
  RunResult,
} from '../types.js';

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
