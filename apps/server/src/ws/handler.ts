import type { Server, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

interface AugmentedWebSocket extends WebSocket { _agentId?: string; _daemonId?: string; }

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export interface WSServers {
  wss: WebSocketServer;
  agentWss: WebSocketServer;
  handleUpgrade: (request: IncomingMessage, socket: import("stream").Duplex, head: Buffer) => void;
}

export function createWSServers(): WSServers {
  // Main events channel (Dashboard, ActivityFeed)
  wss = new WebSocketServer({ noServer: true });
  setupWSS(wss);

  // Agent channel (external agents connect here for status + approval)
  const agentWss = new WebSocketServer({ noServer: true });
  setupWSS(agentWss);

  function handleUpgrade(request: IncomingMessage, socket: import("stream").Duplex, head: Buffer) {
    const pathname = request.url?.split('?')[0] ?? '';
    if (pathname === '/ws/events') {
      wss!.handleUpgrade(request, socket, head, (ws) => {
        wss!.emit('connection', ws, request);
      });
    } else if (pathname === '/ws') {
      agentWss.handleUpgrade(request, socket, head, (ws) => {
        agentWss.emit('connection', ws, request);
      });
    }
  }

  return { wss, agentWss, handleUpgrade };
}

function setupWSS(server: WebSocketServer): void {
  server.on('connection', (ws, req) => {
    const clientKey =
      (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? '127.0.0.1';

    if (clientKey === '127.0.0.1' || clientKey === '::1' || clientKey === 'localhost') {
      clients.add(ws);
      ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
      setupClient(ws);
      return;
    }

    ws.close(4001, 'Remote WebSocket connections not supported');
  });
}

function setupClient(ws: WebSocket): void {
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  const subscriptions = new Set<string>();

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      } else if (msg.type === 'subscribe' && msg.channel) {
        subscriptions.add(msg.channel);
        ws.send(JSON.stringify({ type: 'subscribed', channel: msg.channel }));
      } else if (msg.type === 'agent_connect' && msg.agent_id) {
        subscriptions.add('agent_event');
        // Store agent_id for targeted delivery
        (ws as AugmentedWebSocket)._agentId = msg.agent_id;
        ws.send(JSON.stringify({ type: 'agent_connected', agent_id: msg.agent_id }));
      } else {
        // Try daemon message handler
        handleDaemonWSMessage(ws, msg);
      }
    } catch {
      // ignore malformed messages
    }
  });

  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30_000);

  ws.on('close', () => {
    clients.delete(ws);
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  });

  ws.on('error', () => {
    clients.delete(ws);
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  });
}

export function broadcast(type: string, data?: Record<string, unknown>): void {
  const message = JSON.stringify({ type, data: data ?? {}, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    // For agent_event — only deliver to clients that subscribed or have matching agent_id
    if (type === 'agent_event' || type === 'decision_result') {
      const agentId = (client as AugmentedWebSocket)._agentId;
      const dataAgentId = data?.agentId ?? data?.agent_id;
      if (agentId && dataAgentId && agentId !== dataAgentId) continue; // targeted delivery
    }

    client.send(message);
  }
}

export function getWSServer(): WebSocketServer | null {
  return wss;
}

// ── Daemon Connection Manager ─────────────────────────────────────

/**
 * Tracks daemon WebSocket connections for real-time task push.
 * Replaces polling when a daemon is connected via WS.
 */
class DaemonConnectionManager {
  private daemons = new Map<string, WebSocket>(); // daemon_id → WS

  register(daemonId: string, ws: WebSocket): void {
    this.daemons.set(daemonId, ws);
    // Store daemon_id on ws for cleanup
    (ws as AugmentedWebSocket)._daemonId = daemonId;
  }

  unregister(daemonId: string): void {
    this.daemons.delete(daemonId);
  }

  /** Push a task to a daemon via WS. Returns true if sent successfully. */
  sendTask(daemonId: string, task: unknown): boolean {
    const ws = this.daemons.get(daemonId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'task_assigned', task, task_id: (task as { id: string }).id, timestamp: new Date().toISOString() }));
    return true;
  }

  /** Cancel a running task on a daemon. */
  cancelTask(daemonId: string, taskId: string): boolean {
    const ws = this.daemons.get(daemonId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'task_cancelled', task_id: taskId, timestamp: new Date().toISOString() }));
    return true;
  }

  /** Send config update to a daemon. */
  sendConfigUpdate(daemonId: string, config: Record<string, unknown>): boolean {
    const ws = this.daemons.get(daemonId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ type: 'config_updated', config, timestamp: new Date().toISOString() }));
    return true;
  }

  isConnected(daemonId: string): boolean {
    const ws = this.daemons.get(daemonId);
    return ws !== undefined && ws.readyState === WebSocket.OPEN;
  }

  getOnlineDaemons(): string[] {
    return [...this.daemons.entries()]
      .filter(([, ws]) => ws.readyState === WebSocket.OPEN)
      .map(([id]) => id);
  }

  /** Handle cleanup when a daemon WS disconnects. */
  handleDisconnect(ws: WebSocket): void {
    const daemonId = (ws as AugmentedWebSocket)._daemonId as string | undefined;
    if (daemonId) this.unregister(daemonId);
  }
}

const daemonConnections = new DaemonConnectionManager();

export { daemonConnections as daemonConnectionManager };
export type { DaemonConnectionManager };

// Register daemon handlers on agent WS connections
// Called from context.ts after creating WS servers
export function registerDaemonWSHandlers(): void {
  // Hook into existing agentWss — but since setupWSS is already called,
  // we add a global message handler by patching the setupClient behavior.
  // Instead, we extend the broadcast to handle daemon message types.
  // The daemon connect/close handling is done by the daemon-context module.
}

/**
 * Handle an incoming daemon WebSocket message.
 * Called by external code that processes raw agent channel messages.
 */
export function handleDaemonWSMessage(ws: WebSocket, msg: Record<string, unknown>): boolean {
  switch (msg.type) {
    case 'agent_daemon_connect': {
      const daemonId = msg.daemon_id as string;
      if (daemonId) {
        (ws as AugmentedWebSocket)._daemonId = daemonId;
        daemonConnections.register(daemonId, ws);
        ws.send(JSON.stringify({ type: 'connected', daemon_id: daemonId }));
      }
      return true;
    }
    case 'heartbeat': {
      const daemonId = (msg.daemon_id as string) ?? (ws as AugmentedWebSocket)._daemonId;
      if (daemonId) {
        // Heartbeat received — daemon is alive
        // Could update agent_daemon_heartbeats table here if needed
      }
      return true;
    }
    case 'task_progress': {
      // Forward to events WS for Dashboard display
      broadcast('task_progress', msg as Record<string, unknown>);
      return true;
    }
    case 'task_completed': {
      broadcast('task_completed', msg as Record<string, unknown>);
      return true;
    }
    case 'task_failed': {
      broadcast('task_failed', msg as Record<string, unknown>);
      return true;
    }
    case 'daemon_reconnect': {
      const daemonId = msg.daemon_id as string;
      if (daemonId) {
        (ws as AugmentedWebSocket)._daemonId = daemonId;
        daemonConnections.register(daemonId, ws);
        // Reconcile: return list of tasks still claimed by this daemon
        ws.send(JSON.stringify({
          type: 'reconnect_ack',
          reconciled_tasks: msg.active_task_ids ?? [],
        }));
      }
      return true;
    }
    default:
      return false; // not a daemon message
  }
}
