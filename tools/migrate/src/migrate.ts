/**
 * Cabinet Python → TypeScript Data Migration Tool
 *
 * Migrates data from the Python Cabinet (SQLite) to the new TypeScript Cabinet.
 *
 * Usage:
 *   cd tools/migrate && pnpm migrate --source <python-cabinet-db> --target <ts-cabinet-db>
 */
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';

interface MigrationReport {
  organizations: number;
  projects: number;
  employees: number;
  decisions: number;
  events: number;
  errors: string[];
}

function migrate(sourcePath: string, targetPath: string): MigrationReport {
  const report: MigrationReport = {
    organizations: 0, projects: 0, employees: 0, decisions: 0, events: 0, errors: [],
  };

  if (!existsSync(sourcePath)) {
    report.errors.push(`Source database not found: ${sourcePath}`);
    return report;
  }

  const source = new Database(sourcePath, { readonly: true });
  const target = new Database(targetPath);

  // Enable WAL
  target.pragma('journal_mode = WAL');
  target.pragma('foreign_keys = ON');

  try {
    // Migrate organizations
    try {
      const orgs = source.prepare('SELECT * FROM organizations').all() as any[];
      for (const org of orgs) {
        target.prepare(
          'INSERT OR REPLACE INTO organizations (id, name, captain_id, created_at) VALUES (?, ?, ?, ?)'
        ).run(org.id ?? org.uuid, org.name, org.captain_id ?? 'default', org.created_at ?? new Date().toISOString());
        report.organizations++;
      }
    } catch (e) { report.errors.push(`organizations: ${(e as Error).message}`); }

    // Migrate decisions
    try {
      const decisions = source.prepare('SELECT * FROM decisions').all() as any[];
      for (const d of decisions) {
        target.prepare(
          `INSERT OR REPLACE INTO decisions (id, project_id, type, level, status, title, description, options, chosen_option_id, captain_id, created_at, resolved_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          d.id ?? d.uuid, d.project_id ?? 'default',
          d.type ?? 'strategic', d.level ?? 'L2', d.status ?? 'pending',
          d.title ?? '', d.description ?? '', d.options ?? '[]',
          d.chosen_option_id ?? null, d.captain_id ?? null,
          d.created_at ?? new Date().toISOString(), d.resolved_at ?? null
        );
        report.decisions++;
      }
    } catch (e) { report.errors.push(`decisions: ${(e as Error).message}`); }

    // Migrate events
    try {
      const events = source.prepare('SELECT * FROM event_log').all() as any[];
      for (const ev of events) {
        target.prepare(
          `INSERT OR REPLACE INTO event_log (message_id, correlation_id, causation_id, type, payload, timestamp)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          ev.message_id ?? ev.id, ev.correlation_id ?? 'migrated',
          ev.causation_id ?? null, ev.type ?? ev.message_type ?? 'system_notification',
          ev.payload ?? '{}', ev.timestamp ?? new Date().toISOString()
        );
        report.events++;
      }
    } catch (e) { report.errors.push(`events: ${(e as Error).message}`); }

    // Try to migrate employees
    try {
      const employees = source.prepare('SELECT * FROM employees').all() as any[];
      for (const emp of employees) {
        target.prepare(
          `INSERT OR REPLACE INTO employees (id, project_id, name, role, kind, pipeline_config, persona, permission_level)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          emp.id ?? emp.uuid, emp.project_id ?? 'default',
          emp.name, emp.role ?? 'advisor', emp.kind ?? 'ai',
          emp.pipeline_config ?? null, emp.persona ?? null,
          emp.permission_level ?? 'read'
        );
        report.employees++;
      }
    } catch { /* employees table may not exist in old version */ }

    // Try to migrate projects
    try {
      const projects = source.prepare('SELECT * FROM projects').all() as any[];
      for (const proj of projects) {
        target.prepare(
          `INSERT OR REPLACE INTO projects (id, organization_id, name, description, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          proj.id ?? proj.uuid, proj.organization_id ?? 'default',
          proj.name, proj.description ?? '', proj.status ?? 'active',
          proj.created_at ?? new Date().toISOString()
        );
        report.projects++;
      }
    } catch { /* projects table may not exist */ }

    console.log('Migration complete:');
    console.log(`  Organizations: ${report.organizations}`);
    console.log(`  Projects: ${report.projects}`);
    console.log(`  Employees: ${report.employees}`);
    console.log(`  Decisions: ${report.decisions}`);
    console.log(`  Events: ${report.events}`);
    if (report.errors.length > 0) {
      console.log(`  Errors: ${report.errors.length}`);
      for (const err of report.errors) console.log(`    - ${err}`);
    }
  } finally {
    source.close();
    target.close();
  }

  return report;
}

// Parse CLI args
const args = process.argv.slice(2);
let sourcePath = '';
let targetPath = '';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--source' && args[i + 1]) sourcePath = args[++i]!;
  else if (args[i] === '--target' && args[i + 1]) targetPath = args[++i]!;
}

if (!sourcePath || !targetPath) {
  console.log('Usage: pnpm migrate --source <python-cabinet.db> --target <cabinet.db>');
  process.exit(1);
}

migrate(sourcePath, targetPath);
