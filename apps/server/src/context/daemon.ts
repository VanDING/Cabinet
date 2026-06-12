import { createDaemonContext } from '../daemon-context.js';
import type { BuildState } from './build-state.js';

export function initDaemon(state: BuildState): void {
  const { db, agentRegistry } = state;
  if (!db || !agentRegistry) {
    throw new Error('Missing required state for daemon');
  }

  const daemonContext = createDaemonContext(db, agentRegistry, {
    info: (msg, ctx) => state.logger?.info(msg, ctx as Record<string, unknown>),
    warn: (msg, ctx) => state.logger?.warn(msg, ctx as Record<string, unknown>),
    error: (msg, ctx) => state.logger?.error(msg, ctx as Record<string, unknown>),
  });
  daemonContext.daemon.start().catch((e: unknown) => {
    state.logger?.warn('Agent daemon start failed', { error: String(e) });
  });
  daemonContext.wsClient.connect();

  state.daemonContext = daemonContext;
  state.daemon = daemonContext.daemon;
  state.taskQueueRepo = daemonContext.taskQueueRepo;
  state.daemonRepo = daemonContext.daemonRepo;
}
