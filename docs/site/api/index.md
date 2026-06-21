# API Overview

Cabinet exposes a unified REST API from the backend server (`apps/server`). All endpoints are prefixed with `/api`.

**Base URL**: `http://localhost:3000/api`

## Authentication

Cabinet uses local identity verification. There is no external OAuth or SSO.

- **Desktop app**: PIN or system biometric via Tauri API
- **Server API**: Local password/PIN verification via `/api/auth/verify`
- **API Keys**: Encrypted at rest (AES-256-GCM); decrypted to memory only at runtime

Include the session token in the `Authorization` header for protected endpoints:

```
Authorization: Bearer <token>
```

## Content Type

All request bodies must be `application/json`. Responses are JSON unless streaming (SSE for chat).

## Response Format

Success responses use HTTP 200-201 with a JSON body. Errors follow this shape:

```json
{
  "error": "Human-readable message",
  "details": {} // optional extra context
}
```

Common status codes:

| Code | Meaning                                             |
| :--- | :-------------------------------------------------- |
| 400  | Validation error (Zod schema mismatch)              |
| 401  | Authentication required                             |
| 403  | Permission denied (delegation tier or safety check) |
| 404  | Resource not found                                  |
| 429  | Rate limited (LLM provider or budget cap)           |
| 500  | Internal server error                               |

## API Modules

| Module                   | Endpoints                                            | Description                             |
| :----------------------- | :--------------------------------------------------- | :-------------------------------------- |
| [Secretary](./secretary) | `POST /secretary/chat`                               | Natural language entry point, streaming |
| [Decisions](./decisions) | `GET/POST /decisions`, `POST /decisions/:id/approve` | Decision lifecycle                      |
| [Workflows](./workflows) | `GET/POST /workflows`, `POST /workflows/:id/run`     | Workflow CRUD and execution             |
| [Meetings](./meetings)   | `GET/POST /meetings`                                 | Meeting reports and synthesis           |
| [Memory](./memory)       | `GET /memory`, `POST /memory/consolidate`            | 4-layer memory access                   |
| [Gateway](./gateway)     | `GET/POST /settings/api-keys`                        | LLM provider keys and routing           |

## Real-Time Events

State changes are broadcast via WebSocket (`ws://localhost:3000/ws`). The desktop app listens for these events to update UI without polling.

Common event types:

- `decision_created` / `decision_updated`
- `meeting_created`
- `workflow_started` / `workflow_completed`
- `task_completed` / `task_updated`
- `budget_alert`
- `quality_alert`
- `project_created` / `project_deleted`
- `skill_created` / `skill_updated` / `skill_deleted`
- `agent_created` / `agent_updated` / `agent_deleted`

## Pagination and Limits

List endpoints support `limit` (default 20, max 100) and `offset` query parameters. Response bodies include `total` when applicable.

## Project Scoping

Most endpoints accept an optional `projectId` query parameter. When omitted, the system falls back to the default project or the caller's active project context.
