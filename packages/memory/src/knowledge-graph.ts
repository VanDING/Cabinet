import type Database from 'better-sqlite3';

export interface Entity {
  id: string;
  name: string;
  type: string;
  frequency: number;
  metadata: Record<string, unknown>;
}

export interface Relation {
  id: string;
  fromId: string;
  toId: string;
  relation: string;
  strength: number;
  metadata: Record<string, unknown>;
}

/**
 * Lightweight knowledge graph backed by SQLite.
 *
 * Stores entities (people, projects, concepts, technologies, decisions)
 * and their relationships. Supports BFS traversal for related-entity search
 * and contradiction detection via the `contradicts` relation type.
 */
export class KnowledgeGraph {
  constructor(private readonly db: Database.Database) {}

  ensureTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        frequency INTEGER NOT NULL DEFAULT 1,
        metadata TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_entity_type ON memory_entities(type);
      CREATE INDEX IF NOT EXISTS idx_entity_name ON memory_entities(name);

      CREATE TABLE IF NOT EXISTS memory_relations (
        id TEXT PRIMARY KEY,
        from_entity_id TEXT NOT NULL,
        to_entity_id TEXT NOT NULL,
        relation TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1.0,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        metadata TEXT NOT NULL DEFAULT '{}',
        UNIQUE(from_entity_id, to_entity_id, relation)
      );
      CREATE INDEX IF NOT EXISTS idx_relation_from ON memory_relations(from_entity_id);
      CREATE INDEX IF NOT EXISTS idx_relation_to ON memory_relations(to_entity_id);
    `);
  }

  /** Upsert an entity by (name, type). Returns the entity record. */
  addEntity(name: string, type: string, metadata: Record<string, unknown> = {}): Entity {
    const existing = this.findEntityByName(name, type);
    if (existing) {
      this.db
        .prepare(
          'UPDATE memory_entities SET frequency = frequency + 1, last_seen = datetime("now"), metadata = ? WHERE id = ?',
        )
        .run(JSON.stringify({ ...existing.metadata, ...metadata }), existing.id);
      return { ...existing, frequency: existing.frequency + 1 };
    }

    const id = `ent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.db
      .prepare('INSERT INTO memory_entities (id, name, type, metadata) VALUES (?, ?, ?, ?)')
      .run(id, name, type, JSON.stringify(metadata));
    return { id, name, type, frequency: 1, metadata };
  }

  /** Create or update a relation between two entities. */
  linkEntities(
    fromId: string,
    toId: string,
    relation: string,
    strength = 1.0,
    metadata: Record<string, unknown> = {},
  ): void {
    const existing = this.db
      .prepare(
        'SELECT id, metadata FROM memory_relations WHERE from_entity_id = ? AND to_entity_id = ? AND relation = ?',
      )
      .get(fromId, toId, relation) as { id: string; metadata: string } | undefined;

    if (existing) {
      const merged = { ...JSON.parse(existing.metadata), ...metadata };
      this.db
        .prepare(
          'UPDATE memory_relations SET strength = MAX(strength, ?), last_seen = datetime("now"), metadata = ? WHERE id = ?',
        )
        .run(strength, JSON.stringify(merged), existing.id);
    } else {
      const id = `rel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      this.db
        .prepare(
          'INSERT INTO memory_relations (id, from_entity_id, to_entity_id, relation, strength, metadata) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(id, fromId, toId, relation, strength, JSON.stringify(metadata));
    }
  }

  /** Find an entity by exact name + type match. */
  findEntityByName(name: string, type?: string): Entity | null {
    const sql = type
      ? 'SELECT * FROM memory_entities WHERE name = ? AND type = ?'
      : 'SELECT * FROM memory_entities WHERE name = ?';
    const params = type ? [name, type] : [name];
    const row = this.db.prepare(sql).get(...params) as Record<string, unknown> | undefined;
    return row ? this.rowToEntity(row) : null;
  }

  /** Find entities by fuzzy name search. */
  searchEntities(nameQuery: string, limit = 10): Entity[] {
    const escaped = nameQuery.replace(/[%_\\]/g, '\\$&');
    const rows = this.db
      .prepare('SELECT * FROM memory_entities WHERE name LIKE ? LIMIT ?')
      .all(`%${escaped}%`, limit) as Record<string, unknown>[];
    return rows.map((r) => this.rowToEntity(r));
  }

  /**
   * BFS traversal starting from an entity name.
   * Returns entities reachable within `depth` hops.
   */
  findRelated(entityName: string, depth = 2): Entity[] {
    const start = this.findEntityByName(entityName);
    if (!start) return [];

    const visited = new Set<string>([start.id]);
    const result = new Map<string, Entity>();
    let frontier = [start.id];

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const nextFrontier: string[] = [];
      for (const id of frontier) {
        const rows = this.db
          .prepare(
            "SELECT e.* FROM memory_entities e INNER JOIN memory_relations r ON e.id = r.to_entity_id WHERE r.from_entity_id = ? AND r.relation != 'contradicts'",
          )
          .all(id) as Record<string, unknown>[];
        for (const row of rows) {
          const ent = this.rowToEntity(row);
          if (!visited.has(ent.id)) {
            visited.add(ent.id);
            result.set(ent.id, ent);
            nextFrontier.push(ent.id);
          }
        }
      }
      frontier = nextFrontier;
    }

    return [...result.values()];
  }

  /** Find all `contradicts` relations involving a given entity name. */
  findContradictions(entityName: string): Relation[] {
    const ent = this.findEntityByName(entityName);
    if (!ent) return [];

    const rows = this.db
      .prepare(
        "SELECT * FROM memory_relations WHERE (from_entity_id = ? OR to_entity_id = ?) AND relation = 'contradicts'",
      )
      .all(ent.id, ent.id) as Record<string, unknown>[];
    return rows.map((r) => this.rowToRelation(r));
  }

  /** Mark a relation as `contradicts` between two entities identified by name. */
  addContradiction(nameA: string, nameB: string, strength = 1.0): void {
    const a = this.addEntity(nameA, 'concept');
    const b = this.addEntity(nameB, 'concept');
    this.linkEntities(a.id, b.id, 'contradicts', strength);
  }

  /** Delete an entity and all its relations. */
  deleteEntity(id: string): void {
    this.db
      .prepare('DELETE FROM memory_relations WHERE from_entity_id = ? OR to_entity_id = ?')
      .run(id, id);
    this.db.prepare('DELETE FROM memory_entities WHERE id = ?').run(id);
  }

  /** Result of a contradiction detection check. */
  detectContradictions(
    newMemoryContent: string,
    options?: {
      llmJudge?: (
        oldStatement: string,
        newStatement: string,
      ) => Promise<{ isContradiction: boolean; confidence: number; resolutionSuggestion: string }>;
    },
  ): Array<{
    oldMemoryId: string;
    oldContent: string;
    confidence: number;
    resolutionSuggestion: string;
  }> {
    // 1. Extract candidate entity names from the new memory via simple heuristic
    const candidateNames = this.extractCandidateEntities(newMemoryContent);
    if (candidateNames.length === 0) return [];

    const contradictions: Array<{
      oldMemoryId: string;
      oldContent: string;
      confidence: number;
      resolutionSuggestion: string;
    }> = [];

    // 2. For each candidate, look for existing contradicts relations
    for (const name of candidateNames) {
      const ent = this.findEntityByName(name);
      if (!ent) continue;

      // Direct contradicts relations
      const direct = this.findContradictions(name);
      for (const rel of direct) {
        const otherId = rel.fromId === ent.id ? rel.toId : rel.fromId;
        const other = this.db.prepare('SELECT * FROM memory_entities WHERE id = ?').get(otherId) as
          | Record<string, unknown>
          | undefined;
        if (!other) continue;
        // Heuristic: if the new memory contains the other entity name, flag
        if (newMemoryContent.toLowerCase().includes((other.name as string).toLowerCase())) {
          contradictions.push({
            oldMemoryId: otherId,
            oldContent: String(other.name ?? ''),
            confidence: rel.strength,
            resolutionSuggestion:
              'The new memory directly references an entity known to contradict this concept.',
          });
        }
      }

      // 3. Also check related entities (depth=1) for indirect conflicts
      const related = this.findRelated(name, 1);
      for (const r of related) {
        const relRows = this.db
          .prepare(
            "SELECT * FROM memory_relations WHERE (from_entity_id = ? OR to_entity_id = ?) AND relation = 'contradicts'",
          )
          .all(r.id, r.id) as Record<string, unknown>[];
        for (const relRow of relRows) {
          const rel = this.rowToRelation(relRow);
          const conflictPartyId = rel.fromId === r.id ? rel.toId : rel.fromId;
          // Avoid duplicates
          if (contradictions.some((c) => c.oldMemoryId === conflictPartyId)) continue;
          contradictions.push({
            oldMemoryId: conflictPartyId,
            oldContent: r.name,
            confidence: rel.strength * 0.7,
            resolutionSuggestion: 'Indirect contradiction via related entity.',
          });
        }
      }
    }

    return contradictions.sort((a, b) => b.confidence - a.confidence);
  }

  /** Mark an old memory as superseded or merged with a new one. */
  resolveContradiction(
    oldMemoryId: string,
    newMemoryId: string,
    resolution: 'superseded' | 'merged',
  ): void {
    // Store resolution metadata in a special relation
    const oldEnt = this.addEntity(oldMemoryId, 'memory');
    const newEnt = this.addEntity(newMemoryId, 'memory');
    this.linkEntities(oldEnt.id, newEnt.id, resolution, 1.0, {
      resolvedAt: new Date().toISOString(),
    });
  }

  /** Simple heuristic entity extraction: nouns and proper names. */
  private extractCandidateEntities(text: string): string[] {
    const seen = new Set<string>();
    const results: string[] = [];
    // Match capitalized phrases and quoted terms as likely entities
    const capitalized = text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b/g) ?? [];
    const quoted = text.match(/"([^"]{2,50})"/g) ?? [];
    for (const raw of [...capitalized, ...quoted]) {
      const name = raw.replace(/^"|"$/g, '').trim();
      if (name.length > 2 && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        results.push(name);
      }
    }
    return results;
  }

  private rowToEntity(row: Record<string, unknown>): Entity {
    return {
      id: row.id as string,
      name: row.name as string,
      type: row.type as string,
      frequency: (row.frequency as number) ?? 1,
      metadata: JSON.parse((row.metadata as string) ?? '{}'),
    };
  }

  private rowToRelation(row: Record<string, unknown>): Relation {
    return {
      id: row.id as string,
      fromId: row.from_entity_id as string,
      toId: row.to_entity_id as string,
      relation: row.relation as string,
      strength: (row.strength as number) ?? 1.0,
      metadata: JSON.parse((row.metadata as string) ?? '{}'),
    };
  }
}
