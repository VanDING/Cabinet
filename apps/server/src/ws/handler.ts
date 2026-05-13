import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function createWSServer(server: Server): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws/events' });

  wss.on('connection', (ws, req) => {
    const pin = req.headers['x-cabinet-pin'];
    if (!pin) {
      ws.close(4001, 'Unauthorized: missing x-cabinet-pin');
      return;
    }

    clients.add(ws);
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  return wss;
}

export function broadcastEvent(event: { type: string; payload: unknown }): void {
  const message = JSON.stringify(event);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

export function broadcast(type: string, payload: unknown): void {
  const message = JSON.stringify({ type, payload, timestamp: new Date().toISOString() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(message);
  }
}
