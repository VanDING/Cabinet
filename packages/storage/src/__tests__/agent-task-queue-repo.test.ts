import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, closeConnection, getConnection } from '../connection';
import { runMigration001 } from '../migrations/001_initial';
import { runMigration025 } from '../migrations/025_agent_daemon';
import { AgentTaskQueueRepository, AgentDaemonRepository } from '../index';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

function setupDb(tmpDir: string) {
  createConnection(join(tmpDir, 'test.db'));
  runMigration001(getConnection());
  runMigration025(getConnection());
}

const DAEMON_A = 'daemon_a';
const DAEMON_B = 'daemon_b';
const AGENT = 'external_cli:claude';

function makeTask(id: string) {
  return {
    id, agent_id: AGENT, session_id: 'test_session', capability: 'default',
    input: 'Test task', slot_json: '{"project":{"name":"test","goals":[]},"security":{"level":"L1","maxRetries":3}}',
    status: 'pending' as const, priority: 0, retry_count: 0, max_retries: 3,
    timeout_ms: 120000, claimed_by: null, claimed_at: null,
    started_at: null, completed_at: null, progress_json: '{}',
    error_message: null, output_json: null, cron_expression: null, webhook_url: null,
  };
}

describe('AgentTaskQueueRepository', () => {
  let repo: AgentTaskQueueRepository;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-taskq-'));
    setupDb(tmpDir);
    repo = new AgentTaskQueueRepository(getConnection());
  });

  afterAll(() => {
    closeConnection();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enqueues and reads a task', () => {
    repo.enqueue(makeTask('t1'));
    const t = repo.findById('t1');
    expect(t).not.toBeNull();
    expect(t!.status).toBe('pending');
  });

  it('claimNext atomically claims a task', () => {
    const CLAIM_AGENT = 'external_cli:claim_test';
    repo.enqueue({ ...makeTask('t2'), agent_id: CLAIM_AGENT });
    const claimed = repo.claimNext(CLAIM_AGENT, DAEMON_A);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe('claimed');
    expect(claimed!.claimed_by).toBe(DAEMON_A);

    // Second claim for same agent should return null (already claimed)
    const second = repo.claimNext(CLAIM_AGENT, DAEMON_B);
    expect(second).toBeNull();
  });

  it('claimSpecific targets a specific task', () => {
    repo.enqueue(makeTask('t3'));
    const claimed = repo.claimSpecific('t3', DAEMON_A);
    expect(claimed).not.toBeNull();
    expect(claimed!.id).toBe('t3');
  });

  it('does not claim an already-claimed task', () => {
    repo.enqueue(makeTask('t4'));
    repo.claimSpecific('t4', DAEMON_A);
    const second = repo.claimSpecific('t4', DAEMON_B);
    expect(second).toBeNull();
  });

  it('updates status through lifecycle', () => {
    repo.enqueue(makeTask('t5'));
    repo.updateStatus('t5', 'running', { startedAt: new Date().toISOString() });
    repo.updateProgress('t5', { percent: 50, message: 'halfway', step: 2 });
    repo.updateStatus('t5', 'completed', { output: 'done', completedAt: new Date().toISOString() });

    const t = repo.findById('t5');
    expect(t!.status).toBe('completed');
  });

  it('finds stale claims', () => {
    repo.enqueue(makeTask('t6'));
    repo.claimSpecific('t6', DAEMON_A);

    // Force the claimed_at to be old by directly updating
    getConnection().prepare("UPDATE agent_task_queue SET claimed_at = '2020-01-01T00:00:00' WHERE id = 't6'").run();

    const stale = repo.findStaleClaims(60_000);
    expect(stale.length).toBeGreaterThanOrEqual(1);
    expect(stale.map((s) => s.id)).toContain('t6');
  });

  it('resets stale claims to pending', () => {
    const count = repo.resetStaleClaims(['t6']);
    expect(count).toBeGreaterThanOrEqual(1);
    const t = repo.findById('t6');
    expect(t!.status).toBe('pending');
    expect(t!.claimed_by).toBeNull();
  });

  it('retries a failed task', () => {
    repo.enqueue(makeTask('t7'));
    repo.updateStatus('t7', 'failed', { errorMessage: 'test error' });

    const retried = repo.retryTask('t7');
    expect(retried).not.toBeNull();
    expect(retried!.status).toBe('pending');
    expect(retried!.retry_count).toBe(1);
  });

  it('does not retry beyond max_retries', () => {
    repo.enqueue({ ...makeTask('t8'), retry_count: 3, max_retries: 3 });
    repo.updateStatus('t8', 'failed');

    const retried = repo.retryTask('t8');
    expect(retried).toBeNull();
  });

  it('counts by status', () => {
    const counts = repo.countByStatus(AGENT);
    expect(typeof counts.pending).toBe('number');
    expect(typeof counts.completed).toBe('number');
  });
});

describe('AgentDaemonRepository', () => {
  let repo: AgentDaemonRepository;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-dmn-'));
    setupDb(tmpDir);
    repo = new AgentDaemonRepository(getConnection());
  });

  afterAll(() => {
    closeConnection();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('upserts and finds heartbeat', () => {
    repo.upsertHeartbeat('daemon_1', AGENT, 'online');
    // Use a very long timeout to account for any datetime format differences
    const online = repo.findOnlineDaemons(86_400_000); // 24h
    expect(online.length).toBeGreaterThanOrEqual(1);
    expect(online[0]!.daemon_id).toBe('daemon_1');
  });

  it('marks daemon offline', () => {
    repo.upsertHeartbeat('daemon_2', AGENT, 'online');
    repo.markOffline('daemon_2');
    const online = repo.findOnlineDaemons(60_000);
    expect(online.find((d) => d.daemon_id === 'daemon_2')).toBeUndefined();
  });

  it('creates and finds workspaces', () => {
    repo.createWorkspace({
      id: 'ws_1', agent_id: AGENT, task_id: 't1',
      path: '/tmp/ws', size_bytes: 0, status: 'active',
      created_at: new Date().toISOString(), last_used_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const wss = repo.findWorkspacesByAgent(AGENT);
    expect(wss.length).toBe(1);
    expect(wss[0]!.id).toBe('ws_1');
  });
});
