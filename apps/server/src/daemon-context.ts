//
// Daemon Context — wires AgentDaemon + WSDaemonClient into the server lifecycle.
//
// Creates repository instances, instantiates the AgentDaemon with all
// dependencies, creates the WebSocket daemon client, and returns a
// cleanup function for server shutdown.
//

import { hostname } from 'node:os';
import WebSocket from 'ws';
import {
  AgentTaskQueueRepository,
  AgentDaemonRepository,
} from '@cabinet/storage';
import { AgentDaemon, WSDaemonClient } from '@cabinet/agent';
import type { AgentRoleRegistry, WSCtor } from '@cabinet/agent';
import type { Database } from 'better-sqlite3';

export interface DaemonContext {
  daemon: AgentDaemon;
  wsClient: WSDaemonClient;
  taskQueueRepo: AgentTaskQueueRepository;
  daemonRepo: AgentDaemonRepository;
  shutdown: () => Promise<void>;
}

export function createDaemonContext(
  db: Database,
  registry: AgentRoleRegistry,
  logger: { info: (msg: string, ctx?: unknown) => void; warn: (msg: string, ctx?: unknown) => void; error: (msg: string, ctx?: unknown) => void },
): DaemonContext {
  const taskQueueRepo = new AgentTaskQueueRepository(db);
  const daemonRepo = new AgentDaemonRepository(db);

  const daemonId = `daemon_${hostname()}`;

  const daemon = new AgentDaemon(
    taskQueueRepo,
    daemonRepo,
    registry,
    {
      daemonId,
      pollIntervalMs: 3000,
      heartbeatIntervalMs: 15_000,
      heartbeatTimeoutMs: 60_000,
      maxConcurrentTasks: 3,
      taskTimeoutMs: 300_000,
      autoDiscoverOnStart: true,
    },
    logger,
  );

  // ── WebSocket Client (real-time task push) ──
  const wsCtor: WSCtor = WebSocket as unknown as WSCtor;

  const wsClient = new WSDaemonClient(wsCtor, {
    wsUrl: 'ws://127.0.0.1:3000/ws',
    daemonId,
    agentId: '__daemon__',
    capabilities: [],
    reconnectBaseMs: 1000,
    reconnectMaxMs: 30_000,
  });

  // Wire WS client into daemon for progress reporting
  daemon.setWSClient(wsClient);

  // Wire squad router for team-based task routing
  daemon.setSquadRouter(db);

  // When WS connects, suspend polling
  wsClient.onConnected = () => {
    daemon.getPoller().onWSConnected();
    logger.info('Daemon WS connected', { daemonId });
  };

  // When WS disconnects, resume polling
  wsClient.onDisconnected = () => {
    daemon.getPoller().onWSDisconnected();
    logger.warn('Daemon WS disconnected — falling back to polling', { daemonId });
  };

  // When server pushes a task via WS, execute it immediately
  wsClient.onTaskAssigned = async (task: unknown) => {
    const taskId = (task as any)?.id as string;
    if (!taskId) return;
    try {
      await daemon.executeAssignedTask(taskId);
    } catch (err) {
      logger.warn('WS-assigned task execution failed', { taskId, error: String(err) });
    }
  };

  return {
    daemon,
    wsClient,
    taskQueueRepo,
    daemonRepo,
    shutdown: async () => {
      wsClient.disconnect();
      await daemon.stop();
    },
  };
}
