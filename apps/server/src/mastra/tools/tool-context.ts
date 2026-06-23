import { getServerContext } from '../../context.js';
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
  get memory() {
    return ctx().memoryFacade;
  },
  get shortTerm() {
    return ctx().shortTerm;
  },
  get longTerm() {
    return ctx().longTerm;
  },
  get entity() {
    return ctx().entity;
  },
  get knowledgeGraph() {
    return ctx().knowledgeGraph;
  },
  get eventBus() {
    return ctx().eventBus;
  },
  get agentEventBus() {
    return ctx().agentEventBus;
  },
  get gateway() {
    return ctx().gateway;
  },
  get costTracker() {
    return ctx().costTracker;
  },
  get budgetGuard() {
    return ctx().budgetGuard;
  },
  get agentRegistry() {
    return ctx().agentRegistry;
  },
  get skillRegistry() {
    return ctx().skillRegistry;
  },
  get observability() {
    return ctx().observability;
  },
  get daemon() {
    return ctx().daemon;
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
};
