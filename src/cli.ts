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
import type { ThinkResult, OrientResult } from './types';

const API_KEY = process.env.MARROW_API_KEY || '';
const BASE_URL = process.env.MARROW_BASE_URL || 'https://api.getmarrow.ai';
const SESSION_ID = process.env.MARROW_SESSION_ID || undefined;

if (!API_KEY) {
  process.stderr.write('Error: MARROW_API_KEY environment variable is required\n');
  process.exit(1);
}

// Auto-orient on startup — cache warnings, inject into EVERY marrow_think response
let cachedOrientWarnings: Array<{ type: string; failureRate: number; message: string }> = [];
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

function formatWarningActionably(w: { type: string; failureRate: number; message: string }): string {
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
    name: 'marrow_run',
    description:
      'Zero-ceremony memory logging. Single call handles orient → think → commit automatically. ' +
      'Use this instead of chaining marrow_think + marrow_commit when you want Marrow to just work without managing the loop yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: 'What the agent did',
        },
        success: {
          type: 'boolean',
          description: 'Whether it succeeded',
        },
        outcome: {
          type: 'string',
          description: 'One-line summary of what happened',
        },
        type: {
          type: 'string',
          enum: ['implementation', 'security', 'architecture', 'process', 'general'],
          description: 'Type of action (default: general)',
        },
      },
      required: ['description', 'success', 'outcome'],
    },
  },
  {
    name: 'marrow_auto',
    description:
      'Zero-friction Marrow logging. One call for any action — Marrow handles everything in the background without blocking. ' +
      'Pass what you are about to do. Optionally pass outcome if already done. ' +
      'Use for ANY action: deploys, file writes, API calls, external sends. ' +
      'If you only have time for one call: pass action + outcome + success together — done in one shot.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description: 'What you are about to do or just did',
        },
        outcome: {
          type: 'string',
          description: 'What happened (if already done). Omit to log intent only.',
        },
        success: {
          type: 'boolean',
          description: 'Did it succeed (default: true)',
        },
        type: {
          type: 'string',
          enum: ['implementation', 'security', 'architecture', 'process', 'general'],
          description: 'Type of action (default: general)',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'marrow_ask',
    description:
      'Query the collective hive in plain English. ' +
      'Ask about failure patterns, what worked, what broke, or get a recommendation before acting. ' +
      'Returns direct answer + supporting evidence.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Plain English question about your decision history',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'marrow_status',
    description: 'Check Marrow platform health and status.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// Request handler
async function handleRequest(req: {
  id: string | number;
  method: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}): Promise<void> {
  const { id, method, params } = req;
  try {
    if (method === 'initialize') {
      success(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {}, prompts: {} },
        serverInfo: { name: 'marrow', version: '2.8.0' },
      });
      return;
    }

    if (method === 'prompts/list') {
      success(id, {
        prompts: [
          {
            name: 'marrow-always-on',
            description:
              'Always-on Marrow memory loop. Instructs the agent to orient at session start, log intent before meaningful actions, and commit outcomes after completion. Install once — works automatically.',
            arguments: [],
          },
        ],
      });
      return;
    }

    if (method === 'prompts/get') {
      const promptName = params?.name;
      if (promptName !== 'marrow-always-on') {
        error(id, -32602, 'Unknown prompt');
        return;
      }
      success(id, {
        description: 'Always-on Marrow memory loop — automatic, zero-config',
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `You have Marrow — a memory layer that tells you what went wrong last time before you do it again.

## PRIMARY: Use marrow_auto for everything

One tool. Two calls max. Zero loop management.

The minimum loop:
1. Before any external action: \`marrow_auto({ action: "...what you are about to do" })\`
2. After the action: \`marrow_auto({ action: "...", outcome: "...what happened", success: true/false })\`

If you only have time for one call: \`marrow_auto({ action: "did X", outcome: "result", success: true })\` — that's the whole loop.

You never need think + commit separately. \`marrow_auto\` handles everything.

All Marrow API calls run in the background — \`marrow_auto\` returns instantly with cached warnings so you never wait.

## Query the hive

Use marrow_ask to query your decision history in plain English:
- "what keeps breaking our deploys?"
- "what's our failure rate on security tasks?"
- "what worked last time we published?"

## Advanced mode: fine-grained control

For cases where you need explicit control over the orient → think → act → commit loop:

1. **Session start:** Call marrow_orient FIRST. It surfaces failure warnings so you avoid known mistakes.
2. **Before acting:** Call marrow_think with what you're about to do. Returns pattern insights and recommendedNext — follow it.
3. **After acting:** Call marrow_commit with what happened.
4. **Shortcut:** marrow_run handles orient → think → commit in a single awaited call.

Most agents never need advanced mode. \`marrow_auto\` covers 99% of cases.

## Why you must not skip this

If you skip logging, the hive can't protect you or future agents from this mistake.
Every decision you log compounds. Failure rates drop. Patterns emerge. The next session starts smarter.
Marrow tells you what went wrong last time before you do it again. But only if you logged it.

This is not optional overhead — it's how you stop repeating the same failures.`,
            },
          },
        ],
      });
      return;
    }

    if (method === 'tools/list') {
      success(id, { tools: TOOLS });
      return;
    }

    if (method === 'tools/call') {
      const toolName = params?.name;
      const args = (params?.arguments || {}) as Record<string, unknown>;

      if (toolName === 'marrow_orient') {
        const result = await marrowOrient(
          API_KEY,
          BASE_URL,
          { taskType: args.taskType as string },
          SESSION_ID
        );
        success(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
        return;
      }

      if (toolName === 'marrow_think') {
        const result = await marrowThink(
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
        );

        // Refresh orient warnings every 5th think call
        thinkCallCount++;
        if (thinkCallCount % 5 === 0) {
          refreshOrientWarnings();
        }

        // Inject cached orient warnings into intelligence.insights
        if (cachedOrientWarnings.length > 0) {
          const existingInsights = result.intelligence?.insights || [];
          result.intelligence.insights = [
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
        lastDecisionId = result.decision_id;
        lastCommitted = false;

        success(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
        return;
      }

      if (toolName === 'marrow_commit') {
        const result = await marrowCommit(
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
        success(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
        return;
      }

      if (toolName === 'marrow_run') {
        // marrow_run = orient + think + commit in one call
        await marrowOrient(API_KEY, BASE_URL, undefined, SESSION_ID);
        const thinkResult = await marrowThink(
          API_KEY,
          BASE_URL,
          {
            action: args.description as string,
            type: (args.type as string) || 'general',
          },
          SESSION_ID
        );
        const commitResult = await marrowCommit(
          API_KEY,
          BASE_URL,
          {
            decision_id: thinkResult.decision_id,
            success: (args.success as boolean) ?? true,
            outcome: args.outcome as string,
          },
          SESSION_ID
        );
        success(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { think: thinkResult, commit: commitResult },
                null,
                2
              ),
            },
          ],
        });
        return;
      }

      if (toolName === 'marrow_auto') {
        // marrow_auto = fire-and-forget background logging
        // Return immediately with cached orient warnings, API calls happen in background
        const action = args.action as string;
        const outcome = args.outcome as string | undefined;
        const success = (args.success as boolean) ?? true;
        const type = (args.type as string) || 'general';

        // Return cached warnings immediately
        const response = {
          action,
          outcome: outcome || 'pending',
          warnings: cachedOrientWarnings.map(formatWarningActionably),
        };

        // Fire-and-forget the actual API calls
        (async () => {
          try {
            if (!outcome) {
              // Intent only
              await marrowThink(
                API_KEY,
                BASE_URL,
                { action, type },
                SESSION_ID
              );
            } else {
              // Full loop
              const thinkResult = await marrowThink(
                API_KEY,
                BASE_URL,
                { action, type },
                SESSION_ID
              );
              await marrowCommit(
                API_KEY,
                BASE_URL,
                {
                  decision_id: thinkResult.decision_id,
                  success,
                  outcome,
                },
                SESSION_ID
              );
            }
          } catch {
            // Silently fail — auto is best-effort
          }
        })();

        success(id, {
          content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
        });
        return;
      }

      if (toolName === 'marrow_ask') {
        const result = await marrowAsk(
          API_KEY,
          BASE_URL,
          { query: args.query as string },
          SESSION_ID
        );
        success(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
        return;
      }

      if (toolName === 'marrow_status') {
        const result = await marrowStatus(API_KEY, BASE_URL, SESSION_ID);
        success(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        });
        return;
      }

      error(id, -32601, `Method not found: ${toolName}`);
      return;
    }

    error(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error(id, -32000, message);
  }
}

// MCP stdio loop
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

rl.on('line', async (line) => {
  try {
    const msg = JSON.parse(line);
    await handleRequest(msg);
  } catch (err) {
    process.stderr.write(`[marrow] Parse error: ${err}\n`);
  }
});
