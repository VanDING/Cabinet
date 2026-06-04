//
// WSDaemonClient — WebSocket client for the agent daemon.
//
// Connects to Cabinet's agent WebSocket channel (/ws) for:
//   - Real-time task assignment (server pushes instead of polling)
//   - Heartbeat (liveness reporting every 15s)
//   - Progress streaming (daemon → server)
//   - Auto-reconnect with exponential backoff
//
// When WS is connected, the TaskQueuePoller suspends polling.
// When WS disconnects, polling resumes automatically.
//

// Minimal WebSocket interface — satisfied by both browser and 'ws' package.
interface WSLike {
  readyState: number;
  readonly OPEN: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: ((code: number) => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface WSDaemonClientConfig {
  wsUrl: string;
  daemonId: string;
  agentId: string;
  capabilities?: string[];
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  heartbeatIntervalMs?: number;
}

export type WSCtor = new (url: string) => WSLike;

const DEFAULTS = {
  capabilities: [] as string[],
  reconnectBaseMs: 1000,
  reconnectMaxMs: 30_000,
  heartbeatIntervalMs: 15_000,
};

export class WSDaemonClient {
  private WSCtor: WSCtor;
  private ws: WSLike | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private reconnectAttempt = 0;
  private shutdownFlag = false;
  private activeTaskIds: string[] = [];

  readonly cfg: {
    wsUrl: string;
    daemonId: string;
    agentId: string;
    capabilities: string[];
    reconnectBaseMs: number;
    reconnectMaxMs: number;
    heartbeatIntervalMs: number;
  };

  // Callbacks
  onTaskAssigned?: (task: unknown) => Promise<void>;
  onTaskCancelled?: (taskId: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;

  constructor(WSCtor: WSCtor, config: WSDaemonClientConfig) {
    this.WSCtor = WSCtor;
    this.cfg = { ...DEFAULTS, ...config };
  }

  connect(): void {
    if (this.ws) return;
    this.shutdownFlag = false;

    try {
      this.ws = new this.WSCtor(this.cfg.wsUrl);

      this.ws.onopen = () => {
        this.reconnectAttempt = 0;
        this.send({
          type: 'agent_daemon_connect',
          daemon_id: this.cfg.daemonId,
          agent_id: this.cfg.agentId,
          capabilities: this.cfg.capabilities,
          active_task_ids: this.activeTaskIds,
        });
        this.startHeartbeat();
        this.onConnected?.();
      };

      this.ws.onmessage = (event) => {
        try { this.handleMessage(JSON.parse(event.data as string)); } catch { /* ignore */ }
      };

      this.ws.onclose = (_code) => {
        this.ws = null;
        this.stopHeartbeat();
        this.onDisconnected?.();
        this.scheduleReconnect();
      };

      this.ws.onerror = () => {
        try { this.ws?.close(); } catch { /* ignore */ }
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.shutdownFlag = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) { try { this.ws.close(); } catch { /* ignore */ } this.ws = null; }
  }

  send(msg: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== this.ws.OPEN) return;
    this.seq++;
    this.ws.send(JSON.stringify({ ...msg, seq: this.seq, timestamp: new Date().toISOString() }));
  }

  sendProgress(taskId: string, percent: number, message: string, step = 0): void {
    this.send({ type: 'task_progress', daemon_id: this.cfg.daemonId, task_id: taskId, percent, message, step });
  }

  sendCompleted(taskId: string, output: unknown, tokensUsed?: number, model?: string): void {
    this.send({ type: 'task_completed', daemon_id: this.cfg.daemonId, task_id: taskId, output, tokens_used: tokensUsed, model });
  }

  sendFailed(taskId: string, error: string, retryRecommended = false): void {
    this.send({ type: 'task_failed', daemon_id: this.cfg.daemonId, task_id: taskId, error, retry_recommended: retryRecommended });
  }

  sendHeartbeat(activeTaskCount: number): void {
    this.send({ type: 'heartbeat', daemon_id: this.cfg.daemonId, agent_id: this.cfg.agentId, active_task_count: activeTaskCount });
  }

  isConnected(): boolean {
    // WebSocket.OPEN === 1 in both browser and ws package
    return this.ws !== null && (this.ws.readyState === 1);
  }

  setActiveTaskIds(ids: string[]): void { this.activeTaskIds = ids; }

  // ── Internal ──

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'connected': break;
      case 'task_assigned':
        this.activeTaskIds.push(msg.task_id as string);
        this.onTaskAssigned?.(msg.task).catch(() => {});
        break;
      case 'task_cancelled':
        this.onTaskCancelled?.(msg.task_id as string);
        break;
      case 'reconnect_ack':
        if (Array.isArray(msg.reconciled_tasks)) {
          this.activeTaskIds = msg.reconciled_tasks as string[];
        }
        break;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.isConnected()) this.sendHeartbeat(this.activeTaskIds.length);
    }, this.cfg.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  private scheduleReconnect(): void {
    if (this.shutdownFlag) return;
    const delay = Math.min(this.cfg.reconnectBaseMs * Math.pow(2, this.reconnectAttempt), this.cfg.reconnectMaxMs);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
