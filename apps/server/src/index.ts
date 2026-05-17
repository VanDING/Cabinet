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
import { memoryRouter } from './routes/memory.js';
import { employeesRouter } from './routes/employees.js';
import { filesRouter } from './routes/files.js';
import { auditRouter } from './routes/audit.js';
import { backupsRouter } from './routes/backups.js';
import { gcRouter } from './routes/gc.js';
import { verifyRouter } from './routes/verify.js';
import { rulesRouter } from './routes/rules.js';
import { progressRouter } from './routes/progress.js';
import { observabilityRouter } from './routes/observability.js';
import { agentsRouter } from './routes/agents.js';
import { projectsRouter } from './routes/projects.js';
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
      allowHeaders: ['Content-Type', 'x-cabinet-pin'],
      maxAge: 86400,
    }),
  );
  // Global rate limit: 100 req/min per IP
  app.use('/api/*', rateLimiter(100, 60_000));
  // Stricter rate limit for auth endpoint: 5 req/min per IP
  app.use('/api/auth/verify', rateLimiter(5, 60_000));
  app.use('/api/*', authMiddleware);

  app.route('/health', healthRouter);
  app.route('/.well-known', agentsRouter);
  app.route('/api/agents', agentsRouter);
  app.route('/api/projects', projectsRouter);
  app.route('/api/secretary', secretaryRouter);
  app.route('/api/decisions', decisionsRouter);
  app.route('/api/meetings', meetingsRouter);
  app.route('/api/factory', workflowsRouter);
  app.route('/api/dashboard', dashboardRouter);
  app.route('/api/settings', settingsRouter);
  app.route('/api/auth', authRouter);
  app.route('/api/skills', skillsRouter);
  app.route('/api/memory', memoryRouter);
  app.route('/api/employees', employeesRouter);
  app.route('/api/files', filesRouter);
  app.route('/api/audit', auditRouter);
  app.route('/api/backups', backupsRouter);
  app.route('/api/gc', gcRouter);
  app.route('/api/verify', verifyRouter);
  app.route('/api/rules', rulesRouter);
  app.route('/api/progress', progressRouter);
  app.route('/api/observability', observabilityRouter);
  app.route('/api', openapiRouter());

  return app;
}
