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

function buildHeaders(
  apiKey: string,
  sessionId?: string,
  contentType?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  if (sessionId) {
    const safe = sessionId.replace(/[^\x20-\x7E]/g, '').slice(0, 256);
    if (safe) {
      headers['X-Marrow-Session-Id'] = safe;
    }
  }
  return headers;
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
  };

  if (params.context) {
    body.context = params.context;
  }

  if (params.previous_decision_id) {
    body.previous_decision_id = params.previous_decision_id;
    body.previous_success = params.previous_success ?? true;
    body.previous_outcome = params.previous_outcome ?? '';
  }

  const res = await fetch(`${baseUrl}/v1/agent/think`, {
    method: 'POST',
    headers: buildHeaders(apiKey, sessionId, 'application/json'),
    body: JSON.stringify(body),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }

  return json.data;
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
  const res = await fetch(`${baseUrl}/v1/agent/commit`, {
    method: 'POST',
    headers: buildHeaders(apiKey, sessionId, 'application/json'),
    body: JSON.stringify(params),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }

  return json.data;
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
  if (params?.type) {
    qs.set('type', params.type);
  }
  if (params?.limit) {
    qs.set('limit', String(params.limit));
  }

  const url =
    `${baseUrl}/v1/agent/patterns` +
    (qs.toString() ? '?' + qs.toString() : '');

  const res = await fetch(url, {
    headers: buildHeaders(apiKey, sessionId),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }

  return json.data;
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
      message: `${p.decision_type} has ${Math.round(p.failure_rate * 100)}% failure rate over ${p.count} decisions — review lessons before acting`,
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
  const res = await fetch(`${baseUrl}/v1/agent/ask`, {
    method: 'POST',
    headers: buildHeaders(apiKey, sessionId, 'application/json'),
    body: JSON.stringify({ query: params.query }),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }

  return json.data;
}

/**
 * Get API health status.
 */
export async function marrowStatus(
  apiKey: string,
  baseUrl: string,
  sessionId?: string
): Promise<StatusResult> {
  const res = await fetch(`${baseUrl}/v1/health`, {
    headers: buildHeaders(apiKey, sessionId),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error);
  }

  return json.data;
}
