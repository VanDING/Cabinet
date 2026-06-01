import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getServerContext } from '../context.js';
import { verifyPin, getStoredHash } from '../auth-utils.js';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function createWSServer(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws/events' });

  wss.on('connection', async (ws, req) => {
    const clientKey =
      (req.headers['x-forwarded-for'] as string) ?? req.socket.remoteAddress ?? '127.0.0.1';

    if (clientKey === '127.0.0.1' || clientKey === '::1' || clientKey === 'localhost') {
      // Verify PIN from query parameter
      const url = new URL(req.url ?? '', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        ws.close(4001, 'Token required');
        return;
      }

      const { db } = getServerContext();
      const storedHash = getStoredHash(db);
      if (storedHash) {
        const result = await verifyPin(token, storedHash);
        if (!result.valid) {
          ws.close(4001, 'Invalid token');
          return;
        }
      }

      clients.add(ws);
      ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
      setupClient(ws);
      return;
    }

    ws.close(4001, 'Remote WebSocket connections not supported');
  });

  return wss;
}

function setupClient(ws: WebSocket): void {
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
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
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function getWSServer(): WebSocketServer | null {
  return wss;
}
