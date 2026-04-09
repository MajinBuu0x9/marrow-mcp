#!/usr/bin/env node
/**
 * Marrow MCP stdio server — collective memory for Claude and MCP agents.
 * Exposes: marrow_orient (call first!), marrow_think, marrow_commit, marrow_status
 */

import * as readline from 'readline';
import {
  marrowThink,
  marrowCommit,
  marrowOrient,
  marrowStatus,
  marrowAgentPatterns,
  marrowAsk,
} from './index';
import type { ThinkResult } from './types';

const API_KEY = process.env.MARROW_API_KEY || '';
const BASE_URL = process.env.MARROW_BASE_URL || 'https://api.getmarrow.ai';
const SESSION_ID = process.env.MARROW_SESSION_ID || undefined;

if (!API_KEY) {
  process.stderr.write(
    'Error: MARROW_API_KEY environment variable is required\n'
  );
  process.exit(1);
}

// Auto-orient on startup — cache warnings, inject into EVERY marrow_think response
let cachedOrientWarnings: Array<{
  type: string;
  failureRate: number;
  message: string;
}> = [];
let thinkCallCount = 0;

// Pending decision map for marrow_auto (action hash → decision_id)
interface PendingDecision {
  decision_id: string;
  timestamp: number;
}
const pendingDecisions = new Map<string, PendingDecision>();
const PENDING_TTL_MS = 30 * 60 * 1000; // 30 min TTL

function actionHash(action: string): string {
  const normalized = action.toLowerCase().trim().replace(/\s+/g, ' ');
  // djb2 hash to prevent decision_id mismatches from normalization-only collisions
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h) ^ normalized.charCodeAt(i);
    h = h >>> 0;
  }
  return h.toString(36) + '_' + normalized.slice(0, 32);
}

function cleanupPending(): void {
  const now = Date.now();
  for (const [key, val] of pendingDecisions) {
    if (now - val.timestamp > PENDING_TTL_MS) {
      pendingDecisions.delete(key);
    }
  }
}

function formatWarningActionably(w: {
  type: string;
  failureRate: number;
  message: string;
}): string {
  const pct = Math.round(w.failureRate * 100);
  return `⚠️ ${w.type} has ${pct}% failure rate — check what went wrong last time before proceeding`;
}

async function refreshOrientWarnings(): Promise<void> {
  try {
    const r = await marrowOrient(API_KEY, BASE_URL, undefined, SESSION_ID);
    cachedOrientWarnings = r.warnings;
  } catch {
    // ignore
  }
}

// Initial orient
refreshOrientWarnings().then(() => {
  if (cachedOrientWarnings.some((w) => w.failureRate > 0.4)) {
    process.stderr.write(
      `[marrow] ⚠️ High failure rate detected on startup — call marrow_orient for details before acting\n`
    );
  }
});

// Auto-commit tracking for session close
let lastDecisionId: string | null = null;
let lastCommitted = false;

async function autoCommitOnClose(): Promise<void> {
  if (lastDecisionId && !lastCommitted) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      await marrowCommit(
        API_KEY,
        BASE_URL,
        {
          decision_id: lastDecisionId,
          success: true,
          outcome: 'Session ended',
        },
        SESSION_ID
      );
      clearTimeout(timeout);
    } catch {
      // ignore
    }
  }
}

process.on('SIGTERM', async () => {
  const forceExit = setTimeout(() => process.exit(0), 5000);
  forceExit.unref();
  await autoCommitOnClose();
  process.exit(0);
});

process.stdin.on('end', async () => {
  await autoCommitOnClose();
});

function send(response: unknown): void {
  process.stdout.write(JSON.stringify(response) + '\n');
}

function success(id: string | number, result: unknown): void {
  send({ jsonrpc: '2.0', id, result });
}

function error(id: string | number, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } });
}

// Tool definitions
const TOOLS = [
  {
    name: 'marrow_orient',
    description:
      '⚡ CALL THIS FIRST — every session, before any other tool. ' +
      'Returns failure warnings from your history so you avoid known mistakes immediately. ' +
      'If shouldPause=true, review lessons before acting. ' +
      'orient() reads from the hive. think() writes to it. Both are required — this is what makes Marrow compound.',
    inputSchema: {
      type: 'object',
      properties: {
        taskType: {
          type: 'string',
          enum: ['implementation', 'security', 'architecture', 'process', 'general'],
          description:
            'Optional: filter warnings to a specific task type you are about to perform',
        },
      },
      required: [],
    },
  },
  {
    name: 'marrow_think',
    description:
      'Log intent and get collective intelligence before acting. ' +
      'Call this before every meaningful action. ' +
      'Returns pattern insights, similar past decisions, failure detection, and a recommendedNext field — follow it. ' +
      'Pass previous_outcome to auto-commit the last decision and open a new one.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'What the agent is about to do',
        },
        type: {
          type: 'string',
          enum: ['implementation', 'security', 'architecture', 'process', 'general'],
          description: 'Type of action (default: general)',
        },
        context: {
          type: 'object',
          description: 'Optional metadata about the current situation',
        },
        previous_decision_id: {
          type: 'string',
          description: 'decision_id from previous think() call — auto-commits that session',
        },
        previous_success: {
          type: 'boolean',
          description: 'Did the previous action succeed?',
        },
        previous_outcome: {
          type: 'string',
          description:
            'What happened in the previous action (required if previous_decision_id provided)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'marrow_commit',
    description:
      'Explicitly commit the result of an action to Marrow. ' +
      'Optional — marrow_think() auto-commits if you pass previous_outcome. ' +
      'Use when you need explicit control over commit timing.',
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: {
          type: 'string',
          description: 'decision_id from the marrow_think call',
        },
        success: {
          type: 'boolean',
          description: 'Did the action succeed?',
        },
        outcome: {
          type: 'string',
          description: 'What happened — be specific, this trains the hive',
        },
        caused_by: {
          type: 'string',
          description: 'Optional: what caused this action',
        },
      },
      required: ['decision_id', 'success', 'outcome'],
    },
  },
  {
    name: 'marrow_status',
    description: 'Check Marrow API health status.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

async function handleToolsList(id: string | number): Promise<void> {
  success(id, { tools: TOOLS });
}

async function handleToolsCall(
  id: string | number,
  name: string,
  args: Record<string, unknown>
): Promise<void> {
  try {
    let result: unknown;

    switch (name) {
      case 'marrow_orient': {
        const taskType = args.taskType as string | undefined;
        result = await marrowOrient(API_KEY, BASE_URL, taskType ? { taskType } : undefined, SESSION_ID);
        break;
      }

      case 'marrow_think': {
        // Refresh warnings periodically (every 10 calls)
        thinkCallCount++;
        if (thinkCallCount % 10 === 0) {
          refreshOrientWarnings();
        }

        const res = await marrowThink(
          API_KEY,
          BASE_URL,
          {
            action: args.action as string,
            type: args.type as string,
            context: args.context as Record<string, unknown>,
            previous_decision_id: args.previous_decision_id as string,
            previous_success: args.previous_success as boolean,
            previous_outcome: args.previous_outcome as string,
          },
          SESSION_ID
        ) as ThinkResult;

        // Inject orient warnings into intelligence.insights
        if (cachedOrientWarnings.length > 0) {
          const existingInsights = res.intelligence?.insights || [];
          res.intelligence.insights = [
            ...cachedOrientWarnings.map((w) => ({
              type: 'failure_pattern' as const,
              summary: w.message,
              action: `Review past ${w.type} failures before proceeding`,
              severity: (w.failureRate > 0.4 ? 'critical' : 'warning') as
                | 'critical'
                | 'warning',
              count: 0,
            })),
            ...existingInsights,
          ];
        }

        // Track for auto-commit
        lastDecisionId = res.decision_id;
        lastCommitted = false;

        result = res;
        break;
      }

      case 'marrow_commit': {
        const res = await marrowCommit(
          API_KEY,
          BASE_URL,
          {
            decision_id: args.decision_id as string,
            success: args.success as boolean,
            outcome: args.outcome as string,
            caused_by: args.caused_by as string,
          },
          SESSION_ID
        );
        lastCommitted = true;
        lastDecisionId = null;
        result = res;
        break;
      }

      case 'marrow_status': {
        result = await marrowStatus(API_KEY, BASE_URL, SESSION_ID);
        break;
      }

      default:
        error(id, -32601, `Method not found: ${name}`);
        return;
    }

    success(id, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(id, -32000, message);
  }
}

async function handleInitialize(id: string | number): Promise<void> {
  success(id, {
    protocolVersion: '2024-11-05',
    capabilities: {
      tools: {},
    },
    serverInfo: {
      name: 'marrow-mcp',
      version: '2.8.0',
    },
  });
}

// MCP stdio loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on('line', async (line) => {
  try {
    const msg = JSON.parse(line);

    switch (msg.method) {
      case 'initialize':
        await handleInitialize(msg.id);
        break;

      case 'tools/list':
        await handleToolsList(msg.id);
        break;

      case 'tools/call':
        await handleToolsCall(
          msg.id,
          msg.params?.name,
          msg.params?.arguments || {}
        );
        break;

      default:
        error(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  } catch (err) {
    process.stderr.write(`[marrow] Parse error: ${err}\n`);
  }
});
