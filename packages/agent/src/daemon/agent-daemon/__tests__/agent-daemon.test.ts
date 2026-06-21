import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TaskQueueRow } from '@cabinet/storage';
import { AgentDaemon } from '../daemon.js';

// ── Mock infrastructure modules (outside agent-daemon/) ──
// WARNING: Do NOT use vi.fn() inside these factory functions — vitest
// hoists them to a context where vi.fn may not behave correctly with `new`.

vi.mock('../../workspace-manager.js', () => ({
  WorkspaceManager: function () {
    return {
      createWorkspace: () => '/tmp/workspace/test',
      runGC: () => ({ cleaned: 0, freedBytes: 0 }),
      rootDir: '/tmp/workspace',
    };
  },
}));

vi.mock('../../../discovery/scanner.js', () => ({
  Scanner: function () {
    return {
      discover: () => Promise.resolve([]),
      getLastResults: () => [],
      scanAll: () => Promise.resolve([]),
    };
  },
}));

vi.mock('../../task-queue-poller.js', () => ({
  TaskQueuePoller: function () {
    return {
      start: () => {},
      stop: () => {},
      onWSConnected: () => {},
      onWSDisconnected: () => {},
    };
  },
}));

vi.mock('../../squad/squad-router.js', () => ({
  SquadRouter: function () {
    return { route: () => {} };
  },
}));

// ── Mock sub-modules with real side effects ──

vi.mock('../metrics.js', () => ({
  collectProcessMetrics: () => {},
  scanAllListeningPorts: () => [],
  scanPortsForPid: () => [],
  killOrphanPort: () => true,
}));

vi.mock('../adapters.js', () => ({
  getAdapter: () => null,
  getHarnessRuntime: () => null,
  buildHarnessContext: () => ({}),
}));

vi.mock('../execution.js', () => ({
  executeAssignedTask: () => Promise.resolve(true),
  claimAndExecute: () => Promise.resolve(false),
  recoverOrphanedTasks: () => {},
  startHeartbeat: () => {
    return { unref: () => {} };
  },
}));

vi.mock('@cabinet/storage', () => ({
  SquadRepository: function () {
    return {};
  },
}));

// ── Helpers ──

function mockTaskRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'task-1',
    agent_id: 'agent-1',
    session_id: 'session-1',
    capability: 'default',
    input: JSON.stringify({ test: true }),
    slot_json: JSON.stringify({
      version: 1,
      project: { name: 'test', goals: [] },
      memories: [],
      preferences: {},
      files: [],
      discoveries: [],
      previous_outputs: [],
      security: { level: 'low', maxRetries: 3 },
    }),
    status: 'pending',
    priority: 0,
    retry_count: 0,
    max_retries: 3,
    timeout_ms: 300_000,
    claimed_by: null,
    claimed_at: null,
    started_at: null,
    completed_at: null,
    progress_json: '{}',
    error_message: null,
    output_json: null,
    cron_expression: null,
    webhook_url: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ── Suite ──

describe('AgentDaemon', () => {
  let taskRepo: Record<string, ReturnType<typeof vi.fn>>;
  let daemonRepo: Record<string, ReturnType<typeof vi.fn>>;
  let registry: Record<string, ReturnType<typeof vi.fn>>;
  let daemon: AgentDaemon;

  beforeEach(() => {
    vi.clearAllMocks();

    taskRepo = {
      enqueue: vi.fn().mockImplementation((row: TaskQueueRow) => row.id),
      findById: vi.fn(),
      updateStatus: vi.fn(),
      claimNext: vi.fn(),
      findByStatus: vi.fn().mockReturnValue([]),
      findByAgent: vi.fn().mockReturnValue([]),
      countByStatus: vi.fn().mockReturnValue({}),
      findStaleClaims: vi.fn().mockReturnValue([]),
      resetStaleClaims: vi.fn().mockReturnValue(0),
      retryTask: vi.fn(),
      claimSpecific: vi.fn(),
    };

    daemonRepo = {
      upsertHeartbeat: vi.fn(),
      updateWorkspaceLastUsed: vi.fn(),
      createWorkspace: vi.fn(),
      findExpiredWorkspaces: vi.fn().mockReturnValue([]),
      deleteWorkspace: vi.fn(),
      findWorkspacesByAgent: vi.fn().mockReturnValue([]),
    };

    registry = {
      get: vi.fn().mockReturnValue(null),
      register: vi.fn(),
      list: vi.fn().mockReturnValue([]),
    };

    daemon = new AgentDaemon(taskRepo as any, daemonRepo as any, registry as any, {
      daemonId: 'test-daemon',
      autoDiscoverOnStart: false,
    });
  });

  afterEach(async () => {
    try {
      await daemon.stop();
    } catch {
      // best-effort
    }
  });

  // ── 1. Construction ──

  describe('construction', () => {
    it('instantiates with default options when none provided', () => {
      const d = new AgentDaemon(taskRepo as any, daemonRepo as any, registry as any);
      expect(d).toBeInstanceOf(AgentDaemon);
    });

    it('uses provided daemonId in status', () => {
      const status = daemon.getStatus();
      expect(status.daemonId).toBe('test-daemon');
      expect(status.status).toBe('online');
      expect(status.activeTaskCount).toBe(0);
      expect(status.completedTaskCount).toBe(0);
      expect(status.failedTaskCount).toBe(0);
    });

    it('returns a TaskQueuePoller from getPoller', () => {
      const poller = daemon.getPoller();
      expect(poller).toBeDefined();
      expect(typeof poller.start).toBe('function');
    });
  });

  // ── 2. start / stop lifecycle ──

  describe('start / stop lifecycle', () => {
    it('start returns discovery results', async () => {
      const results = await daemon.start();
      expect(Array.isArray(results)).toBe(true);
    });

    it('start triggers auto-discovery when autoDiscoverOnStart is true', async () => {
      const d = new AgentDaemon(taskRepo as any, daemonRepo as any, registry as any, {
        daemonId: 'discover-daemon',
        autoDiscoverOnStart: true,
      });
      const results = await d.start();
      expect(Array.isArray(results)).toBe(true);
      await d.stop();
    });

    it('start returns discovered agents', async () => {
      const d = new AgentDaemon(taskRepo as any, daemonRepo as any, registry as any, {
        daemonId: 'discover-daemon-2',
        autoDiscoverOnStart: false,
      });
      const results = await d.start();
      expect(results).toEqual([]);
      await d.stop();
    });

    it('status shows online after start', async () => {
      await daemon.start();
      const status = daemon.getStatus();
      expect(status.status).toBe('online');
      expect(status.uptimeMs).toBeGreaterThanOrEqual(0);
    });

    it('stop clears state', async () => {
      await daemon.start();
      await daemon.stop();
      const status = daemon.getStatus();
      expect(status.activeTaskCount).toBe(0);
    });

    it('stop is safe to call multiple times', async () => {
      await daemon.start();
      await daemon.stop();
      await daemon.stop();
      expect(daemon.getStatus().status).toBe('online');
    });
  });

  // ── 3. enqueueTask ──

  describe('enqueueTask', () => {
    const validParams = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      input: { query: 'hello' },
      slot: {
        version: 1,
        project: { name: 'test', goals: [] },
        memories: [],
        preferences: {},
        files: [],
        discoveries: [],
        previous_outputs: [],
        security: { level: 'low', maxRetries: 3 },
      },
    };

    it('returns a task ID string', async () => {
      const id = await daemon.enqueueTask(validParams);
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^task_/);
    });

    it('calls taskRepo.enqueue with valid row', async () => {
      await daemon.enqueueTask(validParams);
      expect(taskRepo.enqueue).toHaveBeenCalledTimes(1);
      const row = (taskRepo.enqueue as any).mock.calls[0][0];
      expect(row.agent_id).toBe('agent-1');
      expect(row.session_id).toBe('session-1');
      expect(row.status).toBe('pending');
    });

    it('accepts optional capability and priority', async () => {
      await daemon.enqueueTask({ ...validParams, capability: 'code-review', priority: 5 });
      const row = (taskRepo.enqueue as any).mock.calls[0][0];
      expect(row.capability).toBe('code-review');
      expect(row.priority).toBe(5);
    });

    it('accepts custom maxRetries and timeoutMs', async () => {
      await daemon.enqueueTask({ ...validParams, maxRetries: 1, timeoutMs: 60_000 });
      const row = (taskRepo.enqueue as any).mock.calls[0][0];
      expect(row.max_retries).toBe(1);
      expect(row.timeout_ms).toBe(60_000);
    });
  });

  // ── 4. cancelTask ──

  describe('cancelTask', () => {
    it('cancels a pending task and returns true', () => {
      taskRepo.findById.mockReturnValue(mockTaskRow({ status: 'pending' }));
      const result = daemon.cancelTask('task-1');
      expect(result).toBe(true);
      expect(taskRepo.updateStatus).toHaveBeenCalledWith('task-1', 'cancelled');
    });

    it('returns false for non-existent task', () => {
      taskRepo.findById.mockReturnValue(null);
      expect(daemon.cancelTask('ghost-task')).toBe(false);
    });

    it('returns false for already completed task', () => {
      taskRepo.findById.mockReturnValue(mockTaskRow({ status: 'completed' }));
      expect(daemon.cancelTask('task-1')).toBe(false);
    });

    it('returns false for already cancelled task', () => {
      taskRepo.findById.mockReturnValue(mockTaskRow({ status: 'cancelled' }));
      expect(daemon.cancelTask('task-1')).toBe(false);
    });
  });

  // ── 5. getDaemonStatus ──

  describe('getDaemonStatus', () => {
    it('returns expected shape', () => {
      const status = daemon.getStatus();
      expect(status).toHaveProperty('daemonId');
      expect(status).toHaveProperty('status');
      expect(status).toHaveProperty('uptimeMs');
      expect(status).toHaveProperty('activeTaskCount');
      expect(status).toHaveProperty('completedTaskCount');
      expect(status).toHaveProperty('failedTaskCount');
      expect(status).toHaveProperty('agents');
      expect(status).toHaveProperty('orphanPorts');
    });

    it('starts with zero counts', () => {
      const status = daemon.getStatus();
      expect(status.completedTaskCount).toBe(0);
      expect(status.failedTaskCount).toBe(0);
      expect(status.activeTaskCount).toBe(0);
    });

    it('agents array is empty when no agents discovered', () => {
      const status = daemon.getStatus();
      expect(status.agents).toEqual([]);
    });

    it('orphanPorts is an array', () => {
      const status = daemon.getStatus();
      expect(Array.isArray(status.orphanPorts)).toBe(true);
    });
  });

  // ── 6. Event emission (state delegation) ──

  describe('event emission', () => {
    it('setWSClient stores the client', () => {
      const client = { sendCompleted: vi.fn(), sendFailed: vi.fn() } as any;
      daemon.setWSClient(client);
      // stored internally; should not throw
    });

    it('executeAssignedTask delegates to execution module', async () => {
      const result = await daemon.executeAssignedTask('task-1');
      expect(result).toBe(true);
    });

    it('retryTask delegates to taskRepo', () => {
      taskRepo.retryTask.mockReturnValue(mockTaskRow({ status: 'pending', retry_count: 1 }));
      const result = daemon.retryTask('task-1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('task-1');
      expect(taskRepo.retryTask).toHaveBeenCalledWith('task-1');
    });

    it('getTask returns task via taskRepo', () => {
      taskRepo.findById.mockReturnValue(mockTaskRow());
      const result = daemon.getTask('task-1');
      expect(result).not.toBeNull();
      expect(result?.id).toBe('task-1');
    });

    it('listTasks returns tasks via taskRepo', () => {
      taskRepo.findByStatus.mockReturnValue([mockTaskRow()]);
      const results = daemon.listTasks({ status: 'pending' });
      expect(results.length).toBe(1);
    });

    it('getDiscoveredAgents returns results from discoverer', () => {
      const results = daemon.getDiscoveredAgents();
      expect(Array.isArray(results)).toBe(true);
    });

    it('triggerDiscovery returns results', async () => {
      const results = await daemon.triggerDiscovery();
      expect(Array.isArray(results)).toBe(true);
    });

    it('getPorts returns agent ports and orphans', () => {
      const result = daemon.getPorts();
      expect(result).toHaveProperty('agentPorts');
      expect(result).toHaveProperty('orphans');
    });

    it('setSquadRouter does not throw', () => {
      const db = { prepare: vi.fn() } as any;
      expect(() => daemon.setSquadRouter(db)).not.toThrow();
    });

    it('setAgentRoleRepo does not throw', () => {
      const repo = { findAgentRole: vi.fn() } as any;
      expect(() => daemon.setAgentRoleRepo(repo)).not.toThrow();
    });

    it('hasAgent checks adapter cache', () => {
      // getAdapter returns null in the mock, so hasAgent should return false
      expect(daemon.hasAgent('unknown-agent')).toBe(false);
    });
  });

  // ── 7. Error handling ──

  describe('error handling', () => {
    it('cancelTask propagates taskRepo.findById error', () => {
      taskRepo.findById.mockImplementation(() => {
        throw new Error('DB error');
      });
      expect(() => daemon.cancelTask('task-1')).toThrow('DB error');
    });

    it('getTask returns null when taskRepo returns null', () => {
      taskRepo.findById.mockReturnValue(null);
      const result = daemon.getTask('task-err');
      expect(result).toBeNull();
    });

    it('retryTask returns null when taskRepo.retryTask returns null', () => {
      taskRepo.retryTask.mockReturnValue(null);
      const result = daemon.retryTask('nonexistent');
      expect(result).toBeNull();
    });

    it('getStatus does not throw when repos are functional', () => {
      expect(() => daemon.getStatus()).not.toThrow();
    });

    it('listTasks with agentId filter delegates correctly', () => {
      taskRepo.findByAgent.mockReturnValue([mockTaskRow()]);
      const results = daemon.listTasks({ agentId: 'agent-1' });
      expect(results.length).toBe(1);
      expect(taskRepo.findByAgent).toHaveBeenCalledWith('agent-1', undefined, undefined);
    });

    it('listTasks with agentId and status filter delegates correctly', () => {
      taskRepo.findByAgent.mockReturnValue([mockTaskRow()]);
      daemon.listTasks({ agentId: 'agent-1', status: 'running' });
      expect(taskRepo.findByAgent).toHaveBeenCalledWith('agent-1', 'running', undefined);
    });

    it('listTasks with limit parameter', () => {
      taskRepo.findByStatus.mockReturnValue([mockTaskRow()]);
      daemon.listTasks({ status: 'pending', limit: 5 });
      expect(taskRepo.findByStatus).toHaveBeenCalledWith('pending', 5);
    });

    it('listTasks with no filter uses default limit', () => {
      taskRepo.findByStatus.mockReturnValue([]);
      const results = daemon.listTasks();
      expect(results).toEqual([]);
      expect(taskRepo.findByStatus).toHaveBeenCalledWith(['pending', 'claimed', 'running'], 50);
    });

    it('killOrphanPort delegates to metrics', () => {
      const result = daemon.killOrphanPort(8080);
      expect(result).toBe(true);
    });

    it('runWorkspaceGC delegates to workspace manager', () => {
      const result = daemon.runWorkspaceGC();
      expect(result).toBeDefined();
    });
  });
});
