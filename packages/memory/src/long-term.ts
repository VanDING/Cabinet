import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { HierarchicalNSW as HierarchicalNSWType } from 'hnswlib-node';
import { LongTermMemoryRepository, type Database, type LongTermMemoryRow } from '@cabinet/storage';
import { MemoryDecayService } from './memory-decay.js';

const req = typeof require !== 'undefined' ? require : createRequire(import.meta.url);

let HierarchicalNSW: typeof HierarchicalNSWType | null = null;
try {
  const hnswlib = req('hnswlib-node');
  HierarchicalNSW = hnswlib.HierarchicalNSW as typeof HierarchicalNSWType;
} catch {
  // Native addon not available — vector search disabled
}
import type { KnowledgeGraph } from './knowledge-graph.js';
import { extractCandidateEntities } from './entity-extractor.js';

export interface LongTermEntry {
  id: string;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  timestamp: Date;
}

export interface SimilarityResult extends LongTermEntry {
  score: number;
}

interface IndexMeta {
  dimension: number;
  nextLabel: number;
  labelToId: Record<string, string>;
}

const DEFAULT_DIMENSION = 1536;
const SIMILARITY_THRESHOLD = 0.15;
const INDEX_PATH = join(process.env.CABINET_DIR ?? homedir(), '.cabinet', 'memory.hnsw.index');
const META_PATH = join(process.env.CABINET_DIR ?? homedir(), '.cabinet', 'memory.hnsw.meta.json');
const INITIAL_MAX_ELEMENTS = 100_000;

/**
 * Long-term memory backed by SQLite with HNSW vector index for semantic search.
 * Supports both text search (LIKE queries) and vector similarity search.
 *
 * HNSW label → id mapping:
 *   hnswlib-node v3 only accepts number labels. We maintain an in-memory
 *   label↔id bidirectional map and persist it alongside the index file.
 */
export class LongTermMemory {
  private repo: LongTermMemoryRepository;
  private hnsw: HierarchicalNSWType | null = null;
  private dimension: number;
  private indexPath: string;
  private metaPath: string;
  private labelToId = new Map<number, string>();
  private idToLabel = new Map<string, number>();
  private nextLabel = 0;
  private knowledgeGraph: KnowledgeGraph | null = null;
  private onContradictionDetected?: (contradiction: {
    oldMemoryId: string;
    oldContent: string;
    confidence: number;
    newMemoryId: string;
  }) => void;
  private readonly MAX_LONGTERM_ENTRIES = 500_000;

  constructor(db: Database, dimension = DEFAULT_DIMENSION, indexPath?: string) {
    this.repo = new LongTermMemoryRepository(db);
    this.repo.ensureTable();
    this.dimension = dimension;
    this.indexPath = indexPath ?? INDEX_PATH;
    this.metaPath = (indexPath ?? INDEX_PATH).replace(/\.index$/, '.meta.json');
    if (!this.metaPath.endsWith('.meta.json')) {
      this.metaPath = this.indexPath + '.meta.json';
    }
    this.initIndex();
  }

  private initIndex(): void {
    const indexDir = dirname(this.indexPath);
    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }

    if (!HierarchicalNSW) {
      return;
    }

    try {
      if (existsSync(this.indexPath) && existsSync(this.metaPath)) {
        this.hnsw = new HierarchicalNSW('cosine', this.dimension);
        this.hnsw.readIndex(this.indexPath);
        const meta: IndexMeta = JSON.parse(readFileSync(this.metaPath, 'utf-8'));
        this.nextLabel = meta.nextLabel;
        this.labelToId = new Map(Object.entries(meta.labelToId).map(([k, v]) => [Number(k), v]));
        this.idToLabel = new Map(Object.entries(meta.labelToId).map(([k, v]) => [v, Number(k)]));
        return;
      }
    } catch {
      /* index or meta corrupt — rebuild below */
    }

    this.hnsw = new HierarchicalNSW('cosine', this.dimension);
    this.hnsw.initIndex(INITIAL_MAX_ELEMENTS, 16, 200);
    this.nextLabel = 0;
    this.labelToId.clear();
    this.idToLabel.clear();
    this.rebuildIndexSync();
  }

  private rebuildIndexSync(): void {
    if (!this.hnsw) return;
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const rows = this.repo.findWithEmbeddingsPaged(pageSize, offset);
      if (rows.length === 0) break;
      for (const row of rows) {
        try {
          const vec = JSON.parse(row.embedding!) as number[];
          if (vec.length === this.dimension) {
            const label = this.nextLabel++;
            this.hnsw!.addPoint(vec, label);
            this.labelToId.set(label, row.id);
            this.idToLabel.set(row.id, label);
          }
        } catch {
          /* skip malformed embedding */
        }
      }
      offset += pageSize;
    }
  }

  async store(entry: Omit<LongTermEntry, 'id'>): Promise<string> {
    const id = `ltm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // ── Populate knowledge graph with extracted entities ──
    if (this.knowledgeGraph) {
      const candidates = extractCandidateEntities(entry.content);
      for (const name of candidates) {
        try {
          this.knowledgeGraph.addEntity(name, 'concept', { source: 'memory_store' });
        } catch {
          /* best-effort entity extraction */
        }
      }
    }

    // ── Contradiction detection (Phase 4.2) ──
    if (this.knowledgeGraph) {
      const conflicts = this.knowledgeGraph.detectContradictions(entry.content);
      for (const c of conflicts) {
        if (c.confidence > 0.8) {
          // Auto-mark old memory as superseded via metadata update
          const oldRow = this.repo.findByIds([c.oldMemoryId])[0];
          if (oldRow) {
            const meta = JSON.parse(oldRow.metadata ?? '{}') as Record<string, unknown>;
            meta.status = 'superseded';
            meta.supersededBy = id;
            meta.supersededReason = c.resolutionSuggestion;
            this.repo.updateMetadata(oldRow.id, JSON.stringify(meta));
          }
        } else if (c.confidence >= 0.5 && this.onContradictionDetected) {
          this.onContradictionDetected({
            oldMemoryId: c.oldMemoryId,
            oldContent: c.oldContent,
            confidence: c.confidence,
            newMemoryId: id,
          });
        }
      }
    }

    const embeddingJson = entry.embedding ? JSON.stringify(entry.embedding) : null;

    this.repo.insert({
      id,
      content: entry.content,
      embedding: embeddingJson,
      metadata: JSON.stringify(entry.metadata),
    });

    if (entry.embedding && this.hnsw) {
      this.ensureCapacity();
      try {
        const label = this.nextLabel++;
        this.hnsw.addPoint(entry.embedding, label);
        this.labelToId.set(label, id);
        this.idToLabel.set(id, label);
      } catch {
        /* best-effort index update */
      }
    }

    // Prune if over capacity (every 1000th insert to amortize cost)
    const count = this.repo.count();
    if (count > this.MAX_LONGTERM_ENTRIES && count % 1000 < 50) {
      this.pruneExcess();
    }

    return id;
  }

  /** Remove lowest-scoring entries when over capacity. Expired/archived entries are removed first unconditionally. */
  private pruneExcess(): void {
    try {
      // Phase 1: Remove all expired/archived entries
      const rows = this.repo.findAll();
      const expiredIds: string[] = [];
      const scored: { id: string; score: number }[] = [];

      for (const row of rows) {
        const meta = (() => { try { return JSON.parse(row.metadata ?? '{}'); } catch { return {}; } })();
        const status = meta.status as string | undefined;
        if (status === 'expired' || status === 'archived') {
          expiredIds.push(row.id);
        } else {
          const timestamp = new Date(row.timestamp);
          // Reuse MemoryDecayService.score if available, otherwise simple recency
          const ageDays = (Date.now() - timestamp.getTime()) / (1000 * 60 * 60 * 24);
          const importance = (meta.importance as number) ?? 0.5;
          const confidence = (meta.confidence as number) ?? 0.5;
          const accessCount = (meta.accessCount as number) ?? 0;
          const recencyDecay = Math.exp(-ageDays / 30);
          const accessBoost = 1 + Math.log1p(accessCount);
          scored.push({ id: row.id, score: importance * confidence * recencyDecay * accessBoost });
        }
      }

      // Delete expired/archived unconditionally
      for (const id of expiredIds) {
        this.delete(id);
      }

      // Prune lowest-scoring entries if still over limit
      const remaining = scored.length;
      const target = Math.floor(this.MAX_LONGTERM_ENTRIES * 0.9);
      if (remaining > target) {
        scored.sort((a, b) => a.score - b.score);
        const toDelete = scored.slice(0, remaining - target);
        for (const { id } of toDelete) {
          this.delete(id);
        }
      }
    } catch {
      /* best-effort pruning */
    }
  }

  /**
   * Hybrid search: RRF fusion of semantic + BM25 text search.
   * Results are ranked by RRF score and decay-weighted relevance.
   */
  async search(query: string, limit = 20, queryEmbedding?: number[]): Promise<LongTermEntry[]> {
    const semanticResults: Array<{ entry: LongTermEntry; rank: number; score: number }> = [];
    const textResults: Array<{ entry: LongTermEntry; rank: number }> = [];
    const fetchCount = Math.max(limit * 3, 50);

    if (queryEmbedding) {
      const semantic = await this.semanticSearch(queryEmbedding, fetchCount);
      for (let i = 0; i < semantic.length; i++) {
        const r = semantic[i]!;
        const status = r.metadata.status as string | undefined;
        if (status === 'expired' || status === 'archived') continue;
        semanticResults.push({
          entry: {
            id: r.id,
            content: r.content,
            embedding: r.embedding,
            metadata: r.metadata,
            timestamp: r.timestamp,
          },
          rank: i + 1,
          score: r.score,
        });
      }
    }

    // BM25 text search via FTS5
    const textRows = this.repo.searchByBM25(query, fetchCount);
    for (let i = 0; i < textRows.length; i++) {
      const r = textRows[i]!;
      const metadata = JSON.parse(r.metadata ?? '{}') as Record<string, unknown>;
      const status = metadata.status as string | undefined;
      if (status === 'expired' || status === 'archived') continue;
      textResults.push({
        entry: {
          id: r.id,
          content: r.content,
          embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
          metadata,
          timestamp: new Date(r.timestamp),
        },
        rank: i + 1,
      });
    }

    // RRF fusion (k=60)
    const k = 60;
    const rrfScores = new Map<string, { entry: LongTermEntry; score: number }>();

    for (const s of semanticResults) {
      const decayScore = this.computeDecayScore(s.entry);
      const rrf = (1 / (k + s.rank)) * decayScore;
      rrfScores.set(s.entry.id, { entry: s.entry, score: rrf });
    }

    for (const t of textResults) {
      const decayScore = this.computeDecayScore(t.entry);
      const rrf = (1 / (k + t.rank)) * decayScore;
      const existing = rrfScores.get(t.entry.id);
      if (existing) {
        existing.score += rrf;
      } else {
        rrfScores.set(t.entry.id, { entry: t.entry, score: rrf });
      }
    }

    const fused = [...rrfScores.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((v) => v.entry);

    // Async accessCount update (best-effort)
    for (const entry of fused) {
      this.incrementAccessCount(entry.id).catch((err) => { console.warn('Operation failed', err); });
    }

    return fused;
  }

  private computeDecayScore(entry: LongTermEntry): number {
    try {
      return MemoryDecayService.score(entry);
    } catch {
      return 1;
    }
  }

  private async incrementAccessCount(id: string): Promise<void> {
    try {
      const rows = this.repo.findByIds([id]);
      if (rows.length === 0) return;
      const meta = JSON.parse(rows[0]!.metadata ?? '{}') as Record<string, unknown>;
      meta.accessCount = ((meta.accessCount as number) ?? 0) + 1;
      this.repo.updateMetadata(id, JSON.stringify(meta));
    } catch {
      // best-effort
    }
  }

  /** Update memory metadata (e.g., mark as outdated). */
  async updateMemory(
    id: string,
    updates: Partial<{ status: string; importance: number; confidence: number }>,
  ): Promise<boolean> {
    try {
      const rows = this.repo.findByIds([id]);
      if (rows.length === 0) return false;
      const meta = JSON.parse(rows[0]!.metadata ?? '{}') as Record<string, unknown>;
      if (updates.status !== undefined) meta.status = updates.status;
      if (updates.importance !== undefined) meta.importance = updates.importance;
      if (updates.confidence !== undefined) meta.confidence = updates.confidence;
      this.repo.updateMetadata(id, JSON.stringify(meta));
      return true;
    } catch {
      return false;
    }
  }

  /** Text-only search (LIKE) — bypasses BM25/FTS5. Safe for empty-string queries. */
  searchByText(query: string, limit: number): LongTermMemoryRow[] {
    return this.repo.searchByText(query, limit);
  }

  /** Synchronous metadata update (for decay service internal use). */
  _setMetadataSync(id: string, metadata: Record<string, unknown>): void {
    try {
      this.repo.updateMetadata(id, JSON.stringify(metadata));
    } catch {
      // best-effort
    }
  }

  /**
   * Semantic vector similarity search using HNSW index.
   */
  async semanticSearch(queryEmbedding: number[], limit = 20): Promise<SimilarityResult[]> {
    if (!this.hnsw) return [];

    const k = Math.min(Math.max(limit * 3, 50), this.hnsw.getCurrentCount() || 1);
    if (k === 0) return [];

    let raw: { neighbors: number[]; distances: number[] };
    try {
      raw = this.hnsw.searchKnn(queryEmbedding, k);
    } catch {
      return [];
    }

    const ids: string[] = [];
    for (const label of raw.neighbors) {
      const id = this.labelToId.get(label);
      if (id) ids.push(id);
    }

    const rows = this.repo.findByIds(ids);
    const rowMap = new Map(rows.map((r) => [r.id, r]));

    const scored: SimilarityResult[] = [];
    for (let i = 0; i < raw.neighbors.length; i++) {
      const label = raw.neighbors[i]!;
      const id = this.labelToId.get(label);
      if (!id) continue;
      const row = rowMap.get(id);
      if (!row || !row.embedding) continue;
      const metadata = JSON.parse(row.metadata ?? '{}') as Record<string, unknown>;
      const status = metadata.status as string | undefined;
      if (status === 'expired' || status === 'archived') continue;
      const vec = JSON.parse(row.embedding) as number[];
      const score = this.cosineSimilarity(queryEmbedding, vec);
      if (score > SIMILARITY_THRESHOLD) {
        scored.push({
          id,
          content: row.content,
          embedding: vec,
          metadata,
          timestamp: new Date(row.timestamp),
          score,
        });
      }
    }

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async delete(id: string): Promise<boolean> {
    const before = this.repo.count();
    this.repo.delete(id);
    if (this.hnsw) {
      const label = this.idToLabel.get(id);
      if (label !== undefined) {
        try {
          this.hnsw.markDelete(label);
        } catch {
          /* best-effort */
        }
        this.idToLabel.delete(id);
        this.labelToId.delete(label);
      }
    }
    return this.repo.count() < before;
  }

  /** Paginated list of all long-term memory entries (no embedding needed). */
  findAll(limit = 20, offset = 0): Array<{ id: string; content: string; metadata: Record<string, unknown>; timestamp: Date }> {
    const rows = this.repo.findAll();
    const sliced = rows.slice(offset, offset + limit);
    return sliced.map((r) => ({
      id: r.id,
      content: r.content,
      metadata: JSON.parse(r.metadata ?? '{}') as Record<string, unknown>,
      timestamp: new Date(r.timestamp),
    }));
  }

  size(): number {
    return this.repo.count();
  }

  /** Save HNSW index and label mapping to disk. */
  close(): void {
    if (this.hnsw) {
      try {
        (this.hnsw as any).saveIndex(this.indexPath);
      } catch {
        /* non-fatal */
      }
    }
    try {
      const meta: IndexMeta = {
        dimension: this.dimension,
        nextLabel: this.nextLabel,
        labelToId: Object.fromEntries(this.labelToId),
      };
      writeFileSync(this.metaPath, JSON.stringify(meta), 'utf-8');
    } catch {
      /* non-fatal */
    }
  }

  /** Inject KnowledgeGraph for contradiction detection on store(). */
  setKnowledgeGraph(kg: KnowledgeGraph | null): void {
    this.knowledgeGraph = kg;
  }

  /** Set a callback invoked when a high-confidence contradiction is detected. */
  setContradictionHandler(
    handler: (contradiction: {
      oldMemoryId: string;
      oldContent: string;
      confidence: number;
      newMemoryId: string;
    }) => void,
  ): void {
    this.onContradictionDetected = handler;
  }

  /** Rebuild HNSW index from SQLite (e.g., after corruption or version mismatch). */
  async rebuildIndex(): Promise<void> {
    if (!this.hnsw || !HierarchicalNSW) return;
    this.hnsw = new HierarchicalNSW('cosine', this.dimension);
    this.hnsw.initIndex(INITIAL_MAX_ELEMENTS, 16, 200);
    this.nextLabel = 0;
    this.labelToId.clear();
    this.idToLabel.clear();
    this.rebuildIndexSync();
  }

  private ensureCapacity(): void {
    if (!this.hnsw) return;
    const max = this.hnsw.getMaxElements();
    const current = this.hnsw.getCurrentCount();
    if (current >= max * 0.8) {
      this.hnsw.resizeIndex(max * 2);
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dotProduct = 0,
      normA = 0,
      normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
