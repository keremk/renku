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
}

// =============================================================================
// Action Types
// =============================================================================

type ExecutionAction =
  | { type: 'SET_LAYER_RANGE'; range: LayerRange }
  | { type: 'SET_TOTAL_LAYERS'; totalLayers: number }
  | { type: 'START_PLANNING' }
  | { type: 'PLAN_READY'; planInfo: PlanDisplayInfo }
  | { type: 'PLAN_FAILED'; error: string }
  | { type: 'START_EXECUTION'; jobId: string }
  | { type: 'UPDATE_PROGRESS'; progress: ExecutionProgress }
  | { type: 'UPDATE_PRODUCER_STATUS'; producer: string; status: ProducerStatus }
  | { type: 'EXECUTION_COMPLETE'; status: 'completed' | 'failed' }
  | { type: 'CANCEL' }
  | { type: 'DISMISS_DIALOG' }
  | { type: 'RESET' }
  | { type: 'INIT_FROM_MANIFEST'; artifacts: ArtifactInfo[] };

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
      return { ...state, status: 'planning', error: null };

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
      };

    case 'CANCEL':
      return {
        ...state,
        status: 'cancelled',
        currentJobId: null,
        progress: null,
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
      };

    case 'INIT_FROM_MANIFEST': {
      const statuses = mapArtifactsToProducerStatuses(action.artifacts);
      return {
        ...state,
        producerStatuses: statuses,
      };
    }

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

  // Convert Map to array (the response serializes Map as object)
  const byProducerObj = response.costSummary.byProducer as unknown;
  if (byProducerObj && typeof byProducerObj === 'object') {
    // Handle both Map and plain object
    const entries = byProducerObj instanceof Map
      ? Array.from(byProducerObj.entries())
      : Object.entries(byProducerObj);

    for (const [name, data] of entries) {
      const producerData = data as { count: number; totalCost: number; hasPlaceholders: boolean };
      costByProducer.push({
        name,
        count: producerData.count,
        cost: producerData.totalCost,
        hasPlaceholders: producerData.hasPlaceholders,
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
  confirmExecution: (dryRun?: boolean) => Promise<void>;
  cancelExecution: () => Promise<void>;
  dismissDialog: () => void;
  initializeFromManifest: (artifacts: ArtifactInfo[]) => void;
  reset: () => void;
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
    dispatch({ type: 'START_PLANNING' });

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

  const confirmExecution = useCallback(async (dryRun = false) => {
    if (!state.planInfo) return;

    try {
      const response = await executePlan({
        planId: state.planInfo.planId,
        upToLayer: state.layerRange.upToLayer ?? undefined,
        dryRun,
      });

      dispatch({ type: 'START_EXECUTION', jobId: response.jobId });

      // Subscribe to SSE for real-time updates
      unsubscribeRef.current = subscribeToJobStream(
        response.jobId,
        (event: SSEEvent) => {
          handleSSEEvent(event, dispatch);
        },
        (error) => {
          console.error('SSE error:', error);
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start execution';
      dispatch({ type: 'PLAN_FAILED', error: message });
    }
  }, [state.planInfo, state.layerRange.upToLayer]);

  const cancelExecution = useCallback(async () => {
    if (state.currentJobId) {
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

  const value: ExecutionContextValue = {
    state,
    setLayerRange,
    setTotalLayers,
    requestPlan,
    confirmExecution,
    cancelExecution,
    dismissDialog,
    initializeFromManifest,
    reset,
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

function handleSSEEvent(event: SSEEvent, dispatch: React.Dispatch<ExecutionAction>) {
  switch (event.type) {
    case 'job-start':
      dispatch({
        type: 'UPDATE_PRODUCER_STATUS',
        producer: event.producer,
        status: 'running',
      });
      break;

    case 'job-complete':
      dispatch({
        type: 'UPDATE_PRODUCER_STATUS',
        producer: event.producer,
        status: event.status === 'succeeded' ? 'success' : event.status === 'failed' ? 'error' : 'not-run-yet',
      });
      break;

    case 'layer-complete':
      // Layer complete events are handled for progress updates
      break;

    case 'execution-complete':
      dispatch({
        type: 'EXECUTION_COMPLETE',
        status: event.status === 'succeeded' ? 'completed' : 'failed',
      });
      break;

    case 'error':
      dispatch({ type: 'PLAN_FAILED', error: event.message });
      break;
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
