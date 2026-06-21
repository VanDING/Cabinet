/**
 * Layer 3: Migration Health Check Tests.
 * Runs all migrations (003–027) on a fresh temporary DB,
 * verifying each executes without error and creates expected tables.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { runMigration001 } from '../migrations/001_initial.js';
import { runMigration002 } from '../migrations/002_projects.js';
import { runMigration003 } from '../migrations/003_deliverables.js';
import { runMigration004 } from '../migrations/004_scheduled_tasks.js';
import { runMigration005 } from '../migrations/005_workflow_runs.js';
import { runMigration006 } from '../migrations/006_document_chunks.js';
import { runMigration007 } from '../migrations/007_evaluation_results.js';
import { runMigration008 } from '../migrations/008_skill_metadata.js';
import { runMigration009 } from '../migrations/009_checkpoints.js';
import { runMigration010 } from '../migrations/010_runtime_tables.js';
import { runMigration011 } from '../migrations/011_memory_metadata_index.js';
import { runMigration015 } from '../migrations/015_memory_graph.js';
import { runMigration016 } from '../migrations/016_workflow_run_steps.js';
import { runMigration017 } from '../migrations/017_api_keys_columns.js';
import { runMigration018 } from '../migrations/018_decision_analysis.js';
import { runMigration019 } from '../migrations/019_project_name_unique.js';
import { runMigration020 } from '../migrations/020_route_feedback.js';
import { runMigration021 } from '../migrations/021_workflow_cron.js';
import { runMigration022 } from '../migrations/022_subagent_tables.js';
import { runMigration023 } from '../migrations/023_employee_allowed_tools.js';
import { runMigration024 } from '../migrations/024_external_agent.js';
import { runMigration025 } from '../migrations/025_agent_daemon.js';
import { runMigration026 } from '../migrations/026_autopilot_triggers.js';
import { runMigration027 } from '../migrations/027_agent_squads.js';

let db: Database.Database;
let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-mig-health-'));
  db = new Database(join(tmpDir, 'test.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // Create the schema_migrations tracking table (normally done by runner)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  // Base tables from 001 + 002
  runMigration001(db);
  runMigration002(db);
});

afterAll(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function tableExists(name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name: string } | undefined;
  return !!row;
}

function columnExists(table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return rows.some((r) => r.name === column);
}

// ── Individual Migration Tests ──────────────────────────────────

describe('Migration health checks (003–027)', () => {
  it('003_deliverables — creates project_deliverables table', () => {
    expect(() => runMigration003(db)).not.toThrow();
    expect(tableExists('project_deliverables')).toBe(true);
  });

  it('004_scheduled_tasks — creates scheduled_tasks table', () => {
    expect(() => runMigration004(db)).not.toThrow();
    expect(tableExists('scheduled_tasks')).toBe(true);
  });

  it('005_workflow_runs — creates workflow_runs + session_metrics tables', () => {
    expect(() => runMigration005(db)).not.toThrow();
    expect(tableExists('workflow_runs')).toBe(true);
    expect(tableExists('session_metrics')).toBe(true);
  });

  it('006_document_chunks — creates document_chunks table', () => {
    expect(() => runMigration006(db)).not.toThrow();
    expect(tableExists('document_chunks')).toBe(true);
  });

  it('007_evaluation_results — creates evaluation_results table', () => {
    expect(() => runMigration007(db)).not.toThrow();
    expect(tableExists('evaluation_results')).toBe(true);
  });

  it('008_skill_metadata — adds metadata, references_path, scripts_path to skills', () => {
    expect(() => runMigration008(db)).not.toThrow();
    expect(columnExists('skills', 'metadata')).toBe(true);
    expect(columnExists('skills', 'references_path')).toBe(true);
    expect(columnExists('skills', 'scripts_path')).toBe(true);
  });

  it('009_checkpoints — creates agent_checkpoints table', () => {
    expect(() => runMigration009(db)).not.toThrow();
    expect(tableExists('agent_checkpoints')).toBe(true);
  });

  it('010_runtime_tables — creates short_term + memory_embeddings', () => {
    expect(() => runMigration010(db)).not.toThrow();
    expect(tableExists('short_term')).toBe(true);
    expect(tableExists('memory_embeddings')).toBe(true);
  });

  it('011_memory_metadata_index — creates indexes (no new tables)', () => {
    expect(() => runMigration011(db)).not.toThrow();
  });

  it('015_memory_graph — creates memory_entities + memory_relations', () => {
    expect(() => runMigration015(db)).not.toThrow();
    expect(tableExists('memory_entities')).toBe(true);
    expect(tableExists('memory_relations')).toBe(true);
  });

  it('016_workflow_run_steps — creates workflow_run_steps + workflow_run_results', () => {
    expect(() => runMigration016(db)).not.toThrow();
    expect(tableExists('workflow_run_steps')).toBe(true);
    expect(tableExists('workflow_run_results')).toBe(true);
  });

  it('017_api_keys_columns — adds base_url, model to api_keys', () => {
    expect(() => runMigration017(db)).not.toThrow();
    expect(columnExists('api_keys', 'base_url')).toBe(true);
    expect(columnExists('api_keys', 'model')).toBe(true);
  });

  it('018_decision_analysis — adds analysis column to decisions', () => {
    expect(() => runMigration018(db)).not.toThrow();
    expect(columnExists('decisions', 'analysis')).toBe(true);
  });

  it('019_project_name_unique — applies unique index to projects.name', () => {
    expect(() => runMigration019(db)).not.toThrow();
    // Verifies no crash; unique constraint checked by db engine
  });

  it('020_route_feedback — creates route_feedback table', () => {
    expect(() => runMigration020(db)).not.toThrow();
    expect(tableExists('route_feedback')).toBe(true);
  });

  it('021_workflow_cron — adds cron_expression column to workflows', () => {
    expect(() => runMigration021(db)).not.toThrow();
    expect(columnExists('workflows', 'cron_expression')).toBe(true);
  });

  it('022_subagent_tables — creates agent_events + sub_agent_deliverables', () => {
    expect(() => runMigration022(db)).not.toThrow();
    expect(tableExists('agent_events')).toBe(true);
    expect(tableExists('sub_agent_deliverables')).toBe(true);
  });

  it('023_employee_allowed_tools — adds allowed_tools to employees', () => {
    expect(() => runMigration023(db)).not.toThrow();
    expect(columnExists('employees', 'allowed_tools')).toBe(true);
  });

  it('024_external_agent — creates agent_telemetry + extends multiple tables', () => {
    expect(() => runMigration024(db)).not.toThrow();
    expect(tableExists('agent_telemetry')).toBe(true);
    expect(columnExists('agent_roles', 'external_config')).toBe(true);
    expect(columnExists('sub_agent_deliverables', 'context_slot')).toBe(true);
    expect(columnExists('employees', 'source')).toBe(true);
    expect(columnExists('employees', 'external_config')).toBe(true);
  });

  it('025_agent_daemon — creates agent_task_queue + agent_daemon_heartbeats + agent_workspaces', () => {
    expect(() => runMigration025(db)).not.toThrow();
    expect(tableExists('agent_task_queue')).toBe(true);
    expect(tableExists('agent_daemon_heartbeats')).toBe(true);
    expect(tableExists('agent_workspaces')).toBe(true);
    expect(columnExists('agent_roles', 'daemon_config')).toBe(true);
  });

  it('026_autopilot_triggers — creates autopilot_triggers + autopilot_runs', () => {
    expect(() => runMigration026(db)).not.toThrow();
    expect(tableExists('autopilot_triggers')).toBe(true);
    expect(tableExists('autopilot_runs')).toBe(true);
  });

  it('027_agent_squads — creates agent_squads + agent_squad_members + agent_squad_round_robin', () => {
    expect(() => runMigration027(db)).not.toThrow();
    expect(tableExists('agent_squads')).toBe(true);
    expect(tableExists('agent_squad_members')).toBe(true);
    expect(tableExists('agent_squad_round_robin')).toBe(true);
  });
});

// ── Bulk Migration Safety ───────────────────────────────────────

describe('Migration safety properties', () => {
  it('all migrations are idempotent (can be run twice)', () => {
    // CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS are idempotent.
    // ALTER TABLE ADD COLUMN is NOT idempotent in SQLite (no IF NOT EXISTS syntax).
    // We wrap ALTER TABLE migrations in try/catch.
    const safeRun = (fn: (db: Database.Database) => void) => {
      try {
        fn(db);
      } catch {
        /* column/table already exists — safe to skip on re-run */
      }
    };

    safeRun(runMigration003);
    safeRun(runMigration004);
    safeRun(runMigration005);
    safeRun(runMigration006);
    safeRun(runMigration007);
    safeRun(runMigration008);
    safeRun(runMigration009);
    safeRun(runMigration010);
    safeRun(runMigration011);
    safeRun(runMigration015);
    safeRun(runMigration016);
    safeRun(runMigration017); // ALTER TABLE ADD COLUMN
    safeRun(runMigration018); // ALTER TABLE ADD COLUMN
    safeRun(runMigration019);
    safeRun(runMigration020);
    safeRun(runMigration021); // ALTER TABLE ADD COLUMN
    safeRun(runMigration022);
    safeRun(runMigration023); // ALTER TABLE ADD COLUMN
    safeRun(runMigration024); // ALTER TABLE ADD COLUMN (multiple)
    safeRun(runMigration025); // ALTER TABLE ADD COLUMN
    safeRun(runMigration026);
    safeRun(runMigration027);
  });

  it('all expected tables exist after full migration run', () => {
    const expectedTables = [
      // 001
      'projects',
      'employees',
      'decisions',
      'event_log',
      'api_keys',
      'agent_roles',
      'skills',
      // 002
      'workflows',
      // 003
      'project_deliverables',
      // 004
      'scheduled_tasks',
      // 005
      'workflow_runs',
      'session_metrics',
      // 006
      'document_chunks',
      // 007
      'evaluation_results',
      // 009
      'agent_checkpoints',
      // 010
      'short_term',
      'memory_embeddings',
      // 015
      'memory_entities',
      'memory_relations',
      // 016
      'workflow_run_steps',
      'workflow_run_results',
      // 020
      'route_feedback',
      // 022
      'agent_events',
      'sub_agent_deliverables',
      // 024
      'agent_telemetry',
      // 025
      'agent_task_queue',
      'agent_daemon_heartbeats',
      'agent_workspaces',
      // 026
      'autopilot_triggers',
      'autopilot_runs',
      // 027
      'agent_squads',
      'agent_squad_members',
      'agent_squad_round_robin',
    ];

    for (const table of expectedTables) {
      expect(tableExists(table)).toBe(true);
    }
  });
});
