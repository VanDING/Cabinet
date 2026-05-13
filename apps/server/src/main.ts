import { serve } from '@hono/node-server';
import { createApp } from './index.js';
import { config } from './config.js';

const app = createApp();
const port = config.port;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Cabinet server running at http://localhost:${info.port}`);
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /api/auth/verify');
  console.log('  GET  /api/dashboard/summary');
  console.log('  POST /api/secretary/chat');
  console.log('  GET  /api/decisions?status=pending');
  console.log('  GET  /api/factory/workflows');
  console.log('  POST /api/meetings');
});
