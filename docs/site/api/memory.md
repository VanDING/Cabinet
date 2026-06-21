# Memory API

Browse, search, and manage the 4-layer memory system.

## Endpoints

### `GET /api/memory`

Query memory entries across layers.

**Query params**:

| Param   | Type   | Default | Description                                                             |
| :------ | :----- | :------ | :---------------------------------------------------------------------- |
| `layer` | string | `all`   | `short_term`, `long_term`, `entity`, `project`, or `all`                |
| `query` | string | —       | Search text (substring match for SQLite layers, semantic for long_term) |
| `limit` | number | 20      | Max results                                                             |

**Response**:

```json
{
  "entries": [
    {
      "id": "lt_abc123",
      "layer": "long_term",
      "content": "Customer Segment A prefers mobile checkout...",
      "metadata": { "projectId": "proj-1", "topic": "user-research" },
      "timestamp": "2026-05-15T10:00:00Z"
    },
    {
      "id": "ent_captain-1",
      "layer": "entity",
      "content": "{\"prefers_bullet_points\":true,...}",
      "metadata": { "captainId": "captain-1" },
      "timestamp": "2026-05-20T08:00:00Z"
    }
  ],
  "total": 156,
  "layers": {
    "short_term": 23,
    "long_term": 98,
    "entity": 8,
    "project": 27
  }
}
```

### `DELETE /api/memory/:id`

Delete a memory entry.

ID prefixes determine the layer:

| Prefix  | Layer                | Example           |
| :------ | :------------------- | :---------------- |
| `st_`   | Short-term           | `st_sess_123_key` |
| `lt_`   | Long-term            | `lt_abc123`       |
| `ent_`  | Entity (preferences) | `ent_captain-1`   |
| `emp_`  | Entity (employee)    | `emp_advisor_1`   |
| `proj_` | Project              | `proj_proj-1`     |

**Response**:

```json
{ "status": "deleted" }
```

### `POST /api/memory/consolidate`

Trigger manual memory consolidation. Normally runs automatically every 30 minutes.

**Response**:

```json
{
  "status": "completed",
  "migrated": 12
}
```

### `GET /api/memory/graph`

Retrieve the Knowledge Graph entities and relations.

**Response**:

```json
{
  "entities": [
    { "id": 1, "name": "Customer Segment A", "type": "segment", "frequency": 12 },
    { "id": 2, "name": "Q3 Revenue", "type": "metric", "frequency": 8 }
  ],
  "relations": [
    {
      "source": "Customer Segment A",
      "target": "Q3 Revenue",
      "type": "related_to",
      "strength": 0.85
    }
  ]
}
```

### `GET /api/memory/stats`

Memory statistics across layers.

**Response**:

```json
{
  "shortTerm": { "count": 23, "sizeEstimate": "12KB" },
  "longTerm": { "count": 156, "sizeEstimate": "1.2MB" },
  "entity": { "count": 8, "sizeEstimate": "45KB" },
  "project": { "count": 42, "sizeEstimate": "320KB" }
}
```

## Memory Layers

See [Memory Layers](../concepts/memory-layers) for a full conceptual overview.

| Layer          | Storage                      | Query Method        | TTL              |
| :------------- | :--------------------------- | :------------------ | :--------------- |
| **Short-term** | In-memory + SQLite           | Substring search    | Session          |
| **Long-term**  | SQLite + HNSW (hnswlib-node) | Semantic similarity | Permanent        |
| **Entity**     | SQLite                       | Key lookup          | Permanent        |
| **Project**    | SQLite                       | Scoped query        | Project lifetime |

## Project Isolation

All memory queries are scoped to the active project by default. Cross-project queries require explicit `projectId` parameters. The `ProjectIsolatedMemory` wrapper enforces this boundary at the repository level.

## Consolidation

The background consolidation process:

1. Scans short-term entries older than the session threshold
2. Removes near-duplicates (cosine similarity > 0.95)
3. Summarizes long threads into key points
4. Stores results in long-term memory with embeddings
5. Extracts entities and relations for the Knowledge Graph

Manual consolidation is useful after importing large documents or finishing a major project phase.

## Contradiction Detection

When new memory conflicts with existing knowledge, the system emits a `memory_contradiction` WebSocket event. The Captain can review and resolve contradictions in the **Memory** page.
