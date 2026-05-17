import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { createApp } from './index.js';
import { config } from './config.js';
import { createWSServer } from './ws/handler.js';
import { getServerContext } from './context.js';
import type { WebSocketServer } from 'ws';

const app = createApp();
const port = config.port;

// Initialize shared server context (DB, repos, services, backup)
const ctx = getServerContext();
ctx.logger.info('Server context initialized');

const server = serve({ fetch: app.fetch, port }, (info) => {
  ctx.logger.info('Cabinet server started', {
    port: info.port,
    ws: `ws://localhost:${info.port}/ws/events`,
    db: ctx.db.name,
  });
}) as Server;

const wss: WebSocketServer = createWSServer(server);

// Graceful shutdown on process exit
const gracefulShutdown = (signal: string) => {
  ctx.logger.info(`Received ${signal}, shutting down...`);

  // Close WebSocket connections with proper close frames
  wss.clients.forEach((client) => {
    client.close(1001, 'Server shutting down');
  });
  wss.close(() => {
    ctx.logger.info('WebSocket server closed');
    ctx.shutdown();
    process.exit(0);
  });

  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
