# Decisions API

Decisions are immutable choice records with L0-L3 classification. This API covers creation, querying, approval, and audit.

## Endpoints

### `GET /api/decisions`

List decisions with optional filtering.

**Query params**:

| Param | Type | Default | Description |
| :---- | :--- | :------ | :---------- |
| `status` | string | `pending` | `pending`, `approved`, `rejected`, `expired`, `archived`, or `all` |
| `projectId` | string | — | Filter to a specific project |
| `limit` | number | 20 | Max results |
| `offset` | number | 0 | Pagination offset |

**Response**:

```json
{
  "decisions": [
    {
      "id": "dec_1716200000000",
      "projectId": "proj-1",
      "type": "strategic",
      "level": "L2",
      "status": "pending",
      "title": "Enter European Market",
      "description": "Evaluate expansion into EU markets based on Q2 research.",
      "options": [
        { "id": "approve", "label": "Approve", "impact": "Proceed with €500K investment" },
        { "id": "reject", "label": "Reject", "impact": "Maintain current focus" }
      ],
      "chosenOptionId": null,
      "captainId": "captain-1",
      "createdAt": "2026-05-20T10:00:00Z",
      "resolvedAt": null
    }
  ],
  "status": "pending",
  "total": 5
}
```

### `GET /api/decisions/:id`

Retrieve a single decision by ID. Triggers a background analysis if one does not exist.

**Response**:

```json
{
  "decision": {
    "id": "dec_1716200000000",
    "title": "Enter European Market",
    "status": "pending",
    "analysis": "Risk-adjusted NPV is positive...",
    ...
  }
}
```

### `POST /api/decisions`

Create a new decision.

**Request**:

```json
{
  "projectId": "proj-1",
  "type": "strategic",
  "title": "Enter European Market",
  "description": "Evaluate expansion into EU markets.",
  "options": [
    { "id": "approve", "label": "Approve", "impact": "Proceed with investment" },
    { "id": "reject", "label": "Reject", "impact": "Maintain focus" }
  ],
  "classification": {
    "scopeDescription": "Cross-session strategic decision",
    "estimatedCost": 0.5,
    "permissionLevel": "admin",
    "optionCount": 2
  },
  "captainId": "captain-1"
}
```

| Field | Type | Required | Description |
| :---- | :--- | :------- | :---------- |
| `projectId` | string | Yes | Owning project |
| `type` | enum | Yes | `strategic`, `action`, `execution`, `anomaly`, `evolution` |
| `title` | string | Yes | Decision title |
| `description` | string | No | Detailed context |
| `options` | array | No | Decision options (default: approve/reject) |
| `classification` | object | No | Features for automatic level classification |
| `captainId` | string | No | Defaults to `captain-1` |

**Response** (201 Created):

```json
{
  "decision": {
    "id": "dec_1716200000000",
    "level": "L2",
    "status": "pending",
    ...
  }
}
```

The level is auto-classified based on `classification` fields and heuristics.

### `POST /api/decisions/:id/approve`

Approve a pending decision.

**Request**:

```json
{
  "captainId": "captain-1",
  "chosenOptionId": "approve",
  "reason": "NPV analysis is convincing and risk is within tolerance."
}
```

**Response**:

```json
{
  "status": "approved",
  "chosenOptionId": "approve",
  "decision": { ... }
}
```

### `POST /api/decisions/:id/reject`

Reject a pending decision.

**Request**:

```json
{
  "captainId": "captain-1",
  "reason": "Too early; wait for Q3 data."
}
```

**Response**:

```json
{
  "status": "rejected",
  "decision": { ... }
}
```

### `POST /api/decisions/:id/reopen`

Re-open a rejected or expired decision. Creates a chain link via `parentId`.

**Request**:

```json
{
  "captainId": "captain-1"
}
```

**Response**:

```json
{
  "status": "pending",
  "decision": { ... }
}
```

### `GET /api/decisions/:id/audit`

Retrieve the full audit trail for a decision.

**Response**:

```json
{
  "entries": [
    {
      "action": "create",
      "actor": "captain-1",
      "timestamp": "2026-05-20T10:00:00Z",
      "changes": { "title": "Enter European Market", "level": "L2" }
    },
    {
      "action": "approve",
      "actor": "captain-1",
      "timestamp": "2026-05-20T14:30:00Z",
      "changes": { "chosenOptionId": "approve" }
    }
  ]
}
```

## Level Classification Behavior

When you create a decision, the system classifies it automatically:

- **L0/L1** — Approved automatically; not shown in pending lists
- **L2** — Appears in the Office dashboard and chat as a decision card
- **L3** — Triggers immediate notification (toast, badge, and optionally email)

If you disagree with the classification, you can override it when creating the decision or escalate via the Office UI.

## Decision Cards

L2+ decisions generate interactive cards in the desktop app containing:

- Dimensional comparison bars (risk, cost, time, reversibility, strategic fit)
- Option selection dropdown
- Reasoning text area
- Approve / Reject buttons
- Audit timeline

Cards are rendered by the shared `DecisionCard` component (`@cabinet/ui`).
