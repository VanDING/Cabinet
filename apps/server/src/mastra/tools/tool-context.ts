import { getServerContext } from '../../context.js';
import { broadcast } from '../../ws/handler.js';
import type { ServerContext } from '../../context/types.js';

let cachedCtx: ServerContext | null = null;

function ctx(): ServerContext {
  if (!cachedCtx) {
    cachedCtx = getServerContext();
  }
  return cachedCtx;
}

export const toolServices = {
  get decision() {
    return ctx().decisionService;
  },
  get eventBus() {
    return ctx().eventBus;
  },
  get agentEventBus() {
    return ctx().agentEventBus;
  },
  get agentRegistry() {
    return ctx().agentRegistry;
  },
  get skillRegistry() {
    return ctx().skillRegistry;
  },
  get sessionManager() {
    return ctx().sessionManager;
  },
  get taskScheduler() {
    return ctx().taskScheduler;
  },
  get backupManager() {
    return ctx().backupManager;
  },
  get logger() {
    return ctx().logger;
  },
  get mcpManager() {
    return ctx().mcpManager;
  },
  broadcast(event: string, data?: Record<string, unknown>) {
    broadcast(event, data);
  },
};
