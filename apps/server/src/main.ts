import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp } from './index.js';
import { config } from './config.js';
import { createWSServer } from './ws/handler.js';
import { getServerContext } from './context.js';

const app = createApp();
const port = config.port;

// Initialize shared server context (DB, repos, services, backup)
const ctx = getServerContext();
ctx.logger.info('Server context initialized');

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
  console.log('  GET  /api/secretary/context');
  console.log(`Database: ${ctx.db.name}`);
}) as Server;

createWSServer(server);
