import { ShortTermMemoryRepository, type Database } from '@cabinet/storage';

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
  private repo: ShortTermMemoryRepository | null;

  constructor(db?: Database, maxSize = 1000) {
    this.repo = db ? new ShortTermMemoryRepository(db) : null;
    this.repo?.ensureTable();
    this.maxSize = maxSize;
  }

  set(sessionId: string, key: string, value: unknown, ttl?: number): void {
    const fullKey = `${sessionId}:${key}`;

    // LRU eviction — also clean up DB to avoid orphaned rows
    if (this.cache.size >= this.maxSize && !this.cache.has(fullKey)) {
      const lru = this.accessOrder.shift();
      if (lru) {
        this.cache.delete(lru);
        if (this.repo) {
          const [sid, key] = lru.split(':', 2);
          if (sid && key) {
            this.repo.delete(sid, key);
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
    if (this.repo) {
      this.repo.upsert(sessionId, key, JSON.stringify(value), entry.ttl);
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
      if (this.repo) {
        this.repo.delete(sessionId, key);
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
    if (this.repo) {
      const row = this.repo.findBySessionAndKey(sessionId, key);
      if (row) {
        const ts = new Date(row.timestamp + 'Z').getTime();
        if (Date.now() - ts > (row.ttl ?? this.defaultTtl)) {
          this.repo.delete(sessionId, key);
          return null;
        }
        const value = JSON.parse(row.value ?? 'null');
        this.cache.set(fullKey, {
          key, value, sessionId,
          timestamp: new Date(ts),
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
    if (this.repo) {
      const rows = this.repo.findBySession(sessionId);
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

  delete(sessionId: string, key: string): void {
    const fullKey = `${sessionId}:${key}`;
    this.cache.delete(fullKey);
    const idx = this.accessOrder.indexOf(fullKey);
    if (idx !== -1) this.accessOrder.splice(idx, 1);
    if (this.repo) {
      this.repo.delete(sessionId, key);
    }
  }

  clear(sessionId: string): void {
    for (const [k, entry] of this.cache) {
      if (entry.sessionId === sessionId) {
        this.cache.delete(k);
        const idx = this.accessOrder.indexOf(k);
        if (idx !== -1) this.accessOrder.splice(idx, 1);
      }
    }
    if (this.repo) {
      this.repo.deleteBySession(sessionId);
    }
  }

  size(): number {
    return this.cache.size;
  }
}
