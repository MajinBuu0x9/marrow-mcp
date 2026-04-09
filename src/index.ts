/**
 * @getmarrow/mcp — API Functions
 */

import type {
  ThinkResult,
  CommitResult,
  StatusResult,
  AgentPatternsResult,
  OrientResult,
  MarrowAskResult,
} from './types';

async function request(
  apiKey: string,
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
  sessionId?: string
): Promise<any> {
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  if (sessionId) {
    headers['X-Marrow-Session-Id'] = sessionId;
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(
      `Marrow API error: ${res.status} ${res.statusText} — ${error.error || error.message || 'Unknown error'}`
    );
  }

  return res.json();
}

/**
 * Log intent and get collective intelligence before acting.
 */
export async function marrowThink(
  apiKey: string,
  baseUrl: string,
  params: {
    action: string;
    type?: string;
    context?: Record<string, unknown>;
    previous_decision_id?: string;
    previous_success?: boolean;
    previous_outcome?: string;
  },
  sessionId?: string
): Promise<ThinkResult> {
  const body: Record<string, unknown> = {
    action: params.action,
    type: params.type || 'general',
    context: params.context,
  };

  if (params.previous_decision_id) {
    body.previous_decision_id = params.previous_decision_id;
    body.previous_success = params.previous_success ?? true;
    body.previous_outcome = params.previous_outcome ?? '';
  }

  return request(apiKey, baseUrl, 'POST', '/v1/agent/think', body, sessionId);
}

/**
 * Explicitly commit the result of an action to Marrow.
 */
export async function marrowCommit(
  apiKey: string,
  baseUrl: string,
  params: {
    decision_id: string;
    success: boolean;
    outcome: string;
    caused_by?: string;
  },
  sessionId?: string
): Promise<CommitResult> {
  return request(
    apiKey,
    baseUrl,
    'POST',
    '/v1/agent/commit',
    {
      decision_id: params.decision_id,
      success: params.success,
      outcome: params.outcome,
      caused_by: params.caused_by,
    },
    sessionId
  );
}

/**
 * Get API health status.
 */
export async function marrowStatus(
  apiKey: string,
  baseUrl: string,
  sessionId?: string
): Promise<StatusResult> {
  return request(apiKey, baseUrl, 'GET', '/health', undefined, sessionId);
}

/**
 * Get agent patterns and failure history.
 */
export async function marrowAgentPatterns(
  apiKey: string,
  baseUrl: string,
  params?: { type?: string; limit?: number },
  sessionId?: string
): Promise<AgentPatternsResult> {
  const qs = new URLSearchParams();
  if (params?.type) qs.set('type', params.type);
  if (params?.limit) qs.set('limit', String(params.limit));

  return request(
    apiKey,
    baseUrl,
    'GET',
    `/v1/agent/patterns${qs.toString() ? '?' + qs.toString() : ''}`,
    undefined,
    sessionId
  );
}

/**
 * Get failure warnings from history before acting.
 */
export async function marrowOrient(
  apiKey: string,
  baseUrl: string,
  params?: { taskType?: string },
  sessionId?: string
): Promise<OrientResult> {
  const patterns = await marrowAgentPatterns(
    apiKey,
    baseUrl,
    params?.taskType ? { type: params.taskType } : undefined,
    sessionId
  );

  const warnings = patterns.failure_patterns
    .filter((p) => p.failure_rate > 0.15)
    .map((p) => ({
      type: p.decision_type,
      failureRate: p.failure_rate,
      message: `${p.decision_type} has ${Math.round(p.failure_rate * 100)}% failure rate over ${p.count} decisions`,
    }));

  return {
    warnings,
    shouldPause: warnings.some((w) => w.failureRate > 0.4),
  };
}

/**
 * Query the collective hive for failure patterns and recommendations.
 */
export async function marrowAsk(
  apiKey: string,
  baseUrl: string,
  params: { query: string },
  sessionId?: string
): Promise<MarrowAskResult> {
  return request(apiKey, baseUrl, 'POST', '/v1/agent/ask', params, sessionId);
}
