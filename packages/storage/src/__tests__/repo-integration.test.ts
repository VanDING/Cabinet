/**
 * Layer 2: Core Repository Integration Tests.
 * Tests workflow-repo, agent-role-repo, settings-repo with temporary SQLite DB.
 * Follows the pattern from repositories.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createConnection, closeConnection, getConnection } from '../connection.js';
import { runMigration001 } from '../migrations/001_initial.js';
import { runMigration005 } from '../migrations/005_workflow_runs.js';
import { runMigration010 } from '../migrations/010_runtime_tables.js';
import { runMigration016 } from '../migrations/016_workflow_run_steps.js';
import { runMigration021 } from '../migrations/021_workflow_cron.js';
import { runMigration022 } from '../migrations/022_subagent_tables.js';
import { runMigration024 } from '../migrations/024_external_agent.js';
import { WorkflowRepository } from '../repositories/workflow-repo.js';
import { AgentRoleRepository } from '../repositories/agent-role-repo.js';
import { SettingsRepository } from '../repositories/settings-repo.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

let tmpDir: string;

function setupDb() {
  const dbPath = join(tmpDir, 'test.db');
  createConnection(dbPath);
  const db = getConnection();
  runMigration001(db);
  // model_tier column on agent_roles exists in production via manual migration gap
  try { db.exec('ALTER TABLE agent_roles ADD COLUMN model_tier TEXT'); } catch { /* already exists */ }
  runMigration005(db);
  runMigration010(db);
  runMigration016(db);
  runMigration021(db);
  runMigration022(db);
  runMigration024(db);
}

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-repo-int-'));
  setupDb();
});

afterAll(() => {
  closeConnection();
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── WorkflowRepository ──────────────────────────────────────────

describe('WorkflowRepository', () => {
  let repo: WorkflowRepository;

  beforeAll(() => {
    repo = new WorkflowRepository(getConnection());
    // Insert a project so foreign key constraints pass
    getConnection()
      .prepare("INSERT OR IGNORE INTO projects (id, name, description, status) VALUES (?, ?, ?, ?)")
      .run('proj_test', 'Test Project', 'For integration tests', 'active');
    getConnection()
      .prepare("INSERT OR IGNORE INTO projects (id, name, description, status) VALUES (?, ?, ?, ?)")
      .run('proj_other', 'Other Project', 'For integration tests', 'active');
  });

  describe('CRUD', () => {
    const wfId = 'wf_test_1';
    const projectId = 'proj_test';

    it('create + findById', () => {
      repo.create(wfId, projectId, 'Test Workflow', JSON.stringify({ steps: [] }), 'draft');
      const found = repo.findById(wfId);
      expect(found).not.toBeNull();
      expect(found!.name).toBe('Test Workflow');
      expect(found!.project_id).toBe(projectId);
      expect(found!.status).toBe('draft');
      expect(found!.cron_expression).toBeNull();
    });

    it('create with cron expression', () => {
      const id = 'wf_cron_1';
      repo.create(id, projectId, 'Cron WF', '{}', 'active', '0 9 * * *');
      const found = repo.findById(id);
      expect(found!.cron_expression).toBe('0 9 * * *');
    });

    it('updateStatus', () => {
      repo.updateStatus(wfId, 'active');
      const found = repo.findById(wfId);
      expect(found!.status).toBe('active');
    });

    it('updateNameAndDefinition — partial update (name only)', () => {
      repo.updateNameAndDefinition(wfId, 'Renamed WF');
      const found = repo.findById(wfId);
      expect(found!.name).toBe('Renamed WF');
    });

    it('updateNameAndDefinition — partial update (definition only)', () => {
      repo.updateNameAndDefinition(wfId, undefined, '{"steps":["new"]}');
      const found = repo.findById(wfId);
      expect(found!.definition).toBe('{"steps":["new"]}');
    });

    it('listByProject returns filtered results', () => {
      const otherProj = 'proj_other';
      repo.create('wf_other', otherProj, 'Other WF', '{}', 'draft');
      const list = repo.listByProject(projectId);
      expect(list.every((w) => w.project_id === projectId)).toBe(true);
    });

    it('listAll returns all workflows', () => {
      const list = repo.listAll();
      expect(list.length).toBeGreaterThanOrEqual(2);
    });

    it('countByStatus counts correctly', () => {
      const count = repo.countByStatus(['active', 'draft']);
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it('findByCron returns workflows with cron expressions', () => {
      const cronWfs = repo.findByCron();
      expect(cronWfs.every((w) => w.cron_expression !== null)).toBe(true);
    });

    it('updateCron sets and clears cron expression', () => {
      const id = 'wf_cron_update';
      repo.create(id, projectId, 'Cron Update', '{}', 'draft');
      repo.updateCron(id, '*/10 * * * *');
      expect(repo.findById(id)!.cron_expression).toBe('*/10 * * * *');
      repo.updateCron(id, null);
      expect(repo.findById(id)!.cron_expression).toBeNull();
    });

    it('delete removes a workflow', () => {
      const id = 'wf_delete_me';
      repo.create(id, projectId, 'Delete Me', '{}');
      expect(repo.findById(id)).not.toBeNull();
      repo.delete(id);
      expect(repo.findById(id)).toBeNull();
    });
  });

  describe('Workflow Runs', () => {
    it('saveRun + findRunById', () => {
      repo.saveRun({
        run_id: 'run_1',
        workflow_id: 'wf_test_1',
        status: 'running',
        current_node_id: 'node_1',
        steps: '[]',
        results: '{}',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      const run = repo.findRunById('run_1');
      expect(run).not.toBeNull();
      expect(run!.status).toBe('running');
      expect(run!.workflow_id).toBe('wf_test_1');
    });

    it('findRunsByWorkflow filters correctly', () => {
      const runs = repo.findRunsByWorkflow('wf_test_1');
      expect(runs.every((r) => r.workflow_id === 'wf_test_1')).toBe(true);
    });

    it('findRunsByStatus filters by status array', () => {
      const runs = repo.findRunsByStatus(['running']);
      expect(runs.every((r) => r.status === 'running')).toBe(true);
    });

    it('updateRunStatus changes status', () => {
      repo.saveRun({
        run_id: 'run_status',
        workflow_id: 'wf_test_1',
        status: 'pending',
        current_node_id: null,
        steps: '[]',
        results: '{}',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      repo.updateRunStatus('run_status', 'completed');
      expect(repo.findRunById('run_status')!.status).toBe('completed');
    });

    it('failAwaitingRuns transitions awaiting runs to failed', () => {
      repo.saveRun({
        run_id: 'run_await',
        workflow_id: 'wf_test_1',
        status: 'awaiting_approval',
        current_node_id: null,
        steps: '[]',
        results: '{}',
        started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      repo.failAwaitingRuns('wf_test_1');
      const run = repo.findRunById('run_await');
      expect(run!.status).toBe('failed');
    });
  });
});

// ── AgentRoleRepository ──────────────────────────────────────────

describe('AgentRoleRepository', () => {
  let repo: AgentRoleRepository;

  beforeAll(() => {
    repo = new AgentRoleRepository(getConnection());
  });

  const sampleRole = {
    type: 'custom',
    name: 'test_agent_role',
    description: 'A test agent role',
    system_prompt: 'You are a test agent.',
    model: 'claude-sonnet-4-6',
    model_tier: 'default',
    temperature: 0.7,
    max_response_tokens: 4096,
    allowed_tools: '["read_file","write_file"]',
    context_budget: 100000,
    is_builtin: 0,
    created_at: new Date().toISOString(),
  };

  it('upsert creates a new role', () => {
    repo.upsert(sampleRole);
    const found = repo.findByName('test_agent_role');
    expect(found).not.toBeNull();
    expect(found!.type).toBe('custom');
    expect(found!.description).toBe('A test agent role');
    expect(found!.temperature).toBe(0.7);
    expect(found!.allowed_tools).toBe('["read_file","write_file"]');
  });

  it('upsert updates an existing role (idempotent)', () => {
    const updated = { ...sampleRole, description: 'Updated description' };
    repo.upsert(updated);
    const found = repo.findByName('test_agent_role');
    expect(found!.description).toBe('Updated description');
  });

  it('findByType finds roles by type', () => {
    const found = repo.findByType('custom');
    expect(found).not.toBeNull();
    expect(found!.type).toBe('custom');
  });

  it('findByType returns null for missing type', () => {
    const found = repo.findByType('nonexistent_type');
    expect(found).toBeNull();
  });

  it('findAll returns all roles', () => {
    const all = repo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });

  it('findBuiltin returns only built-in roles', () => {
    const builtins = repo.findBuiltin();
    expect(builtins.every((r) => r.is_builtin === 1)).toBe(true);
  });

  it('findCustom returns only custom roles', () => {
    const customs = repo.findCustom();
    expect(customs.every((r) => r.is_builtin === 0)).toBe(true);
    expect(customs.some((r) => r.name === 'test_agent_role')).toBe(true);
  });

  it('update changes specific fields', () => {
    repo.update('test_agent_role', {
      temperature: 0.3,
      max_response_tokens: 8192,
    });
    const found = repo.findByName('test_agent_role');
    expect(found!.temperature).toBe(0.3);
    expect(found!.max_response_tokens).toBe(8192);
    // other fields unchanged
    expect(found!.description).toBe('Updated description');
  });

  it('deleteByName removes a role', () => {
    repo.upsert({ ...sampleRole, name: 'to_delete' });
    expect(repo.findByName('to_delete')).not.toBeNull();
    repo.deleteByName('to_delete');
    expect(repo.findByName('to_delete')).toBeNull();
  });
});

// ── SettingsRepository ──────────────────────────────────────────

describe('SettingsRepository', () => {
  let repo: SettingsRepository;

  beforeAll(() => {
    repo = new SettingsRepository(getConnection());
  });

  it('get returns null for unset key', () => {
    expect(repo.get('nonexistent_key')).toBeNull();
  });

  it('set + get round-trips a value', () => {
    repo.set('theme', 'dark');
    expect(repo.get('theme')).toBe('dark');
  });

  it('set overwrites an existing key', () => {
    repo.set('theme', 'light');
    expect(repo.get('theme')).toBe('light');
  });

  it('set + get for complex JSON value', () => {
    repo.set('dashboard_layout', JSON.stringify({ widgets: ['chat', 'metrics'] }));
    const val = repo.get('dashboard_layout');
    expect(val).toBe('{"widgets":["chat","metrics"]}');
    // Verify it round-trips through JSON.parse
    expect(JSON.parse(val!).widgets).toEqual(['chat', 'metrics']);
  });

  it('delete removes a key', () => {
    repo.set('temp_key', 'temp_value');
    expect(repo.get('temp_key')).toBe('temp_value');
    repo.delete('temp_key');
    expect(repo.get('temp_key')).toBeNull();
  });

  it('handles multiple keys independently', () => {
    repo.set('k1', 'v1');
    repo.set('k2', 'v2');
    expect(repo.get('k1')).toBe('v1');
    expect(repo.get('k2')).toBe('v2');
    repo.delete('k1');
    expect(repo.get('k1')).toBeNull();
    expect(repo.get('k2')).toBe('v2'); // k2 unaffected
  });
});
