import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { HierarchicalNSW as HierarchicalNSWType } from 'hnswlib-node';
import hnswlib from 'hnswlib-node';
const HierarchicalNSW = (hnswlib as any).HierarchicalNSW as typeof HierarchicalNSWType;
import { LongTermMemoryRepository, type Database } from '@cabinet/storage';
import type { KnowledgeGraph } from './knowledge-graph.js';

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
const SIMILARITY_THRESHOLD = 0.3;
const INDEX_PATH = join(process.env.CABINET_DIR ?? require('node:os').homedir(), '.cabinet', 'memory.hnsw.index');
const META_PATH = join(process.env.CABINET_DIR ?? require('node:os').homedir(), '.cabinet', 'memory.hnsw.meta.json');
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
    const indexDir = require('node:path').dirname(this.indexPath);
    if (!existsSync(indexDir)) {
      mkdirSync(indexDir, { recursive: true });
    }

    try {
      if (existsSync(this.indexPath) && existsSync(this.metaPath)) {
        this.hnsw = new HierarchicalNSW('cosine', this.dimension);
        this.hnsw.readIndex(this.indexPath);
        const meta: IndexMeta = JSON.parse(readFileSync(this.metaPath, 'utf-8'));
        this.nextLabel = meta.nextLabel;
        this.labelToId = new Map(
          Object.entries(meta.labelToId).map(([k, v]) => [Number(k), v]),
        );
        this.idToLabel = new Map(
          Object.entries(meta.labelToId).map(([k, v]) => [v, Number(k)]),
        );
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
            this.repo.insert({ id: oldRow.id, content: oldRow.content, embedding: oldRow.embedding, metadata: JSON.stringify(meta) });
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

    return id;
  }

  /**
   * Hybrid search: semantic (if embedding provided) + text.
   */
  async search(query: string, limit = 5, queryEmbedding?: number[]): Promise<LongTermEntry[]> {
    const semanticIds = new Set<string>();
    const results: LongTermEntry[] = [];

    if (queryEmbedding) {
      const semantic = await this.semanticSearch(queryEmbedding, limit);
      for (const r of semantic) {
        semanticIds.add(r.id);
        results.push({
          id: r.id,
          content: r.content,
          embedding: r.embedding,
          metadata: r.metadata,
          timestamp: r.timestamp,
        });
      }
    }

    const textLimit = limit - results.length;
    if (textLimit > 0) {
      const rows = this.repo.searchByText(query, limit + 5);
      for (const r of rows) {
        if (results.length >= limit) break;
        if (!semanticIds.has(r.id)) {
          const metadata = JSON.parse(r.metadata ?? '{}') as Record<string, unknown>;
          const status = metadata.status as string | undefined;
          if (status === 'expired' || status === 'archived') continue;
          results.push({
            id: r.id,
            content: r.content,
            embedding: r.embedding ? JSON.parse(r.embedding) : undefined,
            metadata,
            timestamp: new Date(r.timestamp),
          });
        }
      }
    }

    return results;
  }

  /**
   * Semantic vector similarity search using HNSW index.
   */
  async semanticSearch(queryEmbedding: number[], limit = 5): Promise<SimilarityResult[]> {
    if (!this.hnsw) return [];

    const k = Math.min(limit * 2, this.hnsw.getCurrentCount() || 1);
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
    if (!this.hnsw) return;
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
