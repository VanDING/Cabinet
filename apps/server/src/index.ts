import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRouter } from './routes/health.js';
import { secretaryRouter } from './routes/secretary.js';
import { decisionsRouter } from './routes/decisions.js';
import { workflowsRouter } from './routes/workflows.js';
import { dashboardRouter } from './routes/dashboard.js';
import { settingsRouter } from './routes/settings.js';
import { skillsRouter } from './routes/skills.js';
import { memoryRouter } from './routes/memory.js';
import { employeesRouter } from './routes/employees.js';
import { filesRouter } from './routes/files.js';
import { auditRouter } from './routes/audit.js';
import { backupsRouter } from './routes/backups.js';
import { rulesRouter } from './routes/rules.js';
import { progressRouter } from './routes/progress.js';
import { observabilityRouter } from './routes/observability.js';
import { insightsRouter } from './routes/insights.js';
import { harnessRouter } from './routes/harness.js';
import { agentsRouter } from './routes/agents.js';
import { projectsRouter } from './routes/projects.js';
import { deliverablesRouter } from './routes/deliverables.js';
import { evaluationsRouter } from './routes/evaluations.js';
import { externalAgentRouter } from './routes/external-agent.js';
import { daemonRouter } from './routes/daemon.js';
import { autopilotRouter, webhookRouter } from './routes/autopilot.js';
import { squadRouter } from './routes/squads.js';
import { telemetryRouter } from './routes/telemetry.js';
import { tasksRouter } from './routes/tasks.js';

import { documentsRouter } from './routes/documents.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimiter } from './middleware/rate-limit.js';
import { openapiRouter } from './openapi.js';

export function createApp() {
  const app = new Hono();

  app.use(
    '*',
    cors({
      origin: (origin) => {
        // Allow localhost on common dev ports and Tauri's custom protocol
        const allowed = [
          /^https?:\/\/localhost(:\d+)?$/,
          /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
          /^https?:\/\/tauri\.localhost(:\d+)?$/,
          /^tauri:\/\/localhost$/,
          /^https?:\/\/localhost\.tauri\.app$/,
        ];
        if (!origin || allowed.some((p) => p.test(origin))) return origin;
        return null;
      },
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 86400,
    }),
  );
  // Global rate limit: 100 req/min per IP
  app.use('/api/*', rateLimiter(100, 60_000));
  app.use('/api/*', authMiddleware);

  // Public webhook endpoint (external services, HMAC auth)
  app.route('/webhooks', webhookRouter);
  app.route('/health', healthRouter);
  app.route('/.well-known', agentsRouter);
  app.route('/api/agents', agentsRouter);
  app.route('/api/projects', projectsRouter);
  app.route('/api/deliverables', deliverablesRouter);
  app.route('/api/projects', deliverablesRouter);
  app.route('/api/projects', documentsRouter);
  // Scheduled tasks merged into workflows — /api/scheduled-tasks removed
  app.route('/api/evaluations', evaluationsRouter);
  app.route('/api/secretary', secretaryRouter);
  app.route('/api/decisions', decisionsRouter);
  // Meeting route removed — Secretary handles multi-agent coordination
  // app.route('/api/meetings', meetingsRouter);
  app.route('/api/factory', workflowsRouter);
  app.route('/api/dashboard', dashboardRouter);

  app.route('/api/settings', settingsRouter);
  app.route('/api/skills', skillsRouter);
  app.route('/api/memory', memoryRouter);
  app.route('/api/employees', employeesRouter);
  app.route('/api/files', filesRouter);
  app.route('/api/audit', auditRouter);
  app.route('/api/backups', backupsRouter);
  app.route('/api/rules', rulesRouter);
  app.route('/api/progress', progressRouter);
  app.route('/api/observability', observabilityRouter);
  app.route('/api/insights', insightsRouter);
  app.route('/api/harness', harnessRouter);
  app.route('/api/slot', externalAgentRouter);
  app.route('/api/external', externalAgentRouter);
  app.route('/api/daemon', daemonRouter);
  app.route('/api/autopilots', autopilotRouter);
  app.route('/api/squads', squadRouter);
  app.route('/api/telemetry', telemetryRouter);
  app.route('/api/tasks', tasksRouter);

  // GeoIP proxy — avoids CORS issues with ipapi.co from browser
  app.get('/api/geoip', async (c) => {
    try {
      const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      return c.json(data);
    } catch {
      return c.json({ city: null });
    }
  });

  // Weather proxy — avoids CORS issues with open-meteo.com from browser
  app.get('/api/weather', async (c) => {
    const lat = c.req.query('lat') || '40.7';
    const lon = c.req.query('lon') || '-74.0';
    try {
      const res = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=auto`,
        { signal: AbortSignal.timeout(8000) },
      );
      const data = await res.json();
      return c.json(data);
    } catch {
      return c.json({ error: 'Weather API unavailable' }, 502);
    }
  });

  app.route('/api', openapiRouter());

  return app;
}
