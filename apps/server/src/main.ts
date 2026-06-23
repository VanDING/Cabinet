import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { MastraServer } from '@mastra/hono';
import { mastra } from './mastra/index.js';
import { createApp } from './index.js';
import { config, validateEnv } from './config.js';
import { createWSServers } from './ws/handler.js';
import { getServerContext } from './context.js';

const envCheck = validateEnv();
if (!envCheck.success) {
  console.error('Environment validation failed:');
  for (const issue of envCheck.issues!) console.error(`  - ${issue}`);
  process.exit(1);
}

const app = createApp();
const port = config.port;

// Initialize shared server context (DB, repos, services, backup)
const ctx = getServerContext();
ctx.logger.info('Server context initialized');

// Integrate Mastra Hono Adapter (auto-registers agent/workflow/memory API routes)
const mastraServer = new MastraServer({
  app,
  mastra,
  prefix: '/api',
  openapiPath: '/openapi.json',
});
// Manual init to control ordering: context middleware first, then routes
mastraServer.registerContextMiddleware();
await mastraServer.registerRoutes();
ctx.logger.info('Mastra adapter initialized');

const server = serve({ fetch: app.fetch, port }, (info) => {
  ctx.logger.info('Cabinet server started', {
    port: info.port,
    ws: `ws://localhost:${info.port}/ws/events`,
    db: ctx.db.name,
  });
}) as Server;

const { wss, handleUpgrade } = createWSServers();
server.on('upgrade', (request, socket, head) => {
  handleUpgrade(request, socket, head);
});

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
