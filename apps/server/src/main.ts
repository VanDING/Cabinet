import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import { MastraServer } from '@mastra/hono';
import { mastra } from './mastra/index.js';
import { createApp } from './index.js';
import { config, validateEnv } from './config.js';
import { createWSServers } from './ws/handler.js';
import { getServerContext } from './context.js';
import { decryptApiKey } from './crypto.js';
import { MASTER_PW } from './routes/settings/persistence.js';

const envCheck = validateEnv();
if (!envCheck.success) {
  console.error('Environment validation failed:');
  for (const issue of envCheck.issues!) console.error(`  - ${issue}`);
  process.exit(1);
}

const app = createApp();
const port = config.port;

async function start() {
  // Initialize shared server context (DB, repos, services, backup)
  const ctx = getServerContext();
  ctx.mastra = mastra;
  ctx.logger.info('Server context initialized');

  // Export API keys from settings to process.env for Mastra model routing
  try {
    const keys = ctx.apiKeyRepo.findAll();
    for (const k of keys) {
      try {
        const decrypted = decryptApiKey(k.encrypted_key, MASTER_PW);
        process.env[`${k.provider.toUpperCase()}_API_KEY`] = decrypted;
        ctx.logger.info(`API key loaded for ${k.provider}`);
      } catch {
        /* skip key that can't be decrypted */
      }
    }
  } catch (err) {
    ctx.logger.warn('Failed to load API keys', { error: String(err) });
  }

  const MASTRA_PROVIDERS = [
    'DEEPSEEK',
    'OPENAI',
    'ANTHROPIC',
    'GOOGLE',
    'QWEN',
    'MOONSHOT',
    'ZHIPU',
    'BAICHUAN',
  ];
  const availableProviders = MASTRA_PROVIDERS.filter((p) => process.env[`${p}_API_KEY`]);
  if (availableProviders.length === 0) {
    ctx.logger.warn('No API keys configured. Add keys in Settings → API Keys.');
  } else {
    ctx.logger.info(`API keys available for: ${availableProviders.join(', ')}`);
    process.env.CABINET_PRIMARY_PROVIDER = availableProviders[0]!.toLowerCase();
  }

  // Integrate Mastra Hono Adapter (auto-registers agent/workflow/memory API routes)
  const mastraServer = new MastraServer({
    app,
    mastra,
    prefix: '/api',
    openapiPath: '/openapi.json',
  });
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

  const gracefulShutdown = (signal: string) => {
    ctx.logger.info(`Received ${signal}, shutting down...`);
    wss.clients.forEach((client) => {
      client.close(1001, 'Server shutting down');
    });
    wss.close(() => {
      ctx.logger.info('WebSocket server closed');
      ctx.shutdown();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
}

start();
