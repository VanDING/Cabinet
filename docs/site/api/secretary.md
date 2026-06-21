# Secretary API

The Secretary is the front-door agent. It parses natural language input through a 4-layer intent pipeline, routes to specialist agents (organize) or external agents (daemon), and returns streamed responses.

## Endpoints

### `POST /api/secretary/chat`

Send a message to the Secretary and receive a streamed or JSON response.

**Request**:

```json
{
  "sessionId": "sess_123",
  "message": "Should we enter the European market?",
  "projectId": "proj-1",
  "stream": true,
  "files": [
    {
      "name": "market_research.pdf",
      "path": "/docs/market_research.pdf",
      "type": "application/pdf"
    }
  ],
  "model": "anthropic/claude-sonnet-4-6",
  "targetAgent": "secretary",
  "dispatchMode": "single",
  "thinkingBudget": 4096
}
```

| Field            | Type    | Required | Description                                               |
| :--------------- | :------ | :------- | :-------------------------------------------------------- |
| `sessionId`      | string  | Yes      | Session identifier for context continuity                 |
| `message`        | string  | Yes      | User message                                              |
| `captainId`      | string  | No       | Captain identifier (defaults to default)                  |
| `projectId`      | string  | No       | Scope the conversation to a project (default: `'global'`) |
| `model`          | string  | No       | Override the default model                                |
| `stream`         | boolean | No       | Enable SSE streaming (default: false)                     |
| `files`          | array   | No       | Attached files for context: `{ name, path, type? }`       |
| `dispatchMode`   | string  | No       | `'single'` (default), `'pipeline'`, or `'parallel'`       |
| `targetAgent`    | string  | No       | Route directly to a specific agent role by name           |
| `thinkingBudget` | number  | No       | 1024–128000, extended thinking token budget               |
| `type`           | string  | No       | `'chat'` (default) or `'skill_invoke'`                    |
| `skillName`      | string  | No       | Skill name when `type: 'skill_invoke'`                    |
| `skillArgs`      | string  | No       | JSON string of skill arguments                            |
| `interactive`    | boolean | No       | Enable interactive mode for Organize agent                |

**Response (SSE when `stream: true`)**:

Event stream fragments:

- `routing_start` — Agent handoff notification
- `thinking_start` / `thinking_end` — Reasoning blocks
- `tool_call` — Tool invocation details
- `content` — Generated text segments
- `subagent_activity` — Parallel agent activities
- `done` — Stream termination

**Response (JSON when `stream: false`)**:

```json
{
  "response": "Based on the research...",
  "agentName": "secretary",
  "toolCalls": [],
  "cost": 0.023
}
```

### `GET /api/secretary/greeting`

Generate a daily greeting with pending decisions, active workflows, and today's cost.

**Response**:

```json
{
  "greeting": "Good morning, Captain. You have 3 pending decisions and 2 workflows completed overnight.",
  "pendingDecisions": 3,
  "todayCost": 0.45
}
```

### `GET /api/secretary/sessions`

List all active sessions.

### `POST /api/secretary/sessions/:id/close`

Close a session and trigger memory consolidation.

### `GET /api/secretary/context`

Get token usage and zone classification for a session.

### `POST /api/secretary/compact`

Compress a session's message history by summarizing older messages.

### `GET /api/secretary/verify`

Test that the LLM API key is working correctly.

### `POST /api/secretary/subagent/input`

Send user input to a running sub-agent session.

### `POST /api/secretary/subagent/finalize`

Confirm sub-agent completion and merge results back.

### `GET /api/secretary/sessions/:id/children`

List sub-agent sessions for a parent session.

### `GET /api/secretary/subagent/:id/status`

Get the status of a running sub-agent.

## Intent Routing

The Secretary uses a 4-layer intent parser (keyword → regex → embedding → LLM) to classify requests:

| Intent             | Routed To      | Example Trigger                              |
| :----------------- | :------------- | :------------------------------------------- |
| `decision_request` | Secretary      | "Should we...", "Analyze whether..."         |
| `organize_request` | Organize Agent | "Design a workflow...", "Create an agent..." |
| `skill_request`    | Organize Agent | "Write a skill for..."                       |
| `invoke_skill`     | Secretary      | Use `/skillName` syntax in message           |
| `mcp_request`      | Organize Agent | "Set up an MCP server for..."                |
| `status_query`     | Secretary      | "What is...", "Show me..."                   |
| `knowledge_query`  | Secretary      | "What do we know about..."                   |
| `schedule_request` | Secretary      | "Remind me to...", "Schedule..."             |
| `follow_up`        | Secretary      | Contextual continuation of previous turn     |

If confidence is below threshold, the Secretary handles the request directly.

## Streaming Protocol

The chat endpoint uses Server-Sent Events (SSE). Each line is a JSON object:

```
data: {"type":"content","text":"Hello"}

data: {"type":"tool_call","name":"create_decision","params":{}}

data: {"type":"done"}
```

The desktop app's `readSSEStream` utility parses this into incremental UI updates.

## Sub-Agent Interaction

Conversations can spawn sub-agents (via `create_sub_agent` tool) for parallel or long-running tasks. Sub-agents have isolated session state and support mid-flight user input via `POST /api/secretary/subagent/input`.

## Cost Transparency

Token usage and estimated cost are tracked per message and accumulated per session. Costs are displayed in the chat UI in real time.
