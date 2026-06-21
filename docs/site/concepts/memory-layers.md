# Memory Layers

Cabinet's memory system is designed around a simple insight: **not all information is equally urgent or equally durable**. The 4-layer architecture separates hot context from cold knowledge, ensuring fast retrieval for active work and deep retrieval for historical insight.

## The Four Layers

### 1. Short-Term Memory

**Purpose**: "What are we talking about right now?"

- Stores the current session's key-value entries with TTL (default 30 min)
- In-memory LRU cache (default 1000 entries) with optional SQLite persistence
- Methods: `set(sessionId, key, value)`, `get(sessionId, key)`, `getAll(sessionId)`, `delete`, `clear`
- On TTL expiry: deletes from cache and DB, notifies `onExpire` listeners
- Cache hit moves entry to MRU position in access order

### 2. Long-Term Memory

**Purpose**: "What have we learned before?"

- Semantic vector storage powered by **HNSW** (hnswlib-node native addon)
- SQLite-backed: `memory_embeddings` table + FTS5 virtual table for BM25 full-text search
- **Hybrid search** via RRF (Reciprocal Rank Fusion, k=60): merges semantic (HNSW) + keyword (BM25/FTS5)
- Brute-force fallback when HNSW native addon is unavailable (paged cosine similarity, capped at 50k rows)
- Project-isolated by default (queries scoped to active project via metadata filter)
- Persists indefinitely, with adaptive pruning at 500,000 entries (removes expired/archived/lowest-score first)
- Contradiction detection on store: knowledge graph check + optional LLM judge (24h cooldown cache)
- Automatic embedding generation with tier boosts: `working` tier gets 1.15x, `register` gets 1.05x cosine similarity boost

### 3. Entity Memory

**Purpose**: "Who is the Captain? How are employees configured?"

- Stores Captain preferences, employee configs, and agent role definitions
- Low-frequency reads, occasional writes
- In-memory cache with SQLite persistence

**Key operations**:

- `getPreferences(captainId)` — Captain's default choices
- `setPreferences(captainId, prefs)` — update preferences
- `getEmployee(employeeId)`, `setEmployee(employeeId, config)` — employee configuration

### 4. Project Memory

**Purpose**: "What is this project about?"

- Stores project goals, milestones, key decisions, and summary
- Medium-frequency access, persistent across sessions
- SQLite-backed via `ProjectContextRepository`

**Key operations**:

- `getContext(projectId)` — full project snapshot
- `addMilestone(projectId, milestone)` — record progress
- `addDecision(projectId, decision)` — record a decision
- `updateSummary(projectId, summary)` — refresh project overview

## Memory Facade

The `MemoryFacade` (`packages/memory/src/memory-facade.ts`) provides a unified interface for agent code. Agents do not talk to individual layers directly; they call:

```ts
// Short-term
facade.remember(sessionId, key, value);
facade.recall(sessionId, key);
facade.getSessionContext(sessionId); // merges messages + KV entries

// Long-term
facade.search(query, options); // hybrid semantic+BM25 search
facade.storeMemory(entry); // WriteGate → LTM
facade.updateMemory(id, metadata);
facade.deleteMemory(id);

// Project
facade.getProjectContext(projectId);
facade.addProjectDecision(projectId, decision);
facade.addProjectMilestone(projectId, milestone);

// Entity
facade.getPreferences(captainId);
facade.setPreferences(captainId, prefs);

// Consolidation
facade.consolidateSession(sessionId); // basic + optional LLM
```

## Write Gate

Not all writes go directly to long-term storage. The `WriteGate` evaluates each write request through a **dual-channel** classifier:

### Fast Path (always active, regex-based)

1. **Structured key prefixes** (`decision_`, `preference_`, `milestone_`) → `register` tier
2. **Explicit remember phrases** (8 languages) → `working` tier
3. **Behavior-changing patterns** (preferences, style) → `register` tier
4. **Commitments** (deadlines, deliverables) → `register` tier
5. **Decisions** (decision word + reasoning) → `register` tier
6. **Stable facts** (has date/number/entity, length ≥ 20) → `daily` tier
7. Short content → `transient_noise` (rejected)

### Slow Path (opt-in, embedding-based)

When enabled, computes embedding and compares against tier anchor embeddings (cosine similarity ≥ 0.75). Sampled on a subset of `transient_noise` entries for cost-benefit analysis.

### Three Memory Tiers

| Tier       | Description                               | Destination                      |
| :--------- | :---------------------------------------- | :------------------------------- |
| `daily`    | Routine facts, batched for efficiency     | CascadeBuffer → LTM              |
| `register` | Important patterns, immediate persistence | Direct → LTM                     |
| `working`  | Explicitly requested to remember          | Direct → LTM + boosted retrieval |

## Cascade Buffer

High-frequency writes (daily tier) are staged in the `CascadeBuffer` — an in-memory buffer keyed by `${sessionId}:${topic}`. The buffer is sealed and flushed to LTM:

- When it reaches `minCount` (default 5) entries for a topic
- When `maxAge` (default 30 min) is exceeded
- When `consolidateSession()` is called

Sealing produces a summary: either a simple concatenation (default) or an LLM-generated summary if a Curator summarizer is configured.

## Knowledge Graph

Long-term memories are not just vectors. The `KnowledgeGraph` extracts entities and relations from consolidated memories, creating a queryable graph structure:

```
[Entity: "Customer Segment A"] ──related_to──► [Entity: "Q3 Revenue"]
[Entity: "Tech Debt"] ──blocks──► [Entity: "Feature X Launch"]
```

This enables structured questions like "What blocks Feature X?" that pure vector search cannot answer. The graph supports:

- Entity extraction via regex + compromise.js (people, places, organizations)
- Contradiction detection via BFS traversal of `contradicts` relations
- BFS search for related entities up to configurable depth

## RAG: Document Chunking & Hybrid Retrieval (P1-4)

Cabinet provides a document indexing and hybrid search pipeline for Retrieval-Augmented Generation:

### Document Chunking (`chunking.ts`)

Splits long documents into overlapping chunks:

- **Strategy**: paragraph → sentence → hard split (3-level cascade)
- **Default**: 800 char chunks with 100 char overlap
- **CJK-aware**: handles Chinese/Japanese/Korean sentence boundaries

### BM25 Index (`BM25Index`)

Pure TypeScript implementation of the Okapi BM25 ranking function — zero external dependencies. Uses k1=1.5, b=0.75 parameters.

### Hybrid Retriever (`HybridRetriever`)

Combines keyword and semantic search via Reciprocal Rank Fusion (RRF, k=60):

```
User Query
    ├─ BM25 keyword match → top 20
    └─ Embedding cosine similarity → top 10
    → RRF merge → top K results
```

- Indexing batches of 16 chunks for embedding generation
- Integrates with `MemoryFacade.search()` for fused results

## Consolidation

Memory consolidation runs via `MemoryFacade.consolidateSession()`:

1. **`consolidateBasic()`** — evaluates short-term entries through WriteGate, migrates register/working to LTM, stages daily in CascadeBuffer, auto-seals eligible buffers (zero LLM cost)
2. **`consolidateWithLLM()`** — flushes cascade buffers, invokes optional Curator summarizer, stores extracted memories and summary
3. **`flushSession()`** — force-seals all pending cascade buffers

## Memory Decay

Not all long-term memories deserve to live forever. The `MemoryDecayService` uses an **Ebbinghaus-inspired adaptive half-life**:

- Range: 7–90 days
- With access history: `halfLife = 900 / avgIntervalDays` (clamped)
- Without history: `30 + accessCount * 5` (clamped)
- Default: 30 days

Decay cycle marks entries as `expired` (past validUntil), `archived` (low confidence + old, or low importance + very old). Scoring formula: `importance × confidence × recencyDecay × accessBoost`.

## Project Isolation

The `ProjectIsolatedMemory` wrapper ensures that memory queries from one project cannot leak into another. Short-term keys are prefixed with `projectId:sessionId`. Long-term searches filter by `metadata.projectId`.

## Cross-Project Migration

Memories carry a `scope` metadata field (`project`, `workspace`, `global`). The `CrossProjectMigrator` supports:

- `markAsGlobal(ids)` / `markAsWorkspace(ids)` — change scope
- `migrateToProject(ids, targetProjectId)` — copy to another project
- `findGlobalMemories(query)` — search workspace-global memories
- `findCrossProjectPatterns(minSimilarity)` — Jaccard word overlap analysis across projects

## API Endpoints

See the [Memory API](../api/memory) for HTTP access to read/write, search, graph, consolidation, and cross-project migration operations.
