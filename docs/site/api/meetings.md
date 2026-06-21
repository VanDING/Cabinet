# Meetings API (Deprecated)

> **Status**: Deprecated. The `meeting_chair` role and MeetingService have been removed. The `/api/meetings` route is disabled in the current server. Multi-agent deliberation is handled through the AgentDispatcher's `parallel` dispatch mode and the `Organize` agent's design workflow instead.

Meetings were structured multi-agent deliberations with cost estimation, parallel reasoning, and cross-validation.

## Endpoints

### `GET /api/meetings`

List recent meetings.

**Query params**:

- `projectId` — Filter by project
- `limit` — Max results (default: 20, max: 100)

**Response**:

```json
{
  "meetings": [
    {
      "id": "del_1716200000000",
      "projectId": "proj-1",
      "meetingId": "meeting_1716200000000",
      "title": "Q3 Market Entry Strategy",
      "tags": ["strategy", "market"],
      "createdAt": "2026-05-20T10:00:00Z"
    }
  ]
}
```

> **Note**: Meetings are stored as deliverables of type `meeting_report`. The `meetingId` links to the original session.

### `POST /api/meetings`

Create and run a multi-agent meeting.

**Request**:

```json
{
  "topic": "Q3 Market Entry Strategy",
  "advisorIds": ["market_analyst", "risk_manager", "finance_advisor"],
  "projectId": "proj-1",
  "context": "We have completed Q2 research on EU consumer behavior...",
  "maxRounds": 3
}
```

| Field        | Type     | Required | Description                             |
| :----------- | :------- | :------- | :-------------------------------------- |
| `topic`      | string   | Yes      | Meeting topic                           |
| `advisorIds` | string[] | Yes      | Agent roles to invite as advisors       |
| `projectId`  | string   | No       | Project scope                           |
| `context`    | string   | No       | Background information                  |
| `maxRounds`  | number   | No       | Debate rounds (default: 3, hard max: 3) |

**Response**:

```json
{
  "meetingId": "meeting_1716200000000",
  "estimatedCost": 0.15,
  "actualCost": 0.18,
  "synthesis": "Consensus: Enter Germany and France first...",
  "perspectives": [
    {
      "advisor": "Market Analyst",
      "role": "market_analyst",
      "content": "Germany offers the highest addressable market..."
    },
    {
      "advisor": "Risk Manager",
      "role": "risk_manager",
      "content": "Regulatory risk in France is manageable if..."
    }
  ],
  "crossValidation": {
    "agreements": ["Germany is the top priority", "Q4 timing is feasible"],
    "disagreements": ["France vs Spain as second market"],
    "contradictions": [],
    "gaps": ["Local partnership strategy undefined"],
    "coherenceScore": 0.72
  },
  "decisionId": "dec_1716200000001"
}
```

### `GET /api/meetings/:id`

Retrieve a meeting report.

**Response**:

```json
{
  "id": "del_1716200000000",
  "meetingId": "meeting_1716200000000",
  "title": "Q3 Market Entry Strategy",
  "content": "Full synthesis text...",
  "tags": ["strategy", "market"],
  "metadata": {
    "advisorCount": 3,
    "rounds": 2,
    "coherenceScore": 0.72,
    "decisionId": "dec_1716200000001"
  },
  "createdAt": "2026-05-20T10:00:00Z"
}
```

## Meeting Flow (Four-Phase Protocol)

1. **Cost Estimation** — Before execution, the system estimates token usage based on advisor count and topic complexity. If the estimate exceeds ¥0.50, Captain confirmation is required.
2. **Chair Phase** — The Meeting Chair receives the topic, parses intent, selects advisors, and constructs a structured Brief specifying what each advisor should focus on.
3. **Advisor Phase** — Each advisor receives the Brief and reasons independently on their assigned domain.
4. **Reviewer Phase** — A reviewer agent independently reviews all advisor outputs for logical completeness, evidence quality, risk assessment, and factual accuracy.
5. **Extraction Phase** — Consensus, disagreements, contradictions, and gaps are extracted into a final deliverable with coherence score.
6. **Decision Extraction** — If the meeting yields a clear actionable decision, it is auto-extracted and sent to the DecisionService for L0-L3 classification.

## Cost Controls

| Parameter            | Default | Description                                       |
| :------------------- | :------ | :------------------------------------------------ |
| Max advisors         | 5       | Hard limit on parallel agents                     |
| Max rounds           | 3       | Hard limit on debate iterations                   |
| Tokens per speech    | 4,096   | Maximum per-advisor output                        |
| Budget threshold     | ¥0.50   | Confirmation required above this                  |
| Rumination threshold | 0.85    | Semantic similarity limit for duplicate arguments |

## Meeting vs Chat

|               | Meeting                                     | Chat                              |
| :------------ | :------------------------------------------ | :-------------------------------- |
| **Cost**      | Pre-estimated and capped                    | Per-message, visible in real time |
| **Structure** | Bounded rounds, formal synthesis            | Open-ended conversation           |
| **Output**    | Consensus + minority report + decision card | Direct answer or tool results     |
| **Agents**    | Multiple advisors + chair                   | Secretary + routed specialist     |
| **Use case**  | Complex trade-off analysis                  | Quick questions and tasks         |

Use meetings when the problem has multiple dimensions and you want structured disagreement. Use chat for everything else.
