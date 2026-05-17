# Memory API

Browse, search, and manage the 4-layer memory system.

## Endpoints

### `GET /api/memory`

List memory entries across layers.

**Query params**:
- `layer` — `short_term`, `long_term`, `entity`, `project`, or `all` (default)
- `query` — search text
- `limit` — max results (default: 50)

**Response**:
```json
{
  "entries": [
    {
      "id": "mem_...",
      "layer": "long_term",
      "content": "...",
      "metadata": { "projectId": "proj-1" },
      "timestamp": "2026-05-15T10:00:00Z"
    }
  ],
  "total": 42
}
```

### `POST /api/memory/consolidate`

Trigger manual memory consolidation (normally runs automatically every 30 minutes).

**Response**:
```json
{
  "status": "consolidated",
  "migrated": 5,
  "pruned": 2
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

## Project Isolation

Memory is strictly isolated per project. All queries default to the currently active project context. Cross-project memory access requires explicit `projectId` parameter.
