import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createHash, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

const SALT = 'cabinet-salt';

function hashPin(pin: string): string {
  return createHash('sha256').update(pin + SALT).digest('hex');
}

function verifyPin(input: string, storedHash: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(hashPin(input)), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

function getStoredPinHash(db: Database.Database): string | null {
  try {
    const row = db.prepare(
      "SELECT value FROM metrics WHERE name = 'pin_hash' ORDER BY id DESC LIMIT 1"
    ).get() as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

let wss: WebSocketServer | null = null;
const clients = new Set<WebSocket>();

export function createWSServer(server: Server, db: Database.Database): WebSocketServer {
  wss = new WebSocketServer({ server, path: '/ws/events' });

  wss.on('connection', (ws, req) => {
    const storedHash = getStoredPinHash(db);
    let authenticated = false;

    // Auth timeout: if client doesn't send a valid PIN within 10s, close
    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close(4001, 'Unauthorized: no PIN received');
      }
    }, 10_000);

    // First message from client must contain the PIN
    ws.on('message', (raw) => {
      if (authenticated) return;

      clearTimeout(authTimeout);
      try {
        const data = JSON.parse(raw.toString());
        const pin = data.pin as string | undefined;

        // First run: no stored hash yet — accept any PIN
        if (!storedHash || (pin && verifyPin(pin, storedHash))) {
          authenticated = true;
          clients.add(ws);
          ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
          return;
        }
      } catch {}

      ws.close(4001, 'Unauthorized: invalid PIN');
    });

    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
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
