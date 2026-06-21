import type { TaskQueueEntry, TaskQueueStatus } from '@cabinet/types';
import type {
  AgentTaskQueueRepository,
  AgentDaemonRepository,
  TaskQueueRow,
} from '@cabinet/storage';
import type { AgentRoleRegistry } from '../../agent-roles.js';
import type { ExternalAgentAdapter } from '../../adapters/types.js';
import type { HarnessRuntime, HarnessContext } from '../../adapters/harness-runtime.js';
import type { WorkspaceManager } from '../workspace-manager.js';
import type { DiscoveryResult } from '../../discovery/scanner.js';
import type { SquadRouter } from '../squad/squad-router.js';
import type { WSDaemonClient } from '../ws-daemon-client.js';
import type { AgentDaemonOptions } from './config.js';

export interface PidMetrics {
  pid: number;
  cpu: number;
  mem: number;
  ports: number[];
}

export interface Logger {
  info: (msg: string, ctx?: unknown) => void;
  warn: (msg: string, ctx?: unknown) => void;
  error: (msg: string, ctx?: unknown) => void;
}

export interface AgentDaemonState {
  taskRepo: AgentTaskQueueRepository;
  daemonRepo: AgentDaemonRepository;
  registry: AgentRoleRegistry;
  opts: Required<AgentDaemonOptions>;
  workspaceManager: WorkspaceManager;
  discoverer: { discover(): Promise<DiscoveryResult[]>; getLastResults(): DiscoveryResult[] };
  adapterCache: Map<string, ExternalAgentAdapter>;
  harnessRuntimeCache: Map<string, HarnessRuntime>;
  activeTasks: Map<string, ExternalAgentAdapter>;
  startedAt: number;
  completedCount: number;
  failedCount: number;
  wsClient: WSDaemonClient | null;
  squadRouter: SquadRouter | null;
  processMetrics: Map<string, PidMetrics>;
  lastCpuUsage: ReturnType<typeof process.cpuUsage>;
  logger: Logger;
}
