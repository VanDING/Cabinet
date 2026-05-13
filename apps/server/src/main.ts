import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import Database from 'better-sqlite3';
import { createApp } from './index.js';
import { config } from './config.js';
import { createWSServer } from './ws/handler.js';
import { startAutoArchive } from './scheduler.js';

const app = createApp();
const port = config.port;

let db: Database.Database;
try {
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch {
  console.warn('better-sqlite3 not available — scheduler will not run auto-archive');
  db = null as unknown as Database.Database;
}

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cabinet server running at http://localhost:${info.port}`);
  console.log(`WebSocket at ws://localhost:${info.port}/ws/events`);
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /api/auth/verify');
  console.log('  GET  /api/dashboard/summary');
  console.log('  POST /api/secretary/chat');
  console.log('  GET  /api/decisions?status=pending');
  console.log('  GET  /api/factory/workflows');
  console.log('  POST /api/meetings');
}) as Server;

// Attach WebSocket server to the same HTTP server
createWSServer(server);

// Start auto-archive scheduler (checks every hour)
if (db) {
  startAutoArchive(db, 60 * 60 * 1000);
}
