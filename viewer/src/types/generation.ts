/**
 * Client-side types for generation functionality.
 */

// =============================================================================
// Producer Status Types
// =============================================================================

/**
 * Status of a producer in the execution flow.
 */
export type ProducerStatus = 'success' | 'error' | 'not-run-yet' | 'running' | 'pending';

/**
 * Map of producer names to their status.
 */
export interface ProducerStatusMap {
  [producerName: string]: ProducerStatus;
}

// =============================================================================
// Execution State Types
// =============================================================================

/**
 * Overall execution status for the UI.
 */
export type ExecutionStatus = 'idle' | 'planning' | 'confirming' | 'executing' | 'completed' | 'failed' | 'cancelled';

/**
 * Layer range for controlling execution scope.
 */
export interface LayerRange {
  upToLayer: number | null;
}

/**
 * Progress information during execution.
 */
export interface ExecutionProgress {
  currentLayer: number;
  totalLayers: number;
  progress: number;
}

// =============================================================================
// Execution Log Types
// =============================================================================

/**
 * Type of log entry for the execution progress panel.
 */
export type ExecutionLogType =
  | 'layer-start'
  | 'layer-complete'
  | 'layer-skipped'
  | 'job-start'
  | 'job-complete'
  | 'error'
  | 'info';

/**
 * Status of a log entry.
 */
export type ExecutionLogStatus = 'running' | 'succeeded' | 'failed' | 'skipped';

/**
 * A single entry in the execution log displayed in the progress panel.
 */
export interface ExecutionLogEntry {
  id: string;
  timestamp: string;
  type: ExecutionLogType;
  layerIndex?: number;
  jobId?: string;
  producer?: string;
  status?: ExecutionLogStatus;
  message: string;
  errorDetails?: string;
}

// =============================================================================
// Plan Display Types
// =============================================================================

/**
 * Cost breakdown entry for display.
 */
export interface ProducerCostEntry {
  name: string;
  count: number;
  cost: number;
  hasPlaceholders: boolean;
  /** Whether this producer has cost data (false means show "N/A") */
  hasCostData: boolean;
}

/**
 * Surgical regeneration display info.
 */
export interface SurgicalDisplayInfo {
  targetArtifactId: string;
  sourceJobId: string;
}

/**
 * Plan information formatted for UI display.
 */
export interface PlanDisplayInfo {
  planId: string;
  movieId: string;
  /** Number of layers with scheduled work (after filtering) */
  layers: number;
  /** Total layers in the full blueprint (for dropdown options) */
  blueprintLayers: number;
  totalJobs: number;
  totalCost: number;
  minCost: number;
  maxCost: number;
  hasPlaceholders: boolean;
  hasRanges: boolean;
  costByProducer: ProducerCostEntry[];
  layerBreakdown: LayerDisplayInfo[];
  /** Surgical regeneration info if present */
  surgicalInfo?: SurgicalDisplayInfo[];
}

/**
 * Layer information for display.
 */
export interface LayerDisplayInfo {
  index: number;
  jobCount: number;
  jobs: LayerJobDisplayInfo[];
  /** Total estimated cost for this layer */
  layerCost: number;
  /** Minimum cost for this layer (when ranges present) */
  layerMinCost: number;
  /** Maximum cost for this layer (when ranges present) */
  layerMaxCost: number;
  /** Whether any job in this layer has placeholder estimates */
  hasPlaceholders: boolean;
}

/**
 * Job information within a layer for display.
 */
export interface LayerJobDisplayInfo {
  jobId: string;
  producer: string;
  estimatedCost?: number;
}

// =============================================================================
// Re-export server types needed on client
// =============================================================================

export type {
  PlanRequest,
  PlanResponse,
  ExecuteRequest,
  ExecuteResponse,
  JobStatusResponse,
  JobDetailInfo,
  LayerInfo,
  LayerJobInfo,
  SSEEvent,
  JobStartEvent,
  JobCompleteEvent,
  LayerStartEvent,
  LayerSkippedEvent,
  LayerCompleteEvent,
  ExecutionCompleteEvent,
  ErrorEvent,
} from '../../server/generation/types';
