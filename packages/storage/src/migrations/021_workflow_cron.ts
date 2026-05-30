import type Database from 'better-sqlite3';

export function runMigration021(db: Database.Database): void {
  db.exec(`
    ALTER TABLE workflows ADD COLUMN cron_expression TEXT;
  `);
}
