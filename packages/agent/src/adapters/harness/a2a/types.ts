import type { AgentCapability } from '../../types.js';

// ── A2A Wire Types ───────────────────────────────────────────────

export interface A2AAgentCard {
  agent_id: string;
  display_name: string;
  version: string;
  capabilities: AgentCapability[];
  connection: {
    protocol: 'a2a';
    base_url: string;
    health_check?: string;
    authentication?: { type: string; header?: string; envVar?: string };
  };
}

export interface A2ATaskRequest {
  task_id: string;
  session_id: string;
  capability: string;
  input: unknown;
  slot: Record<string, unknown>;
  configuration: { max_retries: number; timeout_ms: number; slot_write_url: string };
  // Cabinet extension: harness context for skill injection
  cabinet_context?: {
    harnessId: string;
    skillInjected: boolean;
    working_directory?: string;
  };
}

export interface A2ATaskResponse {
  task_id: string;
  status: 'accepted' | 'rejected';
  estimated_duration_ms?: number;
  error?: string;
}

export interface A2ATaskStatus {
  task_id: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  progress?: number;
  message?: string;
  output?: unknown;
  tokens_used?: number;
  model?: string;
  timestamp: string;
}
