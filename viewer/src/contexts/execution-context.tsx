/* eslint-disable react-refresh/only-export-components */
/**
 * React Context for managing execution state.
 * Handles planning, execution, and status tracking for generation runs.
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import {
  createPlan,
  executePlan,
  cancelJob,
  subscribeToJobStream,
} from '@/data/generation-client';
import type {
  ProducerStatus,
  ProducerStatusMap,
  ExecutionStatus,
  LayerRange,
  ExecutionProgress,
  PlanDisplayInfo,
  ProducerCostEntry,
  LayerDisplayInfo,
  PlanResponse,
  SSEEvent,
  ExecutionLogEntry,
} from '@/types/generation';
import type { ArtifactInfo } from '@/types/builds';

// =============================================================================
// State Types
// =============================================================================

interface ExecutionState {
  status: ExecutionStatus;
  layerRange: LayerRange;
  planInfo: PlanDisplayInfo | null;
  currentJobId: string | null;
  progress: ExecutionProgress | null;
  producerStatuses: ProducerStatusMap;
  error: string | null;
  totalLayers: number;
  /** Terminal-like log entries for execution progress */
  executionLogs: ExecutionLogEntry[];
  /** Whether the execution is in the process of stopping */
  isStopping: boolean;
  /** Whether the bottom progress panel is visible */
  bottomPanelVisible: boolean;
  /** Blueprint name used for the current plan (for re-planning) */
  blueprintName: string | null;
  /** Movie ID used for the current plan (for re-planning) */
  movieId: string | null;
}

// =============================================================================
// Action Types
// =============================================================================

type ExecutionAction =
  | { type: 'SET_LAYER_RANGE'; range: LayerRange }
  | { type: 'SET_TOTAL_LAYERS'; totalLayers: number }
  | { type: 'START_PLANNING'; blueprintName: string; movieId: string | null }
  | { type: 'PLAN_READY'; planInfo: PlanDisplayInfo }
  | { type: 'PLAN_FAILED'; error: string }
  | { type: 'START_EXECUTION'; jobId: string }
  | { type: 'UPDATE_PROGRESS'; progress: ExecutionProgress }
  | { type: 'UPDATE_PRODUCER_STATUS'; producer: string; status: ProducerStatus }
  | { type: 'EXECUTION_COMPLETE'; status: 'completed' | 'failed' }
  | { type: 'CANCEL' }
  | { type: 'DISMISS_DIALOG' }
  | { type: 'RESET' }
  | { type: 'INIT_FROM_MANIFEST'; artifacts: ArtifactInfo[] }
  | { type: 'ADD_LOG_ENTRY'; entry: ExecutionLogEntry }
  | { type: 'SET_STOPPING'; isStopping: boolean }
  | { type: 'SHOW_BOTTOM_PANEL' }
  | { type: 'HIDE_BOTTOM_PANEL' }
  | { type: 'CLEAR_LOGS' };

// =============================================================================
// Initial State
// =============================================================================

const initialState: ExecutionState = {
  status: 'idle',
  layerRange: { reRunFrom: null, upToLayer: null },
  planInfo: null,
  currentJobId: null,
  progress: null,
  producerStatuses: {},
  error: null,
  totalLayers: 0,
  executionLogs: [],
  isStopping: false,
  bottomPanelVisible: false,
  blueprintName: null,
  movieId: null,
};

// =============================================================================
// Reducer
// =============================================================================

function executionReducer(
  state: ExecutionState,
  action: ExecutionAction
): ExecutionState {
  switch (action.type) {
    case 'SET_LAYER_RANGE':
      return { ...state, layerRange: action.range };

    case 'SET_TOTAL_LAYERS':
      return { ...state, totalLayers: action.totalLayers };

    case 'START_PLANNING':
      return {
        ...state,
        status: 'planning',
        error: null,
        blueprintName: action.blueprintName,
        movieId: action.movieId,
      };

    case 'PLAN_READY':
      return {
        ...state,
        status: 'confirming',
        planInfo: action.planInfo,
        totalLayers: action.planInfo.layers,
      };

    case 'PLAN_FAILED':
      return { ...state, status: 'failed', error: action.error };

    case 'START_EXECUTION': {
      // Mark all producers in the plan as pending
      const pendingStatuses: ProducerStatusMap = {};
      if (state.planInfo) {
        for (const layer of state.planInfo.layerBreakdown) {
          for (const job of layer.jobs) {
            pendingStatuses[job.producer] = 'pending';
          }
        }
      }
      return {
        ...state,
        status: 'executing',
        currentJobId: action.jobId,
        producerStatuses: { ...state.producerStatuses, ...pendingStatuses },
        progress: { currentLayer: 0, totalLayers: state.planInfo?.layers ?? 0, progress: 0 },
      };
    }

    case 'UPDATE_PROGRESS':
      return { ...state, progress: action.progress };

    case 'UPDATE_PRODUCER_STATUS':
      return {
        ...state,
        producerStatuses: {
          ...state.producerStatuses,
          [action.producer]: action.status,
        },
      };

    case 'EXECUTION_COMPLETE':
      return {
        ...state,
        status: action.status,
        currentJobId: null,
        progress: null,
        isStopping: false,
      };

    case 'CANCEL':
      return {
        ...state,
        status: 'cancelled',
        currentJobId: null,
        progress: null,
        isStopping: false,
      };

    case 'DISMISS_DIALOG':
      return {
        ...state,
        status: 'idle',
        planInfo: null,
        error: null,
      };

    case 'RESET':
      return {
        ...initialState,
        producerStatuses: state.producerStatuses,
        totalLayers: state.totalLayers,
        bottomPanelVisible: state.bottomPanelVisible,
      };

    case 'INIT_FROM_MANIFEST': {
      const statuses = mapArtifactsToProducerStatuses(action.artifacts);
      return {
        ...state,
        producerStatuses: statuses,
      };
    }

    case 'ADD_LOG_ENTRY':
      return {
        ...state,
        executionLogs: [...state.executionLogs, action.entry],
      };

    case 'SET_STOPPING':
      return {
        ...state,
        isStopping: action.isStopping,
      };

    case 'SHOW_BOTTOM_PANEL':
      return {
        ...state,
        bottomPanelVisible: true,
      };

    case 'HIDE_BOTTOM_PANEL':
      return {
        ...state,
        bottomPanelVisible: false,
      };

    case 'CLEAR_LOGS':
      return {
        ...state,
        executionLogs: [],
      };

    default:
      return state;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract producer name from artifact ID.
 * Artifact ID format: "Artifact:ProducerName.OutputName[index]"
 */
function extractProducerFromArtifactId(artifactId: string): string | null {
  const match = artifactId.match(/^Artifact:([^.]+)\./);
  return match ? match[1] : null;
}

/**
 * Map artifact status to producer status.
 */
function mapArtifactStatusToProducerStatus(artifactStatus: string): ProducerStatus {
  switch (artifactStatus) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'error';
    case 'skipped':
      return 'not-run-yet';
    default:
      return 'not-run-yet';
  }
}

/**
 * Map artifacts from manifest to producer statuses.
 * Uses the "worst" status if a producer has multiple artifacts.
 */
function mapArtifactsToProducerStatuses(artifacts: ArtifactInfo[]): ProducerStatusMap {
  const statuses: ProducerStatusMap = {};
  const statusPriority: Record<ProducerStatus, number> = {
    'error': 0,
    'not-run-yet': 1,
    'pending': 2,
    'running': 3,
    'success': 4,
  };

  for (const artifact of artifacts) {
    const producer = extractProducerFromArtifactId(artifact.id);
    if (!producer) continue;

    const newStatus = mapArtifactStatusToProducerStatus(artifact.status);
    const existingStatus = statuses[producer];

    // Keep the "worst" status (lower priority number)
    if (!existingStatus || statusPriority[newStatus] < statusPriority[existingStatus]) {
      statuses[producer] = newStatus;
    }
  }

  return statuses;
}

/**
 * Convert PlanResponse to PlanDisplayInfo for UI consumption.
 */
function planResponseToDisplayInfo(response: PlanResponse): PlanDisplayInfo {
  const costByProducer: ProducerCostEntry[] = [];

  // Build a set of missing providers for checking hasCostData
  const missingProviders = new Set(response.costSummary.missingProviders);

  // byProducer is now always a plain object (Map serialized to object on server)
  const byProducerObj = response.costSummary.byProducer;
  if (byProducerObj && typeof byProducerObj === 'object') {
    for (const [name, data] of Object.entries(byProducerObj)) {
      const producerData = data as { count: number; totalCost: number; hasPlaceholders: boolean };
      // Check if this producer's cost data is valid (not from missing provider)
      // A producer has cost data if its cost is > 0 or it doesn't have placeholders from missing providers
      const hasCostData = producerData.totalCost > 0 || !producerData.hasPlaceholders ||
        !Array.from(missingProviders).some(mp => mp.includes(name) || name.includes(mp.split(':')[0]));
      costByProducer.push({
        name,
        count: producerData.count,
        cost: producerData.totalCost,
        hasPlaceholders: producerData.hasPlaceholders,
        hasCostData,
      });
    }
  }

  const layerBreakdown: LayerDisplayInfo[] = response.layerBreakdown.map((layer) => ({
    index: layer.index,
    jobCount: layer.jobCount,
    jobs: layer.jobs.map((job) => ({
      jobId: job.jobId,
      producer: job.producer,
      estimatedCost: job.estimatedCost,
    })),
    layerCost: layer.layerCost,
    layerMinCost: layer.layerMinCost,
    layerMaxCost: layer.layerMaxCost,
    hasPlaceholders: layer.hasPlaceholders,
  }));

  // Map surgical info if present
  const surgicalInfo = response.surgicalInfo?.map((info) => ({
    targetArtifactId: info.targetArtifactId,
    sourceJobId: info.sourceJobId,
  }));

  return {
    planId: response.planId,
    movieId: response.movieId,
    layers: response.layers,
    totalJobs: response.totalJobs,
    totalCost: response.costSummary.totalCost,
    minCost: response.costSummary.minTotalCost,
    maxCost: response.costSummary.maxTotalCost,
    hasPlaceholders: response.costSummary.hasPlaceholders,
    hasRanges: response.costSummary.hasRanges,
    costByProducer,
    layerBreakdown,
    surgicalInfo,
  };
}

// =============================================================================
// Context Types
// =============================================================================

interface ExecutionContextValue {
  state: ExecutionState;
  setLayerRange: (range: LayerRange) => void;
  setTotalLayers: (totalLayers: number) => void;
  requestPlan: (blueprintName: string, movieId?: string) => Promise<void>;
  /** Re-request the plan with a new reRunFrom value. Used when user adjusts the stage range slider. */
  replanWithRange: (reRunFrom: number | null) => Promise<void>;
  confirmExecution: (dryRun?: boolean) => Promise<void>;
  cancelExecution: () => Promise<void>;
  dismissDialog: () => void;
  initializeFromManifest: (artifacts: ArtifactInfo[]) => void;
  reset: () => void;
  showBottomPanel: () => void;
  hideBottomPanel: () => void;
  clearLogs: () => void;
}

// =============================================================================
// Context
// =============================================================================

const ExecutionContext = createContext<ExecutionContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface ExecutionProviderProps {
  children: ReactNode;
}

export function ExecutionProvider({ children }: ExecutionProviderProps) {
  const [state, dispatch] = useReducer(executionReducer, initialState);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const setLayerRange = useCallback((range: LayerRange) => {
    dispatch({ type: 'SET_LAYER_RANGE', range });
  }, []);

  const setTotalLayers = useCallback((totalLayers: number) => {
    dispatch({ type: 'SET_TOTAL_LAYERS', totalLayers });
  }, []);

  const requestPlan = useCallback(async (blueprintName: string, movieId?: string) => {
    dispatch({ type: 'START_PLANNING', blueprintName, movieId: movieId ?? null });

    try {
      const response = await createPlan({
        blueprint: blueprintName,
        movieId: movieId ?? undefined,
        reRunFrom: state.layerRange.reRunFrom ?? undefined,
      });

      const planInfo = planResponseToDisplayInfo(response);
      dispatch({ type: 'PLAN_READY', planInfo });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create plan';
      dispatch({ type: 'PLAN_FAILED', error: message });
    }
  }, [state.layerRange.reRunFrom]);

  const replanWithRange = useCallback(async (reRunFrom: number | null) => {
    if (!state.blueprintName) {
      console.error('[execution-context] Cannot replan: no blueprint name stored');
      return;
    }

    // Update the layer range first
    dispatch({ type: 'SET_LAYER_RANGE', range: { ...state.layerRange, reRunFrom } });
    dispatch({ type: 'START_PLANNING', blueprintName: state.blueprintName, movieId: state.movieId });

    try {
      const response = await createPlan({
        blueprint: state.blueprintName,
        movieId: state.movieId ?? undefined,
        reRunFrom: reRunFrom ?? undefined,
      });

      const planInfo = planResponseToDisplayInfo(response);
      dispatch({ type: 'PLAN_READY', planInfo });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create plan';
      dispatch({ type: 'PLAN_FAILED', error: message });
    }
  }, [state.blueprintName, state.movieId, state.layerRange]);

  const confirmExecution = useCallback(async (dryRun = false) => {
    if (!state.planInfo) return;

    try {
      const response = await executePlan({
        planId: state.planInfo.planId,
        reRunFrom: state.layerRange.reRunFrom ?? undefined,
        upToLayer: state.layerRange.upToLayer ?? undefined,
        dryRun,
      });

      dispatch({ type: 'START_EXECUTION', jobId: response.jobId });

      // Subscribe to SSE for real-time updates
      unsubscribeRef.current = subscribeToJobStream(
        response.jobId,
        (event: SSEEvent) => {
          handleSSEEvent(event, dispatch);
          // Close SSE connection when execution completes or errors
          if (event.type === 'execution-complete' || event.type === 'error') {
            if (unsubscribeRef.current) {
              unsubscribeRef.current();
              unsubscribeRef.current = null;
            }
          }
        },
        (error) => {
          console.error('SSE error:', error);
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start execution';
      dispatch({ type: 'PLAN_FAILED', error: message });
    }
  }, [state.planInfo, state.layerRange]);

  const cancelExecution = useCallback(async () => {
    if (state.currentJobId) {
      // Set stopping state before cancelling
      dispatch({ type: 'SET_STOPPING', isStopping: true });
      try {
        await cancelJob(state.currentJobId);
      } catch (error) {
        console.error('Failed to cancel job:', error);
      }
    }

    // Clean up SSE subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    dispatch({ type: 'CANCEL' });
  }, [state.currentJobId]);

  const dismissDialog = useCallback(() => {
    dispatch({ type: 'DISMISS_DIALOG' });
  }, []);

  const initializeFromManifest = useCallback((artifacts: ArtifactInfo[]) => {
    dispatch({ type: 'INIT_FROM_MANIFEST', artifacts });
  }, []);

  const reset = useCallback(() => {
    // Clean up SSE subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    dispatch({ type: 'RESET' });
  }, []);

  const showBottomPanel = useCallback(() => {
    dispatch({ type: 'SHOW_BOTTOM_PANEL' });
  }, []);

  const hideBottomPanel = useCallback(() => {
    dispatch({ type: 'HIDE_BOTTOM_PANEL' });
  }, []);

  const clearLogs = useCallback(() => {
    dispatch({ type: 'CLEAR_LOGS' });
  }, []);

  const value: ExecutionContextValue = {
    state,
    setLayerRange,
    setTotalLayers,
    requestPlan,
    replanWithRange,
    confirmExecution,
    cancelExecution,
    dismissDialog,
    initializeFromManifest,
    reset,
    showBottomPanel,
    hideBottomPanel,
    clearLogs,
  };

  return (
    <ExecutionContext.Provider value={value}>
      {children}
    </ExecutionContext.Provider>
  );
}

// =============================================================================
// SSE Event Handler
// =============================================================================

/**
 * Generate a unique ID for log entries.
 */
function generateLogId(): string {
  return `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a log entry from an SSE event.
 */
function createLogEntry(
  type: ExecutionLogEntry['type'],
  message: string,
  options?: Partial<ExecutionLogEntry>
): ExecutionLogEntry {
  return {
    id: generateLogId(),
    timestamp: new Date().toISOString(),
    type,
    message,
    ...options,
  };
}

function handleSSEEvent(event: SSEEvent, dispatch: React.Dispatch<ExecutionAction>) {
  switch (event.type) {
    case 'layer-start': {
      const logEntry = createLogEntry(
        'layer-start',
        `--- Layer ${event.layerIndex}, will run ${event.jobCount} job${event.jobCount === 1 ? '' : 's'} ---`,
        { layerIndex: event.layerIndex }
      );
      dispatch({ type: 'ADD_LOG_ENTRY', entry: logEntry });
      // Update progress
      dispatch({
        type: 'UPDATE_PROGRESS',
        progress: {
          currentLayer: event.layerIndex,
          totalLayers: 0, // Will be set from plan info
          progress: 0,
        },
      });
      break;
    }

    case 'layer-skipped': {
      const logEntry = createLogEntry(
        'layer-skipped',
        `Layer ${event.layerIndex} skipped (using existing artifacts)`,
        { layerIndex: event.layerIndex, status: 'skipped' }
      );
      dispatch({ type: 'ADD_LOG_ENTRY', entry: logEntry });
      break;
    }

    case 'job-start': {
      dispatch({
        type: 'UPDATE_PRODUCER_STATUS',
        producer: event.producer,
        status: 'running',
      });
      const logEntry = createLogEntry(
        'job-start',
        `Starting ${event.producer}...`,
        { jobId: event.jobId, producer: event.producer, layerIndex: event.layerIndex, status: 'running' }
      );
      dispatch({ type: 'ADD_LOG_ENTRY', entry: logEntry });
      break;
    }

    case 'job-complete': {
      const producerStatus = event.status === 'succeeded' ? 'success' : event.status === 'failed' ? 'error' : 'not-run-yet';
      dispatch({
        type: 'UPDATE_PRODUCER_STATUS',
        producer: event.producer,
        status: producerStatus,
      });
      const statusIcon = event.status === 'succeeded' ? '✓' : event.status === 'failed' ? '✗' : '○';
      const statusLabel = event.status === 'succeeded' ? 'completed successfully' : event.status === 'failed' ? 'failed' : 'skipped';
      const logEntry = createLogEntry(
        'job-complete',
        `${event.producer} ${statusLabel} ${statusIcon}`,
        {
          jobId: event.jobId,
          producer: event.producer,
          status: event.status as ExecutionLogEntry['status'],
          errorDetails: event.errorMessage,
        }
      );
      dispatch({ type: 'ADD_LOG_ENTRY', entry: logEntry });
      break;
    }

    case 'layer-complete': {
      const logEntry = createLogEntry(
        'layer-complete',
        `Layer ${event.layerIndex} complete: ${event.succeeded} succeeded, ${event.failed} failed, ${event.skipped} skipped`,
        { layerIndex: event.layerIndex }
      );
      dispatch({ type: 'ADD_LOG_ENTRY', entry: logEntry });
      break;
    }

    case 'execution-complete': {
      const statusLabel = event.status === 'succeeded' ? 'Execution completed successfully' :
                          event.status === 'partial' ? 'Execution completed with some failures' :
                          'Execution failed';
      const logEntry = createLogEntry(
        'info',
        `${statusLabel} (${event.summary.counts.succeeded} succeeded, ${event.summary.counts.failed} failed, ${event.summary.counts.skipped} skipped)`
      );
      dispatch({ type: 'ADD_LOG_ENTRY', entry: logEntry });
      dispatch({
        type: 'EXECUTION_COMPLETE',
        status: event.status === 'succeeded' ? 'completed' : 'failed',
      });
      break;
    }

    case 'error': {
      const logEntry = createLogEntry(
        'error',
        event.message,
        { errorDetails: event.code }
      );
      dispatch({ type: 'ADD_LOG_ENTRY', entry: logEntry });
      dispatch({ type: 'PLAN_FAILED', error: event.message });
      break;
    }
  }
}

// =============================================================================
// Hook
// =============================================================================

export function useExecution(): ExecutionContextValue {
  const context = useContext(ExecutionContext);
  if (!context) {
    throw new Error('useExecution must be used within an ExecutionProvider');
  }
  return context;
}
