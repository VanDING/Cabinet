import Database from 'better-sqlite3';

export interface ShortTermEntry {
  key: string;
  value: unknown;
  timestamp: Date;
  ttl: number;
  sessionId: string;
}

export class ShortTermMemory {
  private cache = new Map<string, ShortTermEntry>();
  private readonly accessOrder: string[] = [];
  private readonly defaultTtl = 30 * 60 * 1000;
  private readonly maxSize: number;
  private db: Database.Database | null;

  constructor(db?: Database.Database, maxSize = 1000) {
    this.db = db ?? null;
    this.maxSize = maxSize;
    if (this.db) {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS short_term (
          session_id TEXT NOT NULL,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          timestamp TEXT NOT NULL DEFAULT (datetime('now')),
          ttl INTEGER NOT NULL DEFAULT 1800000,
          PRIMARY KEY (session_id, key)
        );
        CREATE INDEX IF NOT EXISTS idx_short_term_session ON short_term(session_id);
      `);
    }
  }

  set(sessionId: string, key: string, value: unknown, ttl?: number): void {
    const fullKey = `${sessionId}:${key}`;

    // LRU eviction — also clean up DB to avoid orphaned rows
    if (this.cache.size >= this.maxSize && !this.cache.has(fullKey)) {
      const lru = this.accessOrder.shift();
      if (lru) {
        this.cache.delete(lru);
        if (this.db) {
          const [sid, key] = lru.split(':', 2);
          if (sid && key) {
            this.db.prepare('DELETE FROM short_term WHERE session_id = ? AND key = ?').run(sid, key);
          }
        }
      }
    }

    const entry: ShortTermEntry = {
      key,
      value,
      timestamp: new Date(),
      ttl: ttl ?? this.defaultTtl,
      sessionId,
    };
    this.cache.set(fullKey, entry);

    // Update LRU order
    const idx = this.accessOrder.indexOf(fullKey);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
    this.accessOrder.push(fullKey);

    // Persist to DB
    if (this.db) {
      this.db.prepare(
        `INSERT OR REPLACE INTO short_term (session_id, key, value, timestamp, ttl)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(sessionId, key, JSON.stringify(value), entry.timestamp.toISOString(), entry.ttl);
    }
  }

  get(sessionId: string, key: string): unknown | null {
    const fullKey = `${sessionId}:${key}`;
    let entry = this.cache.get(fullKey);

    // Check TTL
    if (entry && Date.now() - entry.timestamp.getTime() > entry.ttl) {
      this.cache.delete(fullKey);
      const idx = this.accessOrder.indexOf(fullKey);
      if (idx !== -1) this.accessOrder.splice(idx, 1);
      if (this.db) {
        this.db.prepare('DELETE FROM short_term WHERE session_id = ? AND key = ?').run(sessionId, key);
      }
      return null;
    }

    if (entry) {
      // Move to MRU end
      const idx = this.accessOrder.indexOf(fullKey);
      if (idx !== -1) { this.accessOrder.splice(idx, 1); this.accessOrder.push(fullKey); }
      return entry.value;
    }

    // Try DB
    if (this.db) {
      const row = this.db.prepare(
        'SELECT * FROM short_term WHERE session_id = ? AND key = ?',
      ).get(sessionId, key) as any;
      if (row) {
        if (Date.now() - new Date(row.timestamp).getTime() > (row.ttl ?? this.defaultTtl)) {
          this.db.prepare('DELETE FROM short_term WHERE session_id = ? AND key = ?').run(sessionId, key);
          return null;
        }
        const value = JSON.parse(row.value ?? 'null');
        this.cache.set(fullKey, {
          key, value, sessionId,
          timestamp: new Date(row.timestamp),
          ttl: row.ttl ?? this.defaultTtl,
        });
        this.accessOrder.push(fullKey);
        return value;
      }
    }

    return null;
  }

  getAllSessionIds(): string[] {
    return [...new Set([...this.cache.values()].map((e) => e.sessionId))];
  }

  /** Expose session IDs for server-level iteration (used by consolidation timer). */
  get _store(): Map<string, ShortTermEntry> {
    return this.cache;
  }

  getAll(sessionId: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const now = Date.now();

    for (const [k, entry] of this.cache) {
      if (entry.sessionId === sessionId && now - entry.timestamp.getTime() <= entry.ttl) {
        result[entry.key] = entry.value;
      }
    }

    // Load from DB for this session
    if (this.db) {
      const rows = this.db.prepare(
        'SELECT * FROM short_term WHERE session_id = ?',
      ).all(sessionId) as any[];
      for (const row of rows) {
        if (!(row.key in result)) {
          if (now - new Date(row.timestamp).getTime() <= (row.ttl ?? this.defaultTtl)) {
            result[row.key] = JSON.parse(row.value ?? 'null');
          }
        }
      }
    }

    return result;
  }

  clear(sessionId: string): void {
    for (const [k, entry] of this.cache) {
      if (entry.sessionId === sessionId) {
        this.cache.delete(k);
        const idx = this.accessOrder.indexOf(k);
        if (idx !== -1) this.accessOrder.splice(idx, 1);
      }
    }
    if (this.db) {
      this.db.prepare('DELETE FROM short_term WHERE session_id = ?').run(sessionId);
    }
  }

  size(): number {
    return this.cache.size;
  }
}
