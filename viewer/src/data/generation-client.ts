/**
 * API client for generation endpoints.
 */

import type {
  PlanRequest,
  PlanResponse,
  ExecuteRequest,
  ExecuteResponse,
  JobStatusResponse,
  SSEEvent,
} from '@/types/generation';

const API_BASE = '/viewer-api/generate';

// =============================================================================
// Request Helpers
// =============================================================================

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Request failed (${response.status}): ${errorText}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<TRequest, TResponse>(
  url: string,
  body: TRequest
): Promise<TResponse> {
  return fetchJson<TResponse>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Create an execution plan with cost estimation.
 */
export function createPlan(params: PlanRequest): Promise<PlanResponse> {
  return postJson<PlanRequest, PlanResponse>(`${API_BASE}/plan`, params);
}

/**
 * Execute a prepared plan.
 */
export function executePlan(params: ExecuteRequest): Promise<ExecuteResponse> {
  return postJson<ExecuteRequest, ExecuteResponse>(`${API_BASE}/execute`, params);
}

/**
 * Get status of an execution job.
 */
export function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  return fetchJson<JobStatusResponse>(`${API_BASE}/jobs/${encodeURIComponent(jobId)}`);
}

/**
 * Cancel a running execution job.
 */
export async function cancelJob(jobId: string): Promise<void> {
  await fetchJson(`${API_BASE}/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  });
}

// =============================================================================
// SSE Subscription
// =============================================================================

/**
 * Subscribe to SSE stream for job progress events.
 * Returns an unsubscribe function.
 */
export function subscribeToJobStream(
  jobId: string,
  onEvent: (event: SSEEvent) => void,
  onError: (error: Error) => void
): () => void {
  const url = `${API_BASE}/jobs/${encodeURIComponent(jobId)}/stream`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const sseEvent = JSON.parse(event.data) as SSEEvent;
      onEvent(sseEvent);
    } catch {
      onError(new Error('Failed to parse SSE event'));
    }
  };

  eventSource.onerror = () => {
    // EventSource automatically reconnects, but we should notify the caller
    // about potential connection issues
    onError(new Error('SSE connection error'));
  };

  // Return unsubscribe function
  return () => {
    eventSource.close();
  };
}
