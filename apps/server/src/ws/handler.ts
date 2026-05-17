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
  ws.on('message', () => {
    // Client messages are ignored — server only broadcasts
  });

  ws.on('close', () => {
    clients.delete(ws);
  });

  ws.on('error', () => {
    clients.delete(ws);
  });
}

export function broadcast(type: string, data?: Record<string, unknown>): void {
  if (!wss) return;
  const message = JSON.stringify({ type, data: data ?? {}, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}
