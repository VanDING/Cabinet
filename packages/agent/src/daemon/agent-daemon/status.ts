import type { DaemonStatus, DaemonAgentInfo } from '@cabinet/types';
import type { AgentDaemonState } from './internal.js';
import {
  collectProcessMetrics,
  scanAllListeningPorts,
  killOrphanPort as killPort,
} from './metrics.js';
import { getDiscoveredAgents, triggerDiscovery, runWorkspaceGC } from './discovery.js';

export { getDiscoveredAgents, triggerDiscovery, runWorkspaceGC };

/** Get daemon status. */
export function getDaemonStatus(daemon: AgentDaemonState): DaemonStatus {
  collectProcessMetrics(daemon);
  const agents: DaemonAgentInfo[] = [];
  const discovered = daemon.discoverer.getLastResults();
  const knownPorts: number[] = [];
  for (const d of discovered) {
    const counts = daemon.taskRepo.countByStatus(d.agentId);
    const metrics = daemon.processMetrics.get(d.agentId);
    const agentInfo: DaemonAgentInfo = {
      agentId: d.agentId,
      command: d.command ?? d.baseUrl ?? 'unknown',
      detected: d.detected,
      status: 'online',
      activeTaskCount: (counts.running ?? 0) + (counts.claimed ?? 0),
      lastHeartbeatAt: null,
      cpuPercent: metrics?.cpu,
      memoryMb: metrics?.mem,
      openPorts: metrics?.ports,
      pid: metrics?.pid,
    };
    if (metrics?.ports) knownPorts.push(...metrics.ports);
    agents.push(agentInfo);
  }

  const allListening = scanAllListeningPorts();
  const orphanPorts = allListening.filter((p) => !knownPorts.includes(p));

  return {
    daemonId: daemon.opts.daemonId,
    status: 'online',
    uptimeMs: Date.now() - daemon.startedAt,
    activeTaskCount: daemon.activeTasks.size,
    completedTaskCount: daemon.completedCount,
    failedTaskCount: daemon.failedCount,
    agents,
    orphanPorts,
  };
}

/** Get ports info including orphans. */
export function getPortsInfo(daemon: AgentDaemonState): {
  agentPorts: Record<string, number[]>;
  orphans: number[];
} {
  collectProcessMetrics(daemon);
  const agentPorts: Record<string, number[]> = {};
  const knownPorts: number[] = [];
  for (const [agentId, metrics] of daemon.processMetrics) {
    agentPorts[agentId] = metrics.ports;
    knownPorts.push(...metrics.ports);
  }
  const allListening = scanAllListeningPorts();
  return { agentPorts, orphans: allListening.filter((p) => !knownPorts.includes(p)) };
}

/** Kill a specific orphan port. */
export function killOrphanPort(port: number): boolean {
  return killPort(port);
}
