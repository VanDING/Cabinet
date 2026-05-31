# Workflows API

Workflows are directed graphs of executable nodes. The Workflow Engine performs topological execution with capability-gated tool injection.

## Endpoints

### `GET /api/workflows`

List workflow definitions.

**Query params**:

- `projectId` — Filter by project
- `status` — `draft`, `active`, `paused`, `completed`, `failed`
- `limit` / `offset` — Pagination

**Response**:

```json
{
  "workflows": [
    {
      "id": "wf_1716200000000",
      "name": "Daily Report Generation",
      "status": "active",
      "stepCount": 5,
      "cronExpression": "0 9 * * *",
      "createdAt": "2026-05-15T08:00:00Z"
    }
  ],
  "total": 12
}
```

### `GET /api/workflows/:id`

Retrieve a workflow definition.

**Response**:

```json
{
  "id": "wf_1716200000000",
  "name": "Daily Report Generation",
  "definition": {
    "nodes": [
      { "id": "start", "type": "start" },
      { "id": "fetch_data", "type": "skill", "skillId": "fetch_metrics" },
      { "id": "generate", "type": "llm", "prompt": "Summarize the metrics..." },
      { "id": "approval", "type": "approval", "approvalTitle": "Publish report?" },
      { "id": "end", "type": "end" }
    ],
    "edges": [
      { "from": "start", "to": "fetch_data" },
      { "from": "fetch_data", "to": "generate" },
      { "from": "generate", "to": "approval" },
      { "from": "approval", "to": "end" }
    ],
    "capabilities": {
      "files": { "read": true, "write": true },
      "web": { "fetch": true }
    }
  },
  "status": "active"
}
```

### `POST /api/workflows`

Create a new workflow.

**Request**:

```json
{
  "projectId": "proj-1",
  "name": "Daily Report Generation",
  "definition": {
    "nodes": [...],
    "edges": [...],
    "capabilities": { "files": { "read": true, "write": true } }
  },
  "cronExpression": "0 9 * * *"
}
```

| Field | Type | Required | Description |
| :---- | :--- | :------- | :---------- |
| `projectId` | string | Yes | Owning project |
| `name` | string | Yes | Workflow name |
| `definition` | object | Yes | Node and edge graph |
| `cronExpression` | string | No | Schedule for recurring execution |

**Response** (201 Created):

```json
{
  "id": "wf_1716200000000",
  "cronExpression": "0 9 * * *",
  "status": "draft"
}
```

### `PUT /api/workflows/:id`

Update a workflow's name or definition.

**Request**:

```json
{
  "name": "Updated Report Workflow",
  "definition": { ... }
}
```

### `DELETE /api/workflows/:id`

Delete a workflow definition.

**Response**:

```json
{ "status": "deleted" }
```

### `POST /api/workflows/:id/run`

Start a workflow run.

**Request**:

```json
{
  "input": { "date": "2026-05-20" },
  "captainId": "captain-1"
}
```

**Response**:

```json
{
  "runId": "run_1716200000000",
  "workflowId": "wf_1716200000000",
  "status": "running",
  "startedAt": "2026-05-20T09:00:00Z"
}
```

### `GET /api/workflows/:id/runs`

List execution history for a workflow.

**Response**:

```json
{
  "runs": [
    {
      "runId": "run_1716200000000",
      "status": "completed",
      "startedAt": "2026-05-20T09:00:00Z",
      "completedAt": "2026-05-20T09:02:15Z",
      "steps": [
        { "nodeId": "fetch_data", "type": "skill", "output": "...", "status": "success" },
        { "nodeId": "generate", "type": "llm", "output": "...", "status": "success" }
      ]
    }
  ]
}
```

### `GET /api/workflows/:id/runs/:runId`

Get a single run's status and step outputs.

## Node Types

Workflow definitions support 19 node types:

| Category | Types | Purpose |
| :------- | :---- | :------ |
| **Flow control** | `start`, `end`, `ifElse`, `loop`, `parallel`, `merge`, `pass` | Control execution flow |
| **Execution** | `llm`, `skill`, `tool`, `code`, `workflow` | Perform work |
| **AI** | `intentClassify`, `knowledgeBase` | LLM-powered classification and retrieval |
| **Human** | `approval`, `human` | Pause for human input |
| **Container** | `agentGroup` | Group nodes under a single agent context |

## Capability Gates

Workflow agents only receive the capabilities declared in `definition.capabilities`:

| Capability | Grants |
| :--------- | :----- |
| `files.read` / `files.write` | File system access |
| `web.fetch` / `web.http` | HTTP requests |
| `shell` | Subprocess execution |
| `scheduler` | Task scheduling |
| `knowledge.search` / `knowledge.index` | Memory search and indexing |
| `evaluation` | Harness evaluation |

If a node attempts to use an undeclared capability, the tool executor returns a gated error.

## Scheduling

Workflows can declare a `cronExpression` for recurring execution. The server-side `TaskScheduler` manages these schedules and triggers runs automatically.

## Factory UI

The desktop app's **Factory** page provides a visual canvas for editing workflows:

- Drag-and-drop node placement
- Edge connection via click-and-drag
- Blueprint validation (`validateBlueprint`)
- Live execution monitor with step-by-step output
