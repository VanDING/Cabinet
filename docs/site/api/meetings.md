# Meetings API

Multi-agent deliberation meetings with parallel reasoning and cross-validation.

## Endpoints

### `GET /api/meetings`

List recent meetings.

**Query params**: `projectId` (default: `"default"`)

**Response**:
```json
{
  "meetings": [{ "id": "meeting_...", "topic": "...", "status": "completed" }]
}
```

### `POST /api/meetings`

Create a new multi-agent meeting.

**Body**:
```json
{
  "topic": "Q3 Market Entry Strategy",
  "advisorIds": ["a1", "a2"],
  "projectId": "proj-1"
}
```

**Response**:
```json
{
  "meetingId": "meeting_...",
  "estimatedCost": 0.15,
  "synthesis": "...",
  "perspectives": [
    { "advisor": "Market Analyst", "role": "Analyst", "content": "..." },
    { "advisor": "Risk Manager", "role": "Risk", "content": "..." }
  ],
  "crossValidation": {
    "agreements": ["..."],
    "disagreements": ["..."],
    "contradictions": [],
    "gaps": ["..."],
    "coherenceScore": 0.72
  }
}
```

## Meeting Flow

1. **Cost Estimation** — pre-meeting estimate shown to Captain
2. **Parallel Reasoning** — all advisors reason independently
3. **Debate Rounds** — structured multi-round debate protocol
4. **Cross Validation** — detect agreements, disagreements, contradictions, gaps
5. **Synthesis** — chair produces final recommendation
6. **Decision Extraction** — actionable decisions auto-extracted when possible
