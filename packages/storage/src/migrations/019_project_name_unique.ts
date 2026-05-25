import type Database from 'better-sqlite3';

export function runMigration019(db: Database.Database): void {
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_name_unique
    ON projects(name);
  `);
}
