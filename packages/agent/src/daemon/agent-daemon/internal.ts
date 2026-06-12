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
import type { AutoDiscoverer, DiscoveryResult } from '../auto-discoverer.js';
import type { SquadRouter } from '../squad/squad-router.js';
import type { WSDaemonClient } from '../ws-daemon-client.js';
import type { AgentDaemonOptions } from './config.js';

export interface AgentDaemonState {
  taskRepo: AgentTaskQueueRepository;
  daemonRepo: AgentDaemonRepository;
  registry: AgentRoleRegistry;
  opts: Required<AgentDaemonOptions>;
  workspaceManager: WorkspaceManager;
  discoverer: AutoDiscoverer;
  adapterCache: Map<string, ExternalAgentAdapter>;
  harnessRuntimeCache: Map<string, HarnessRuntime>;
  activeTasks: Map<string, ExternalAgentAdapter>;
  startedAt: number;
  completedCount: number;
  failedCount: number;
  wsClient: WSDaemonClient | null;
  squadRouter: SquadRouter | null;
  processMetrics: Map<string, { pid: number; cpu: number; mem: number; ports: number[] }>;
  lastCpuUsage: ReturnType<typeof process.cpuUsage>;
  logger: {
    info: (msg: string, ctx?: unknown) => void;
    warn: (msg: string, ctx?: unknown) => void;
    error: (msg: string, ctx?: unknown) => void;
  };
  rowToEntry(row: TaskQueueRow): TaskQueueEntry;
  getAdapter(agentId: string): ExternalAgentAdapter | null;
  getHarnessRuntime(agentId: string): HarnessRuntime | null;
  buildHarnessContext(runtime: HarnessRuntime, workspacePath?: string): HarnessContext;
}
