//
// Migration 028 — Decision Comments (approval discussion threads).
//
// Adds a lightweight comment/discussion system for decisions, enabling
// multi-turn approval discussions directly on decision items.
//

import type Database from 'better-sqlite3';

export function runMigration028(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS decision_comments (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      author_id TEXT NOT NULL DEFAULT 'captain',
      author_name TEXT NOT NULL DEFAULT 'Captain',
      content TEXT NOT NULL,
      parent_comment_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (decision_id) REFERENCES decisions(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_comment_id) REFERENCES decision_comments(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_decision_comments_decision
      ON decision_comments(decision_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_decision_comments_parent
      ON decision_comments(parent_comment_id);
  `);
}
