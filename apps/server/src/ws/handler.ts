import type { Server, IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export interface WSServers {
  wss: WebSocketServer;
  agentWss: WebSocketServer;
  handleUpgrade: (request: IncomingMessage, socket: any, head: Buffer) => void;
}

export function createWSServers(): WSServers {
  // Main events channel (Dashboard, ActivityFeed)
  wss = new WebSocketServer({ noServer: true });
  setupWSS(wss);

  // Agent channel (external agents connect here for status + approval)
  const agentWss = new WebSocketServer({ noServer: true });
  setupWSS(agentWss);

  function handleUpgrade(request: IncomingMessage, socket: any, head: Buffer) {
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
        (ws as any)._agentId = msg.agent_id;
        ws.send(JSON.stringify({ type: 'agent_connected', agent_id: msg.agent_id }));
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
      const agentId = (client as any)._agentId;
      const dataAgentId = data?.agentId ?? data?.agent_id;
      if (agentId && dataAgentId && agentId !== dataAgentId) continue; // targeted delivery
    }

    client.send(message);
  }
}

export function getWSServer(): WebSocketServer | null {
  return wss;
}
