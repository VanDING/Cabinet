export interface ShortTermEntry {
  key: string;
  value: unknown;
  timestamp: Date;
  ttl: number; // milliseconds
  sessionId: string;
}

export class ShortTermMemory {
  private cache = new Map<string, ShortTermEntry>();
  private readonly defaultTtl = 30 * 60 * 1000; // 30 minutes

  set(sessionId: string, key: string, value: unknown, ttl?: number): void {
    this.cache.set(`${sessionId}:${key}`, {
      key,
      value,
      timestamp: new Date(),
      ttl: ttl ?? this.defaultTtl,
      sessionId,
    });
  }

  get(sessionId: string, key: string): unknown | null {
    const entry = this.cache.get(`${sessionId}:${key}`);
    if (!entry) return null;
    if (Date.now() - entry.timestamp.getTime() > entry.ttl) {
      this.cache.delete(`${sessionId}:${key}`);
      return null;
    }
    return entry.value;
  }

  getAll(sessionId: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [k, entry] of this.cache) {
      if (entry.sessionId === sessionId && Date.now() - entry.timestamp.getTime() <= entry.ttl) {
        result[entry.key] = entry.value;
      }
    }
    return result;
  }

  clear(sessionId: string): void {
    for (const [k, entry] of this.cache) {
      if (entry.sessionId === sessionId) this.cache.delete(k);
    }
  }

  size(): number { return this.cache.size; }
}
