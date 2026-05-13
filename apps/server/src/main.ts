import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp } from './index.js';
import { config } from './config.js';
import { createWSServer } from './ws/handler.js';
import { startAutoArchive } from './scheduler.js';

const app = createApp();
const port = config.port;

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
startAutoArchive(60 * 60 * 1000);
console.log('Auto-archive scheduler started (checking every 60 min)');
