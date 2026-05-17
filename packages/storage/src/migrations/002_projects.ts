import type Database from 'better-sqlite3';

export function runMigration002(db: Database.Database): void {
  // Disable foreign keys during migration to allow table rebuilds
  db.pragma('foreign_keys = OFF');

  try {
    // Drop organizations table (no longer needed)
    db.exec(`DROP TABLE IF EXISTS organizations;`);

    // Check if projects table already has the new schema
    const existingCols = db.pragma('table_info(projects)') as { name: string }[];
    const hasNewColumns = existingCols.some((c) => c.name === 'root_path');

    if (!hasNewColumns) {
      // Check for old organization_id column
      const hasOrgId = existingCols.some((c) => c.name === 'organization_id');

      // Rebuild projects table without organization_id, with new columns
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          root_path TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0,
          last_activity_at TEXT,
          icon TEXT NOT NULL DEFAULT 'folder',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);

      // Migrate existing project data (skip organization_id)
      db.exec(`
        INSERT OR IGNORE INTO projects_new (id, name, description, status, created_at)
          SELECT id, name, description, status, created_at FROM projects
          WHERE NOT EXISTS (SELECT 1 FROM projects_new WHERE projects_new.id = projects.id);
      `);

      // Drop old projects table and rename new one
      db.exec(`DROP TABLE IF EXISTS projects;`);
      db.exec(`ALTER TABLE projects_new RENAME TO projects;`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);`);
    }

    // Project-level structured memory
    db.exec(`
      CREATE TABLE IF NOT EXISTS project_context (
        project_id TEXT PRIMARY KEY REFERENCES projects(id),
        summary TEXT NOT NULL DEFAULT '',
        goals TEXT NOT NULL DEFAULT '[]',
        constraints TEXT NOT NULL DEFAULT '{}',
        tech_summary TEXT NOT NULL DEFAULT '',
        risk_map TEXT NOT NULL DEFAULT '[]',
        key_decisions TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  } finally {
    db.pragma('foreign_keys = ON');
  }

  // Conditional: add project_id to long_term_memory if table exists
  try {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='long_term_memory'")
      .get();
    if (tableExists) {
      try {
        db.exec(`ALTER TABLE long_term_memory ADD COLUMN project_id TEXT DEFAULT ''`);
      } catch {
        // Column may already exist
      }
      try {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_ltm_project ON long_term_memory(project_id)`);
      } catch {
        // Index may already exist
      }
    }
  } catch {
    // Table doesn't exist — memory system not initialized yet, safe to skip
  }
}
