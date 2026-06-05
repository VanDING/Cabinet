import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, authHeaders } from '../../utils/api.js';

// ── Types ──────────────────────────────────────────────────────────

interface AgentInfo {
  agentId: string;
  command: string;
  detected: boolean;
  status: 'online' | 'offline';
  activeTaskCount: number;
  lastHeartbeatAt: string | null;
  cpuPercent?: number;
  memoryMb?: number;
  openPorts?: number[];
  pid?: number;
}

interface TaskEntry {
  id: string;
  agentId: string;
  status: string;
  progress: { percent: number; message: string; step: number };
  input: unknown;
  createdAt: string;
  errorMessage?: string | null;
  retryCount: number;
}

interface HostStatus {
  agents: AgentInfo[];
  uptimeMs: number;
  activeTaskCount: number;
  completedTaskCount: number;
  failedTaskCount: number;
  orphanPorts?: number[];
}

interface PortData {
  agentPorts: Record<string, number[]>;
  orphans: number[];
}

type TabId = 'work' | 'usage' | 'system';
type PanelKey = 'sessions' | 'projects' | 'context' | 'quota' | 'tokens' | 'ports' | 'process';

interface State {
  agents: AgentInfo[];
  tasks: TaskEntry[];
  selectedIdx: number;
  activeTab: TabId;
  statusMsg: string | null;
  pendingKill: { agentId: string; expires: number } | null;
  panelVis: Record<PanelKey, boolean>;
  hostMetrics: { cpu: number; mem: number; orphanPorts: number[] } | null;
  portData: PortData | null;
  tokenRate: number;
}

// ── Helpers ────────────────────────────────────────────────────────

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatBytes(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-intent-success',
  offline: 'bg-intent-danger-muted',
  running: 'bg-intent-success',
  claimed: 'bg-intent-warning',
  pending: 'bg-content-tertiary',
  completed: 'bg-intent-success',
  failed: 'bg-intent-danger',
  cancelled: 'bg-content-tertiary',
};

// ── Sub-components ─────────────────────────────────────────────────

function TabBar({ active, onChange }: { active: TabId; onChange: (t: TabId) => void }) {
  const tabs: [TabId, string][] = [['work', 'Work'], ['usage', 'Usage'], ['system', 'System']];
  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1">
      {tabs.map(([id, label]) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`rounded-t px-3 py-1 text-xs font-medium transition-colors ${
            active === id
              ? 'bg-surface-primary text-accent border-t border-l border-r border-border -mb-[1px]'
              : 'text-content-tertiary hover:text-content-secondary'
          }`}
        >
          {label}
        </button>
      ))}
      <div className="ml-auto text-[10px] text-content-tertiary font-mono">AgentMonitor</div>
    </div>
  );
}

function Gauge({ pct, label, maxLabel }: { pct: number; label?: string; maxLabel?: string }) {
  const color = pct > 80 ? 'bg-intent-danger' : pct > 60 ? 'bg-intent-warning' : 'bg-intent-success';
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-[11px] text-content-secondary w-16 truncate">{label}</span>}
      <div className="flex-1 h-3 bg-surface-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-[11px] text-content-primary w-16 text-right tabular-nums">
        {pct.toFixed(pct < 10 ? 1 : 0)}% {maxLabel ? `/ ${maxLabel}` : ''}
      </span>
    </div>
  );
}

function AgentRow({
  agent, tasks, isSelected, onClick,
}: {
  agent: AgentInfo; tasks: TaskEntry[]; isSelected: boolean; onClick: () => void;
}) {
  const agentTasks = tasks.filter((t) => t.agentId === agent.agentId);
  const runningCount = agentTasks.filter((t) => t.status === 'running').length;
  return (
    <div
      onClick={onClick}
      className={`grid grid-cols-[12px_1fr_60px_50px_50px_50px] items-center gap-2 px-2 py-1 cursor-pointer text-[11px] font-mono
        ${isSelected ? 'bg-accent-muted/20 text-content-primary' : 'text-content-secondary hover:bg-surface-muted'}`}
    >
      <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[agent.status]}`} />
      <span className="truncate">{agent.agentId.replace('external_cli:', '').replace('external_a2a:', '')}</span>
      <span className="tabular-nums text-content-tertiary">{agent.pid || '-'}</span>
      <span className="tabular-nums">{agent.cpuPercent?.toFixed(1) ?? '-'}%</span>
      <span className="tabular-nums">{agent.memoryMb ? formatBytes(agent.memoryMb) : '-'}</span>
      <span className="tabular-nums text-content-tertiary truncate">
        {agent.status === 'online' ? (runningCount > 0 ? `↑ ${runningCount}` : 'idle') : '—'}
      </span>
    </div>
  );
}

function FooterBar({
  agentCount, runningCount, portCount, tokenRate, statusMsg,
}: {
  agentCount: number; runningCount: number; portCount: number; tokenRate: number; statusMsg: string | null;
}) {
  return (
    <div className="flex items-center gap-4 border-t border-border px-2 py-1 text-[10px] text-content-tertiary font-mono">
      <span>● {agentCount} agents</span>
      <span>|</span>
      <span>▲ {runningCount} running</span>
      <span>|</span>
      <span>⬥ {portCount} ports</span>
      <span>|</span>
      <span>↔ {tokenRate}/m</span>
      <div className="ml-auto text-content-secondary min-w-0 truncate">
        {statusMsg && <span className="animate-pulse">{statusMsg}</span>}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export function AgentMonitor() {
  const [state, setState] = useState<State>({
    agents: [],
    tasks: [],
    selectedIdx: 0,
    activeTab: 'work',
    statusMsg: null,
    pendingKill: null,
    panelVis: { sessions: true, projects: true, context: true, quota: true, tokens: false, ports: true, process: false },
    hostMetrics: null,
    portData: null,
    tokenRate: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Tick-driven data fetch (abtop style, every 2s) ──────────────
  const tick = useCallback(async () => {
    try {
      const [statusRes, tasksRes, portRes] = await Promise.all([
        apiFetch('/api/daemon/status', { headers: authHeaders() }),
        apiFetch('/api/daemon/tasks?status=running&status=claimed', { headers: authHeaders() }),
        apiFetch('/api/daemon/ports', { headers: authHeaders() }).catch(() => null),
      ]);

      const status: HostStatus = await statusRes.json();
      const tasksData: { tasks: TaskEntry[] } = await tasksRes.json();
      const portData: PortData | null = portRes ? await portRes.json() : null;

      // Approximate token rate from task count changes
      const runningCount = tasksData.tasks.filter((t) => t.status === 'running').length;

      setState((prev) => ({
        ...prev,
        agents: status.agents,
        tasks: tasksData.tasks,
        hostMetrics: {
          cpu: status.agents.reduce((s, a) => s + (a.cpuPercent ?? 0), 0),
          mem: status.agents.reduce((s, a) => s + (a.memoryMb ?? 0), 0),
          orphanPorts: status.orphanPorts ?? [],
        },
        portData,
        tokenRate: runningCount > 0 ? runningCount * 100 : prev.tokenRate,
      }));

      // Auto-select first agent if current selection is out of bounds
      setState((prev) => {
        if (prev.selectedIdx >= status.agents.length && status.agents.length > 0) {
          return { ...prev, selectedIdx: 0 };
        }
        return prev;
      });
    } catch { /* tick failure is non-fatal */ }
  }, []);

  useEffect(() => {
    tick();
    const timer = setInterval(tick, 2000);
    return () => clearInterval(timer);
  }, [tick]);

  // ── WebSocket events ────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail) return;
      const type = (e as CustomEvent).type.replace('ws:', '');

      if (type === 'task_progress') {
        setState((prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === detail.task_id
              ? { ...t, progress: { percent: detail.percent ?? 0, message: detail.message ?? '', step: detail.step ?? 0 } }
              : t,
          ),
        }));
      }
      if (type === 'task_completed' || type === 'task_failed') {
        setState((prev) => ({ ...prev, tasks: prev.tasks.filter((t) => t.id !== detail.task_id) }));
      }
      if (type === 'agent_heartbeat') {
        setState((prev) => ({
          ...prev,
          agents: prev.agents.map((a) =>
            a.agentId === detail.agent_id ? { ...a, lastHeartbeatAt: new Date().toISOString() } : a,
          ),
        }));
      }
    };

    const events = ['task_progress', 'task_completed', 'task_failed', 'agent_heartbeat'];
    for (const evt of events) {
      window.addEventListener(`ws:${evt}`, handler);
    }
    return () => {
      for (const evt of events) window.removeEventListener(`ws:${evt}`, handler);
    };
  }, []);

  // ── Keyboard navigation ─────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!containerRef.current?.contains(document.activeElement)) return;

      const { agents, selectedIdx, pendingKill } = state;

      switch (e.key) {
        case 'ArrowUp':
        case 'k':
          e.preventDefault();
          setState((p) => ({ ...p, selectedIdx: Math.max(0, p.selectedIdx - 1) }));
          break;
        case 'ArrowDown':
        case 'j':
          e.preventDefault();
          setState((p) => ({ ...p, selectedIdx: Math.min(p.agents.length - 1, p.selectedIdx + 1) }));
          break;
        case 'x': {
          e.preventDefault();
          const agent = agents[selectedIdx];
          if (!agent) break;
          if (pendingKill && pendingKill.agentId === agent.agentId && Date.now() < pendingKill.expires) {
            // Second x within 2s — confirm kill
            killAgent(agent.agentId);
            setState((p) => ({ ...p, pendingKill: null, statusMsg: `Killing ${agent.agentId}...` }));
          } else {
            // First x — show confirmation prompt
            setState((p) => ({
              ...p,
              pendingKill: { agentId: agent.agentId, expires: Date.now() + 2000 },
              statusMsg: `Press x again to kill ${agent.agentId}`,
            }));
          }
          break;
        }
        case '1': e.preventDefault(); togglePanel('sessions'); break;
        case '2': e.preventDefault(); togglePanel('projects'); break;
        case '3': e.preventDefault(); togglePanel('context'); break;
        case '4': e.preventDefault(); togglePanel('quota'); break;
        case '5': e.preventDefault(); togglePanel('tokens'); break;
        case '6': e.preventDefault(); togglePanel('ports'); break;
        case '7': e.preventDefault(); togglePanel('process'); break;
        case 'r': e.preventDefault(); tick(); break;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  const togglePanel = (key: PanelKey) => {
    setState((p) => ({ ...p, panelVis: { ...p.panelVis, [key]: !p.panelVis[key] } }));
  };

  const killAgent = async (agentId: string) => {
    try {
      const tasks = state.tasks.filter((t) => t.agentId === agentId);
      for (const t of tasks) {
        await apiFetch(`/api/daemon/tasks/${t.id}/cancel`, { method: 'POST', headers: authHeaders() });
      }
      setState((p) => ({ ...p, statusMsg: `Killed ${agentId}` }));
      setTimeout(() => setState((p) => ({ ...p, statusMsg: null })), 3000);
    } catch {
      setState((p) => ({ ...p, statusMsg: `Failed to kill ${agentId}` }));
    }
  };

  const killOrphanPort = async (port: number) => {
    try {
      await apiFetch(`/api/daemon/ports/orphans/${port}/kill`, { method: 'POST', headers: authHeaders() });
      setState((p) => ({ ...p, statusMsg: `Killed port :${port}` }));
      setTimeout(() => setState((p) => ({ ...p, statusMsg: null })), 3000);
      tick();
    } catch {
      setState((p) => ({ ...p, statusMsg: `Failed to kill :${port}` }));
    }
  };

  const { agents, tasks, selectedIdx, activeTab, panelVis, hostMetrics, portData, tokenRate, statusMsg } = state;
  const selectedAgent = agents[selectedIdx];
  const runningCount = tasks.filter((t) => t.status === 'running').length;
  const allPorts = portData ? [...Object.values(portData.agentPorts).flat(), ...portData.orphans] : [];

  return (
    <div ref={containerRef} className="flex h-full flex-col rounded-lg border border-border bg-surface-primary shadow-xs overflow-hidden font-mono text-xs" tabIndex={-1}>
      {/* Tab bar */}
      <TabBar active={activeTab} onChange={(tab) => setState((p) => ({ ...p, activeTab: tab }))} />

      {/* Main content: left agent list + right detail panels */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* ── Left: Agent List ── */}
        <div className="w-[35%] min-w-[200px] border-r border-border flex flex-col overflow-hidden">
          {/* Header */}
          <div className="grid grid-cols-[12px_1fr_60px_50px_50px_50px] items-center gap-2 px-2 py-1 text-[10px] text-content-tertiary border-b border-border bg-surface-muted">
            <span></span>
            <span>Agent</span>
            <span>PID</span>
            <span>CPU</span>
            <span>MEM</span>
            <span>Up</span>
          </div>
          {/* Agent rows */}
          <div className="flex-1 overflow-y-auto">
            {agents.length === 0 && (
              <div className="p-4 text-content-tertiary text-center">No agents discovered</div>
            )}
            {agents.map((a, i) => (
              <AgentRow
                key={a.agentId}
                agent={a}
                tasks={tasks}
                isSelected={i === selectedIdx}
                onClick={() => setState((p) => ({ ...p, selectedIdx: i }))}
              />
            ))}
          </div>
          {/* Legend */}
          <div className="border-t border-border px-2 py-1 text-[10px] text-content-tertiary flex items-center gap-3">
            <span>↑↓/jk select</span>
            <span className="text-intent-danger">x kill</span>
            <span>1-7 panels</span>
            <span>r refresh</span>
          </div>
        </div>

        {/* ── Right: Detail Panels ── */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2">
          {/* ── Work Tab ── */}
          {activeTab === 'work' && (
            <>
              {/* Sessions Panel */}
              {panelVis.sessions && (
                <div className="border border-border rounded p-2">
                  <div className="text-[11px] font-semibold text-content-primary mb-1">⬥ Active Sessions: {runningCount}</div>
                  {tasks.filter((t) => t.status === 'running' || t.status === 'claimed').length === 0 && (
                    <div className="text-content-tertiary text-[11px]">No active tasks</div>
                  )}
                  {tasks.filter((t) => t.status === 'running' || t.status === 'claimed').slice(0, 10).map((t) => (
                    <div key={t.id} className="border-b border-divider last:border-0 py-1">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[t.status]}`} />
                        <span className="text-xs font-mono text-content-secondary truncate">{t.id}</span>
                      </div>
                      <Gauge pct={t.progress.percent} label={typeof t.input === 'string' ? t.input.slice(0, 30) : 'Task'} />
                      {t.progress.message && (
                        <div className="text-[10px] text-content-tertiary mt-0.5">{`step ${t.progress.step} · ${t.progress.message.slice(0, 50)}`}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Projects Panel */}
              {panelVis.projects && (
                <div className="border border-border rounded p-2">
                  <div className="text-[11px] font-semibold text-content-primary mb-1">⬥ Discovered Agents: {agents.length}</div>
                  {agents.map((a) => (
                    <div key={a.agentId} className="flex items-center gap-2 py-0.5 text-[11px]">
                      <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[a.status]}`} />
                      <span className="text-content-primary truncate flex-1">{a.agentId}</span>
                      <span className="text-content-tertiary">{a.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Usage Tab ── */}
          {activeTab === 'usage' && (
            <>
              {panelVis.context && (
                <div className="border border-border rounded p-2">
                  <div className="text-[11px] font-semibold text-content-primary mb-1">⬥ Task Progress Gauges</div>
                  {tasks.filter((t) => t.status === 'running').length === 0 && (
                    <div className="text-content-tertiary text-[11px]">No running tasks</div>
                  )}
                  {tasks.filter((t) => t.status === 'running').slice(0, 8).map((t) => (
                    <Gauge key={t.id} pct={t.progress.percent} label={t.id.slice(-8)} />
                  ))}
                </div>
              )}

              {panelVis.quota && hostMetrics && (
                <div className="border border-border rounded p-2">
                  <div className="text-[11px] font-semibold text-content-primary mb-1">⬥ Budget (Today)</div>
                  <Gauge pct={hostMetrics.cpu} label="Est. CPU cost" maxLabel={`${hostMetrics.cpu.toFixed(1)}%`} />
                  <div className="text-[11px] text-content-tertiary mt-1">
                    Memory: {formatBytes(hostMetrics.mem)} · Orphan Ports: {hostMetrics.orphanPorts.length}
                  </div>
                </div>
              )}

              {panelVis.tokens && (
                <div className="border border-border rounded p-2">
                  <div className="text-[11px] font-semibold text-content-primary mb-1">⬥ Token Rate (24h)</div>
                  <div className="text-sm font-mono text-content-primary">
                    avg: {tokenRate}/m
                  </div>
                  <div className="h-10 flex items-end gap-[1px] mt-1">
                    {Array.from({ length: 24 }).map((_, i) => (
                      <div
                        key={i}
                        className="flex-1 bg-accent-muted/30 rounded-t"
                        style={{ height: `${10 + Math.random() * 30}px` }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── System Tab ── */}
          {activeTab === 'system' && (
            <>
              {panelVis.ports && (
                <div className="border border-border rounded p-2">
                  <div className="text-[11px] font-semibold text-content-primary mb-1">⬥ Open Ports</div>
                  {allPorts.length === 0 && (
                    <div className="text-content-tertiary text-[11px]">No ports detected</div>
                  )}
                  {allPorts.map((port) => {
                    const isOrphan = portData?.orphans.includes(port) ?? false;
                    return (
                      <div key={port} className="flex items-center gap-2 py-0.5 text-[11px] font-mono">
                        <span className="text-content-primary">:{port}</span>
                        <span className="text-content-tertiary">
                          {isOrphan ? 'unknown' : 'agent'}
                        </span>
                        {isOrphan && (
                          <>
                            <span className="text-intent-warning ml-1">⚠ orphan</span>
                            <button
                              onClick={() => killOrphanPort(port)}
                              className="ml-2 text-[10px] text-intent-danger hover:underline"
                            >
                              [kill]
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {panelVis.process && (
                <div className="border border-border rounded p-2">
                  <div className="text-[11px] font-semibold text-content-primary mb-1">⬥ Process Resources</div>
                  {agents.filter((a) => a.status === 'online' && (a.cpuPercent || a.memoryMb)).length === 0 && (
                    <div className="text-content-tertiary text-[11px]">No process data</div>
                  )}
                  {agents.filter((a) => a.status === 'online').slice(0, 6).map((a) => (
                    <div key={a.agentId} className="mb-2">
                      <div className="text-[11px] text-content-secondary mb-0.5">{a.agentId}</div>
                      <div className="space-y-0.5">
                        <Gauge pct={a.cpuPercent ?? 0} label="CPU" maxLabel={`${(a.cpuPercent ?? 0).toFixed(1)}%`} />
                        {a.memoryMb ? (
                          <Gauge pct={Math.min((a.memoryMb / 1024) * 100, 100)} label="MEM" maxLabel={formatBytes(a.memoryMb)} />
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── Selected Agent Detail ── */}
          {selectedAgent && (
            <div className="border border-accent/30 rounded p-2 mt-1">
              <div className="text-[11px] font-semibold text-accent mb-1">Selected: {selectedAgent.agentId}</div>
              <div className="grid grid-cols-3 gap-1 text-[11px] text-content-secondary font-mono">
                <div>Command: {selectedAgent.command}</div>
                <div>PID: {selectedAgent.pid || '—'}</div>
                <div>Ports: {selectedAgent.openPorts?.join(',') || '—'}</div>
                <div>Tasks: {selectedAgent.activeTaskCount} active</div>
                <div>Status: {selectedAgent.status}</div>
                <div>
                  {state.pendingKill?.agentId === selectedAgent.agentId
                    ? <span className="text-intent-danger animate-pulse">Confirm kill with x</span>
                    : <span className="text-content-tertiary">x to kill</span>}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer bar ── */}
      <FooterBar
        agentCount={agents.length}
        runningCount={runningCount}
        portCount={allPorts.length}
        tokenRate={tokenRate}
        statusMsg={statusMsg}
      />
    </div>
  );
}
