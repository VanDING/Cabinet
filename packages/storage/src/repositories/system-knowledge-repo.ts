import type { Database } from 'better-sqlite3';

export interface SystemKnowledgeEntry {
  id: string;
  topic: string;
  category: 'infrastructure' | 'capability' | 'constraint' | 'agent';
  content: string;
  version: number;
  metadata: string;
  updated_at: string;
}

export class SystemKnowledgeRepository {
  constructor(private db: Database) {}

  ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS system_knowledge (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        category TEXT NOT NULL,
        content TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sk_topic ON system_knowledge(topic);
      CREATE INDEX IF NOT EXISTS idx_sk_category ON system_knowledge(category);
    `);
  }

  upsert(entry: Omit<SystemKnowledgeEntry, 'updated_at'>): void {
    this.db.prepare(
      `INSERT INTO system_knowledge (id, topic, category, content, version, metadata, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET
         topic = excluded.topic,
         category = excluded.category,
         content = excluded.content,
         version = excluded.version,
         metadata = excluded.metadata,
         updated_at = datetime('now')`
    ).run(
      entry.id,
      entry.topic,
      entry.category,
      entry.content,
      entry.version,
      entry.metadata
    );
  }

  findByTopic(topic: string): SystemKnowledgeEntry | undefined {
    return this.db.prepare(
      'SELECT * FROM system_knowledge WHERE topic = ?'
    ).get(topic) as SystemKnowledgeEntry | undefined;
  }

  findByCategory(category: string): SystemKnowledgeEntry[] {
    return this.db.prepare(
      'SELECT * FROM system_knowledge WHERE category = ? ORDER BY topic'
    ).all(category) as SystemKnowledgeEntry[];
  }

  search(query: string, limit = 5): Array<Pick<SystemKnowledgeEntry, 'topic' | 'content' | 'category'>> {
    const pattern = `%${query}%`;
    return this.db.prepare(
      `SELECT topic, content, category FROM system_knowledge
       WHERE topic LIKE ? OR content LIKE ?
       ORDER BY topic
       LIMIT ?`
    ).all(pattern, pattern, limit) as Array<Pick<SystemKnowledgeEntry, 'topic' | 'content' | 'category'>>;
  }

  findAll(): SystemKnowledgeEntry[] {
    return this.db.prepare(
      'SELECT * FROM system_knowledge ORDER BY category, topic'
    ).all() as SystemKnowledgeEntry[];
  }

  getVersion(id: string): number {
    const row = this.db.prepare(
      'SELECT version FROM system_knowledge WHERE id = ?'
    ).get(id) as { version: number } | undefined;
    return row?.version ?? 0;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM system_knowledge WHERE id = ?').run(id);
  }
}
