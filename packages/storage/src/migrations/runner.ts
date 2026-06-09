import type Database from 'better-sqlite3';
import { trackMigration } from './001_initial.js';
import { runMigration001 } from './001_initial.js';
import { runMigration002 } from './002_projects.js';
import { runMigration003 } from './003_deliverables.js';
import { runMigration004 } from './004_scheduled_tasks.js';
import { runMigration005 } from './005_workflow_runs.js';
import { runMigration006 } from './006_document_chunks.js';
import { runMigration007 } from './007_evaluation_results.js';
import { runMigration008 } from './008_skill_metadata.js';
import { runMigration009 } from './009_checkpoints.js';
import { runMigration010 } from './010_runtime_tables.js';
import { runMigration011 } from './011_memory_metadata_index.js';
import { runMigration015 } from './015_memory_graph.js';
import { runMigration016 } from './016_workflow_run_steps.js';
import { runMigration017 } from './017_api_keys_columns.js';
import { runMigration018 } from './018_decision_analysis.js';
import { runMigration019 } from './019_project_name_unique.js';
import { runMigration020 } from './020_route_feedback.js';
import { runMigration021 } from './021_workflow_cron.js';
import { runMigration022 } from './022_subagent_tables.js';
import { runMigration023 } from './023_employee_allowed_tools.js';
import { runMigration024 } from './024_external_agent.js';
import { runMigration025 } from './025_agent_daemon.js';
import { runMigration026 } from './026_autopilot_triggers.js';
import { runMigration027 } from './027_agent_squads.js';
import { runMigration028 } from './028_decision_comments.js';
import { runMigration029 } from './029_step_events.js';
export interface MigrationEntry {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

/** All migrations in application order. Add new migrations at the end. */
export const MIGRATIONS: MigrationEntry[] = [
  { version: 1, name: '001_initial', up: runMigration001 },
  { version: 2, name: '002_projects', up: runMigration002 },
  { version: 3, name: '003_deliverables', up: runMigration003 },
  { version: 4, name: '004_scheduled_tasks', up: runMigration004 },
  { version: 5, name: '005_workflow_runs', up: runMigration005 },
  { version: 6, name: '006_document_chunks', up: runMigration006 },
  { version: 7, name: '007_evaluation_results', up: runMigration007 },
  { version: 8, name: '008_skill_metadata', up: runMigration008 },
  { version: 9, name: '009_checkpoints', up: runMigration009 },
  { version: 10, name: '010_runtime_tables', up: runMigration010 },
  { version: 11, name: '011_memory_metadata_index', up: runMigration011 },
  { version: 15, name: '015_memory_graph', up: runMigration015 },
  { version: 16, name: '016_workflow_run_steps', up: runMigration016 },
  { version: 17, name: '017_api_keys_columns', up: runMigration017 },
  { version: 18, name: '018_decision_analysis', up: runMigration018 },
  { version: 19, name: '019_project_name_unique', up: runMigration019 },
  { version: 20, name: '020_route_feedback', up: runMigration020 },
  { version: 21, name: '021_workflow_cron', up: runMigration021 },
  { version: 22, name: '022_subagent_tables', up: runMigration022 },
  { version: 23, name: '023_employee_allowed_tools', up: runMigration023 },
  { version: 24, name: '024_external_agent', up: runMigration024 },
  { version: 25, name: '025_agent_daemon', up: runMigration025 },
  { version: 26, name: '026_autopilot_triggers', up: runMigration026 },
  { version: 27, name: '027_agent_squads', up: runMigration027 },
  { version: 28, name: '028_decision_comments', up: runMigration028 },
  { version: 29, name: '029_step_events', up: runMigration029 },
];

/**
 * Run all pending migrations in order.
 * Each migration runs in its own transaction.
 * Already-applied migrations are skipped.
 */
export function runMigrations(db: Database.Database): void {
  // Ensure schema_migrations table exists (may not if DB is brand new)
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Read already-applied versions
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map(
      (r) => r.version,
    ),
  );

  let appliedCount = 0;

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    const runInTransaction = db.transaction(() => {
      migration.up(db);
      trackMigration(db, migration.version);
    });
    runInTransaction();

    appliedCount++;
  }

  if (appliedCount > 0) {
    // Use stdout directly so it works even without a logger instance
    console.log(
      `[storage] Applied ${appliedCount} migration(s): ${MIGRATIONS.filter(
        (m) => !applied.has(m.version),
      )
        .map((m) => m.name)
        .join(', ')}`,
    );
  }
}
