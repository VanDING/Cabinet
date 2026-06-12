import { hostname } from 'node:os';

export interface AgentDaemonOptions {
  daemonId?: string;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxConcurrentTasks?: number;
  taskTimeoutMs?: number;
  workspaceTtlMs?: number;
  autoDiscoverOnStart?: boolean;
}

export const DEFAULTS: Required<AgentDaemonOptions> = {
  daemonId: `daemon_${hostname()}`,
  pollIntervalMs: 3000,
  heartbeatIntervalMs: 15_000,
  heartbeatTimeoutMs: 60_000,
  maxConcurrentTasks: 3,
  taskTimeoutMs: 300_000,
  workspaceTtlMs: 86_400_000,
  autoDiscoverOnStart: true,
};
