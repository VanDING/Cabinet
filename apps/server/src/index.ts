import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRouter } from './routes/health.js';
import { secretaryRouter } from './routes/secretary.js';
import { decisionsRouter } from './routes/decisions.js';
import { meetingsRouter } from './routes/meetings.js';
import { workflowsRouter } from './routes/workflows.js';
import { dashboardRouter } from './routes/dashboard.js';
import { settingsRouter } from './routes/settings.js';
import { authRouter } from './routes/auth.js';
import { skillsRouter } from './routes/skills.js';
import { authMiddleware } from './middleware/auth.js';
import { createSSEHandler } from './ws/handler.js';
import { openapiRouter } from './openapi.js';

export function createApp() {
  const app = new Hono();

  app.use('*', cors());
  app.use('/api/*', authMiddleware);

  app.route('/health', healthRouter);
  app.route('/api/secretary', secretaryRouter);
  app.route('/api/decisions', decisionsRouter);
  app.route('/api/meetings', meetingsRouter);
  app.route('/api/factory', workflowsRouter);
  app.route('/api/dashboard', dashboardRouter);
  app.route('/api/settings', settingsRouter);
  app.route('/api/auth', authRouter);
  app.route('/api/skills', skillsRouter);
  app.get('/api/events/stream', createSSEHandler());
  app.route('/api', openapiRouter());

  return app;
}
