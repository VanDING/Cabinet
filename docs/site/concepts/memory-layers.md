# Memory Layers

Cabinet's memory system is designed around a simple insight: **not all information is equally urgent or equally durable**. The 4-layer architecture separates hot context from cold knowledge, ensuring fast retrieval for active work and deep retrieval for historical insight.

## The Four Layers

### 1. Short-Term Memory

**Purpose**: "What are we talking about right now?"

- Stores the current session's message history
- High-frequency read/write
- Cleared when the session ends
- Backed by SQLite for crash recovery, but primarily in-memory for speed

**Key operations**:

- `append(sessionId, message)` — add a message
- `getRecent(sessionId, count)` — retrieve last N messages
- `clear(sessionId)` — discard session context

### 2. Long-Term Memory

**Purpose**: "What have we learned before?"

- Semantic vector storage powered by **HNSW** (hnswlib-node)
- Cross-session retrieval via embedding similarity
- Project-isolated by default (queries scoped to active project)
- Persists indefinitely

**Key operations**:

- `store(entry)` — embed and save
- `search(query, k)` — semantic similarity search
- `delete(projectId)` — purge project-scoped memories

### 3. Entity Memory

**Purpose**: "Who is the Captain? How are employees configured?"

- Stores Captain preferences, employee configs, and agent role definitions
- Low-frequency reads, occasional writes
- Loaded once per session and cached

**Key operations**:

- `getPreferences(captainId)` — Captain's default choices
- `getEmployeeConfig(employeeId)` — model, prompt, tools
- `setPreference(key, value)` — update a preference

### 4. Project Memory

**Purpose**: "What is this project about?"

- Stores project goals, milestones, key decisions, risk maps, and tech summaries
- Medium-frequency access, persistent across sessions
- Combines structured SQLite data and vector summaries

**Key operations**:

- `getContext(projectId)` — full project snapshot
- `addMilestone(projectId, milestone)` — record progress
- `updateSummary(projectId, summary)` — refresh project overview

## Memory Orchestration

The `MemoryFacade` (`packages/memory/src/memory-facade.ts`) provides a unified interface for agent code. Agents do not talk to individual layers directly; they call:

```ts
orchestrator.query({ layer: 'long_term', projectId: 'p1', query: 'past marketing decisions' });
orchestrator.write({ layer: 'entity', key: 'captain.prefers_bullet_points', value: true });
```

## Write Gate

Not all writes go directly to storage. The `WriteGate` evaluates each write request:

- **Tier**: Which layer is targeted?
- **Urgency**: Does this need immediate persistence?
- **Conflict**: Does it contradict existing memory?

Conflicting writes are flagged for review rather than silently overwriting.

## Cascade Buffer

High-frequency writes (e.g., every chat message) are batched in the `CascadeBuffer` before hitting SQLite. This reduces disk I/O and allows coalescing of rapid updates. The buffer is sealed and flushed:

- When it reaches a size threshold
- When a `SEAL` command is issued
- On a timer (every 30 seconds)

## Knowledge Graph

Long-term memories are not just vectors. The `KnowledgeGraph` extracts entities and relations from consolidated memories, creating a queryable graph structure:

```
[Entity: "Customer Segment A"] ──related_to──► [Entity: "Q3 Revenue"]
[Entity: "Tech Debt"] ──blocks──► [Entity: "Feature X Launch"]
```

This enables structured questions like "What blocks Feature X?" that pure vector search cannot answer.

## RAG: Document Chunking & Hybrid Retrieval (P1-4)

Cabinet provides a document indexing and hybrid search pipeline for Retrieval-Augmented Generation:

### Document Chunking (`chunking.ts`)

Splits long documents into overlapping chunks with configurable size and overlap:

- **Strategy**: paragraph → sentence → hard split (3-level cascade)
- **Default**: 800 char chunks with 100 char overlap
- **Metadata preserved**: source document ID, chunk index, custom metadata fields
- **Batch API**: `chunkDocuments()` processes multiple documents at once

### BM25 Index (`BM25Index`)

Pure TypeScript implementation of the Okapi BM25 ranking function — zero external dependencies:

- Tokenizes with Unicode-aware word segmentation
- IDF-weighted term scoring with configurable k1 (1.5) and b (0.75) parameters
- Returns scored and sorted results by document ID

### Hybrid Retriever (`HybridRetriever`)

Combines keyword and semantic search via Reciprocal Rank Fusion (RRF, k=60):

```
User Query
    ├─ BM25 keyword match → top 20
    └─ Embedding cosine similarity → top 10
    → RRF merge → top K results
```

- **Indexing**: batches of 16 chunks for embedding generation
- **Interface**: depends on `SimpleEmbedder` — decoupled from any specific embedding provider
- **Integration**: use `MemoryFacade.searchLongTerm()` for vector-only search, or `HybridRetriever.search()` for fused results

## Consolidation

Memory consolidation runs on two tracks:

- **`consolidateBasic()`** (every 30 min): processes daily-tier entries via CascadeBuffer (zero LLM cost)
- **Curator LLM consolidation** (on session close / every 4h): processes register/working-tier entries

## Memory Decay

Not all long-term memories deserve to live forever. The `MemoryDecayService` gradually reduces the relevance score of old memories. If a memory is never retrieved, it fades and is eventually archived. Frequently accessed memories are refreshed and promoted.

## Project Isolation

The `ProjectIsolatedMemory` wrapper ensures that memory queries from one project cannot leak into another. This is critical for multi-project workspaces where sensitive client data must remain bounded.

## API Endpoints

See the [Memory API](../api/memory) for HTTP access to read/write and search operations.
