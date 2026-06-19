import { execSync } from 'node:child_process';
import type { AgentDaemonState } from './internal.js';
import { rowToEntry } from './conversion.js';

/** Collect OS-level metrics for active agent processes. */
export function collectProcessMetrics(daemon: AgentDaemonState): void {
  const currentCpu = process.cpuUsage(daemon.lastCpuUsage);
  const elapsedMs = Date.now() - daemon.startedAt || 1;
  // CPU % = (user+system time in μs) / (elapsed time in μs) * 100, normalized per core
  const cpuPercent =
    Math.round(((currentCpu.user + currentCpu.system) / 1000 / (elapsedMs * 10)) * 100) / 100;
  const memUsage = process.memoryUsage();

  // For each discovered agent, try to get per-process metrics from active tasks
  for (const [taskId, adapter] of daemon.activeTasks) {
    const row = daemon.taskRepo.findById(taskId);
    if (!row) continue;
    const task = rowToEntry(row);
    const agentId = task.agentId;

    // Get ports for this agent's tasks
    let ports: number[] = [];
    try {
      ports = scanPortsForPid(process.pid); // approximate — we track the main process
    } catch {
      /* best-effort */
    }

    daemon.processMetrics.set(agentId, {
      pid: process.pid,
      cpu: cpuPercent,
      mem: Math.round(memUsage.rss / 1024 / 1024),
      ports,
    });
  }

  // Also set metrics for discovered agents that have no active tasks
  const discovered = daemon.discoverer.getLastResults();
  for (const d of discovered) {
    if (!daemon.processMetrics.has(d.agentId)) {
      daemon.processMetrics.set(d.agentId, { pid: 0, cpu: 0, mem: 0, ports: [] });
    }
  }
}

/** Scan all LISTEN ports on the machine. */
export function scanAllListeningPorts(): number[] {
  try {
    const cmd =
      process.platform === 'win32'
        ? 'netstat -ano | findstr LISTENING'
        : "lsof -i -P -n | grep LISTEN | awk '{print $9}' | cut -d: -f2";
    const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    const ports = new Set<number>();
    for (const line of out.split('\n')) {
      const match = process.platform === 'win32' ? line.match(/:(\d+)\s/) : line.match(/^\d+/);
      if (match) ports.add(parseInt(match[1] || match[0], 10));
    }
    return [...ports].filter((p) => p > 0 && p < 65536);
  } catch {
    return [];
  }
}

/** Scan ports associated with a specific PID. */
export function scanPortsForPid(pid: number): number[] {
  try {
    const cmd =
      process.platform === 'win32'
        ? `netstat -ano | findstr ${pid}`
        : `lsof -i -P -n -p ${pid} | grep LISTEN | awk '{print $9}' | cut -d: -f2`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 5000 });
    const ports = new Set<number>();
    for (const line of out.split('\n')) {
      const match =
        process.platform === 'win32' ? line.match(/:(\d+)\s.*LISTENING/) : line.match(/^\d+/);
      if (match) ports.add(parseInt(match[1] || match[0], 10));
    }
    return [...ports];
  } catch {
    return [];
  }
}

/** Kill a specific orphan port. */
export function killOrphanPort(port: number): boolean {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8', timeout: 5000 });
      const pidMatch = out.match(/(\d+)\s*$/m);
      if (pidMatch) execSync(`taskkill /PID ${pidMatch[1]} /F`, { timeout: 5000 });
    } else {
      execSync(`lsof -ti:${port} | xargs kill -9`, { timeout: 5000 });
    }
    return true;
  } catch {
    return false;
  }
}
