//
// A2A Helper — utilities for building A2A-compatible agent endpoints.
//
// Helps external agent developers quickly implement:
//   - GET  /.well-known/agent.json   → capability card
//   - POST /a2a/tasks                → accept incoming tasks
//   - WebSocket connection to Cabinet → real-time status + approval
//

import type { ContextSlot } from '@cabinet/types';

// ── Types ────────────────────────────────────────────────────────

export interface A2AAgentCard {
  agent_id: string;
  display_name: string;
  version: string;
  description?: string;
  capabilities: Array<{
    name: string;
    description: string;
    input_schema?: Record<string, unknown>;
    output_schema?: Record<string, unknown>;
    security_level?: string;
  }>;
  connection: {
    protocol: 'a2a';
    base_url: string;
    health_check?: string;
  };
}

export interface A2ATask {
  task_id: string;
  session_id: string;
  capability: string;
  input: unknown;
  slot: ContextSlot;
  configuration: {
    max_retries: number;
    timeout_ms: number;
    slot_write_url: string;
  };
}

export interface A2ATaskResult {
  status: 'completed' | 'failed';
  output?: unknown;
  tokens_used?: number;
  model?: string;
}

// ── Card Builder ─────────────────────────────────────────────────

export function createAgentCard(config: {
  agent_id: string;
  display_name: string;
  version?: string;
  description?: string;
  base_url: string;
  capabilities: A2AAgentCard['capabilities'];
}): A2AAgentCard {
  return {
    agent_id: config.agent_id,
    display_name: config.display_name,
    version: config.version ?? '1.0.0',
    description: config.description,
    capabilities: config.capabilities,
    connection: {
      protocol: 'a2a',
      base_url: config.base_url,
      health_check: `${config.base_url}/health`,
    },
  };
}

// ── Express/Hono Route Helpers ───────────────────────────────────

/** Create a response for GET /.well-known/agent.json */
export function agentCardResponse(card: A2AAgentCard): Response {
  return new Response(JSON.stringify(card), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Parse an incoming A2A task from POST /a2a/tasks body */
export function parseTask(body: unknown): A2ATask {
  const data = body as Record<string, unknown>;
  if (!data.task_id || !data.capability) {
    throw new Error('Invalid A2A task: missing task_id or capability');
  }
  return {
    task_id: data.task_id as string,
    session_id: (data.session_id as string) ?? '',
    capability: data.capability as string,
    input: data.input,
    slot: (data.slot ?? {}) as ContextSlot,
    configuration: (data.configuration ?? {
      max_retries: 2,
      timeout_ms: 120_000,
    }) as A2ATask['configuration'],
  };
}

/** Build a task result response */
export function taskResultResponse(result: A2ATaskResult): Response {
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── WebSocket Client ─────────────────────────────────────────────

export interface CabinetWSClient {
  sendStatus(taskId: string, status: string, progress?: number, message?: string): void;
  sendTelemetry(
    taskId: string,
    data: {
      tokens: { prompt: number; completion: number };
      timing: { ttft_ms: number; total_ms: number; tool_latency_ms: number[] };
      steps: number;
      model: string;
    },
  ): void;
  close(): void;
}

/** Connect to Cabinet's WebSocket endpoint for real-time event streaming. */
export function connectToCabinet(wsUrl: string, agentId: string): CabinetWSClient {
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'agent_connect', agent_id: agentId }));
  };

  return {
    sendStatus(taskId, status, progress, message) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'task_status',
            task_id: taskId,
            status,
            progress,
            message,
            timestamp: new Date().toISOString(),
          }),
        );
      }
    },
    sendTelemetry(taskId, data) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'telemetry',
            task_id: taskId,
            agent_id: agentId,
            ...data,
            status: 'completed',
          }),
        );
      }
    },
    close() {
      ws.close();
    },
  };
}
