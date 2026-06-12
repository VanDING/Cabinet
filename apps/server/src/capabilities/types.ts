import type { ServerContext } from '../context.js';

export interface CapabilitiesContext {
  db: ServerContext['db'];
  gateway: ServerContext['gateway'];
  logger: ServerContext['logger'];
  taskScheduler: ServerContext['taskScheduler'];
  workflowRepo: ServerContext['workflowRepo'];
  projectRepo: ServerContext['projectRepo'];
}
