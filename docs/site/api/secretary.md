# Secretary API

The Secretary is the front-door agent. It parses natural language input, routes to specialist agents, and returns streamed responses.

## Endpoints

### `POST /api/secretary/chat`

Send a message to the Secretary and receive a streamed response.

**Request**:

```json
{
  "sessionId": "sess_123",
  "message": "Should we enter the European market?",
  "projectId": "proj-1",
  "stream": true,
  "files": [
    { "name": "market_research.pdf", "path": "/docs/market_research.pdf", "type": "application/pdf" }
  ],
  "model": "anthropic/claude-sonnet-4-6",
  "targetAgent": "secretary"
}
```

| Field | Type | Required | Description |
| :---- | :--- | :------- | :---------- |
| `sessionId` | string | Yes | Session identifier for context continuity |
| `message` | string | Yes | User message |
| `projectId` | string | No | Scope the conversation to a project |
| `stream` | boolean | No | Enable SSE streaming (default: true) |
| `files` | array | No | Attached files for context |
| `model` | string | No | Override the default model |
| `targetAgent` | string | No | Route directly to a specific agent role |

**Response (SSE when `stream: true`)**:

Event stream fragments include:

- `routing_start` — Agent handoff notification
- `thinking_start` / `thinking_end` — Reasoning blocks
- `tool_call` — Tool invocation details
- `content` — Generated text segments
- `subagent_activity` — Parallel agent activities
- `done` — Stream termination

**Response (JSON when `stream: false`)**:

```json
{
  "content": "Based on the research...",
  "agentName": "secretary",
  "toolCalls": [],
  "cost": 0.023
}
```

### `GET /api/secretary/history`

Retrieve conversation history for a session.

**Query params**:

- `sessionId` — Session identifier
- `limit` — Max messages (default: 50)

**Response**:

```json
{
  "messages": [
    { "id": "u_1", "role": "user", "content": "...", "timestamp": "2026-05-20T10:00:00Z" },
    { "id": "a_1", "role": "assistant", "content": "...", "agentName": "secretary" }
  ]
}
```

### `POST /api/secretary/greeting`

Generate a daily greeting and summary.

**Request**:

```json
{
  "captainId": "captain-1"
}
```

**Response**:

```json
{
  "greeting": "Good morning, Captain. You have 3 pending decisions and 2 workflows completed overnight.",
  "pendingDecisions": 3,
  "todayCost": 0.45
}
```

## Intent Routing

The Secretary uses `IntentParser` to classify requests before routing:

| Intent | Routed To | Example Trigger |
| :----- | :-------- | :-------------- |
| `decision_request` | DecisionService | "Should we...", "Analyze whether..." |
| `meeting_request` | MeetingService | "Get advisors to discuss...", "Meeting on..." |
| `workflow_request` | WorkflowDesigner | "Create a workflow that...", "Automate..." |
| `task_request` | AgentDispatcher | "Write a script to...", "Generate..." |
| `query` | Secretary (direct) | "What is...", "Show me..." |

If confidence is below 0.5, the Secretary suggests creating or importing a specialist agent.

## Streaming Protocol

The chat endpoint uses Server-Sent Events (SSE). Each line is a JSON object:

```
data: {"type":"content","text":"Hello"}

data: {"type":"tool_call","name":"create_decision","params":{}}

data: {"type":"done"}
```

The desktop app's `readSSEStream` utility parses this into incremental UI updates.

## Safety Integration

All tool calls triggered by the Secretary pass through the `SafetyChecker` before execution. If a call is blocked:

1. The tool error is returned to the agent loop
2. The agent may retry with a safer approach
3. If blocked at L2/L3, a decision card is surfaced to the Captain

## Cost Transparency

Token usage and estimated cost are tracked per message and accumulated per session. Costs are displayed in the chat UI in real time.
