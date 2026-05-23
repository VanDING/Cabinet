import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function createWSServer(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws/events' });

  wss.on('connection', (ws, req) => {
    const clientKey =
      (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? '127.0.0.1';

    // Localhost connections accepted immediately
    if (clientKey === '127.0.0.1' || clientKey === '::1' || clientKey === 'localhost') {
      clients.add(ws);
      ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
      setupClient(ws);
      return;
    }

    // Remote connections: close immediately (not supported yet)
    ws.close(4001, 'Remote WebSocket connections not supported');
  });

  return wss;
}

function setupClient(ws: WebSocket): void {
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  // Heartbeat: ping every 30s, terminate if no pong within 10s
  ws.on('pong', () => {
    // Client responded — connection is alive
  });

  pingTimer = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
      // Set a short timeout: if still alive after 10s, it's dead
      const deadTimer = setTimeout(() => {
        ws.terminate();
      }, 10_000);
      ws.once('pong', () => clearTimeout(deadTimer));
    } else {
      clearInterval(pingTimer!);
    }
  }, 30_000);

  ws.on('message', () => {
    // Client messages are ignored — server only broadcasts
  });

  ws.on('close', () => {
    if (pingTimer) clearInterval(pingTimer);
    clients.delete(ws);
  });

  ws.on('error', () => {
    if (pingTimer) clearInterval(pingTimer);
    clients.delete(ws);
  });
}

/** Event types that are too high-frequency for WebSocket broadcast.
 *  Frontend polls /observability for aggregated data instead. */
const LOW_PRIORITY_EVENTS = new Set([
  'system_notification',
  'secretary_message',
]);

export function broadcast(type: string, data?: Record<string, unknown>): void {
  // Skip high-frequency events — frontend polls /observability for these
  if (LOW_PRIORITY_EVENTS.has(type)) return;
  if (!wss) return;
  const message = JSON.stringify({ type, data: data ?? {}, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
