import type { DiscoveryResult } from '../../discovery/scanner.js';
import type { AgentDaemonState } from './internal.js';

/** Get discovered agents. */
export function getDiscoveredAgents(daemon: AgentDaemonState): DiscoveryResult[] {
  return daemon.discoverer.getLastResults();
}

/** Trigger rediscovery. */
export function triggerDiscovery(daemon: AgentDaemonState): Promise<DiscoveryResult[]> {
  return daemon.discoverer.discover();
}

/** Trigger workspace GC. */
export function runWorkspaceGC(
  daemon: AgentDaemonState,
): ReturnType<import('../workspace-manager.js').WorkspaceManager['runGC']> {
  return daemon.workspaceManager.runGC();
}

/** Build a load map for squad routing (agentId → active task count). */
export function buildLoadMap(daemon: AgentDaemonState): Map<string, number> {
  const map = new Map<string, number>();
  for (const [taskId, adapter] of daemon.activeTasks) {
    const agentId = adapter.agentId;
    map.set(agentId, (map.get(agentId) ?? 0) + 1);
  }
  return map;
}
