[中文](README_CN.md) | English

# Cabinet - Your AI Council

[![CI](https://github.com/VanDING/Cabinet/actions/workflows/ci.yml/badge.svg)](https://github.com/VanDING/Cabinet/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5%2B-blue.svg)](https://www.typescriptlang.org/)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> _O Captain! My Captain!_

---

## To Steer, or to Be Steered?

We are standing at a fork in the road of human-machine collaboration.

AI is expanding in capability at a speed that is hard to grasp. It writes code. It drafts contracts. It generates designs. It analyzes financial reports. Faced with this flood of ability, one question cuts to the core: **Who is actually at the helm? Is AI quietly steering us from one confirmation button to the next, or are we steering it toward a destination we have chosen?**

We reject a future where human beings are reduced to reviewers on an AI assembly line, exhausted by an endless stream of "I've generated something for you—would you like to accept?"

A Captain should stand above the noise, eyes on the horizon, touching only the moments that genuinely demand human judgment.

**A Captain can do everything, but should do one thing.**

That one thing is the decision. The directional choice. The value judgment. The final word when the system reaches the edge of its capabilities.

---

## From Individual Tooling to an Organization at Your Command

Most AI products on the market today are built from the perspective of the individual. They offer tools for a specific role in a specific scenario—helping a developer write code, a designer generate images, a marketer draft copy. They are competent at what they do, but at their core, they are weapons meant for a lone soldier.

**Cabinet takes a different view.** It is designed from the perspective of an _organization_, assembling for you a structurally complete AI team with clearly defined roles that work in concert.

This is not an assistant. This is a **Cabinet**. It operates as a continuous pipeline: you speak to your Secretary, multi-agent deliberation produces synthesis, actionable outcomes flow into tiered decisions for your adjudication or into the workflow engine for execution, and every result feeds back into memory for continuous learning. When you need it, an entire organization moves under the force of your will.

And you are the sole **Captain**.

---

## Design from the Endgame: Assume AI Can Do Everything

Much of today's AI product design is, in truth, compensation for the technology's current limitations—carefully crafted prompts, painstaking context management, obsessive token budgeting. These are necessary today, but we see clearly that **these limitations will eventually be overtaken by progress.**

So Cabinet chose a more fundamental design philosophy: **Start from the endgame. Assume AI can do everything first, and only then add back the real-world scaffolding it currently needs.**

### Don't Watch the Process, Judge the Result

This is the natural deduction that follows.

When AI is executing a task—how many approaches it tried, how many times it self-corrected, how many internal reasoning loops it ran—**a human does not need to see any of this.** Just as you would not monitor every heartbeat and blink of a team member, you only need to pay attention to the delivered result.

Cabinet's principle here is clear: **AI operates autonomously in the execution layer and only raises a signal at the boundary where a decision is needed.** The noise of the process is absorbed by the system. What reaches the Captain is only the outcome, and the critical junctures.

### A Scaffolding System That Begins at the Capability Gap

Built on this principle, our auxiliary systems are designed to address specific capability gaps:

| Capability Gap                               | Solution                                                                                     |
| :------------------------------------------- | :------------------------------------------------------------------------------------------- |
| AI is not good at a specific task            | Load a **Skill**—plug-and-play specialized capability                                        |
| Multi-step work lacks coordination           | Establish a **Workflow**—discipline through structure                                        |
| External tools or data are needed            | Connect via **MCP**—open a door to the outside world                                         |
| Another AI's capabilities are required       | Connect an **External AI Node**—even the strong can call for aid                             |
| The task itself requires a human to complete | Insert a **Human Node**—abstract a human collaborator as a configurable node in the workflow |

---

## Human Node: When the Machine Reaches Its Boundary

A **Human Node** is a special type of node in Cabinet's workflow. It represents a task unit that needs a human to complete—not the Captain's decision, but a unit of work that requires human hands, or is outsourced to external manpower and requires waiting for a human result to return.

Within Cabinet's worldview, a Human Node is not a "defect marker." It is a precise declaration of a boundary. It says: **Here is where the AI pipeline ends. Here, human involvement is needed.**

But the manner of this involvement is carefully designed: a Human Node is **configurable**. It defines input format, output format, expected completion time, and escalation strategy. A human collaborator works _within_ this node, but the context, handoff, and quality verification of the whole workflow are still carried by the system.

This ensures that human intervention never becomes a black hole in the process. It is transparent, traceable, and integrated into the overall orchestration.

---

## The Captain's Node: The Irreplaceable Arbiter

A distinction must be made here.

**A Human Node is a supplement at the edge of AI's capability. The Captain is the apex of decision-making authority.**

When the workflow encounters a Human Node, the system is saying, "This requires a human to complete." When a matter is escalated to the Decision Room, the system is saying, "This requires _you_ to adjudicate."

Cabinet does not try to fill everything with AI. It precisely maps the boundary between AI and human capability, and then establishes an efficient collaboration protocol along that line.

---

## Architecture

Cabinet V2.0 is a **TypeScript monorepo** built on a strict 4-layer architecture. Thirteen packages and two applications are organized by dependency direction—lower layers never depend on upper layers.

```
Layer 4 (Interface):   ui, server, desktop       ← user/network boundary
Layer 3 (Business):    decision, secretary, meeting, workflow, harness  ← business logic
Layer 2 (Agent Core):  gateway, agent, memory     ← AI interaction core
Layer 1 (Infra):       types, events, storage     ← infrastructure
```

| Layer | Package              | Role                                                       |
| :---- | :------------------- | :--------------------------------------------------------- |
| 4     | `@cabinet/server`    | Hono REST + WebSocket API server                           |
| 4     | `@cabinet/desktop`   | Tauri 2.0 desktop app (React 19)                           |
| 4     | `@cabinet/ui`        | Shared React component library                             |
| 3     | `@cabinet/decision`  | Tiered decision management (L0–L3)                         |
| 3     | `@cabinet/secretary` | Natural-language entry point, session management           |
| 3     | `@cabinet/workflow`  | Workflow engine (Skill, Condition, Parallel, Human nodes)  |
| 3     | `@cabinet/harness`   | Quality gates, evaluators, verification                    |
| 2     | `@cabinet/gateway`   | Multi-provider LLM gateway (Vercel AI SDK)                 |
| 2     | `@cabinet/agent`     | TAOR agent loop (Think-Act-Observe-React)                  |
| 2     | `@cabinet/memory`    | Four-layer memory (short-term, long-term, entity, project) |
| 1     | `@cabinet/events`    | Event bus with causation-chain tracking                    |
| 1     | `@cabinet/storage`   | SQLite persistence (better-sqlite3, AES-256)               |
| 1     | `@cabinet/types`     | Shared TypeScript types—universal dependency               |

---

## Core Capabilities

- **Pipeline Architecture · Deliberation to Decision to Execution**
  Secretary (unified entry) → Multi-Agent Meeting (deliberation + synthesis) → Decision (L0–L3 tiered adjudication) → Workflow (execution with Human Nodes) → Memory + Harness (learning + quality feedback). A continuous pipeline, not isolated rooms.

- **Secretary Interface · Your Single Natural-Language Entry Point**
  No complex commands to learn. Simply talk to your Secretary, and it coordinates the entire Cabinet on your behalf.

- **Capability Pipeline Model · Flexible, Reusable AI Employees**
  Employees are a dual-layer structure of **Capability Pipeline + Persona Shell**. Pipelines are reusable and composable; shells accumulate collaborative memory over the long term.

- **Intelligent Workflow · Dynamic Judgment and Tiered Decision-Making**
  The workflow engine has a built-in Execution Judgment Module that operates autonomously within L0–L3 decision boundaries, escalating only when necessary.

- **Human Node · Configurable Human Collaborator Nodes**
  Work that requires outsourcing or external human effort is abstracted as configurable nodes, ensuring human intervention never becomes a process black hole.

- **Skills · Plug-and-Play Capabilities**
  Specialized capabilities packaged as Markdown-format Skills, installable on demand and infinitely extensible.

- **Four-Layer Memory · Your Externalized Mind**
  Short-term session context, long-term semantic retrieval, entity preferences, and project knowledge—consolidated and project-isolated.

- **Harness Quality Assurance · Built-in Evaluation and Verification Gates**
  Every output passes through evaluators and verification gates before delivery, ensuring quality is never an afterthought.

- **Multi-Project Support · Isolated Contexts**
  Each project maintains its own memory, employees, and decisions. Switch contexts without cross-contamination.

- **Multi-Provider LLM Gateway · Budget-Aware Routing**
  Anthropic and OpenAI support via Vercel AI SDK, with model routing by role, fallback chains, cost tracking, and budget guards.

- **Desktop & Server · Tauri App + Hono API**
  A three-column strategic command center on desktop; REST and WebSocket APIs for integration.

- **Observability · Transparent and Auditable**
  Built-in OpenTelemetry tracing and Prometheus metrics mean your AI team's operations are never a black box.

---

## Quick Start

### Prerequisites

- **Node.js** 22+ and **pnpm** 9+

### Install and Build

```bash
pnpm install
pnpm build
```

### Configure API Keys

Set your LLM provider keys as environment variables:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export OPENAI_API_KEY=sk-...
```

### Start the Server

```bash
cd apps/server && pnpm dev
```

The API server starts at `http://localhost:3000`.

### Start the Desktop App

```bash
cd apps/desktop && pnpm tauri:dev
```

### Docker

```bash
docker compose up -d
```

---

## API

The server runs at `http://localhost:3000` by default. Interactive API docs are available at:

- **Scalar**: `http://localhost:3000/docs`
- **OpenAPI spec**: `http://localhost:3000/openapi.json`

### Authentication

When `api_token` is configured, all endpoints require a Bearer token:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/config
```

### Chat

**REST:**

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "captain_id": "captain"}'
```

**WebSocket:**

```javascript
const ws = new WebSocket('ws://localhost:3000/api/chat/ws?captain_id=captain&token=<token>');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.send('Hello');
```

Response format: `{"type": "chunk", "content": "..."}` followed by `{"type": "done"}`

### Core Endpoints

```bash
# Secretary — chat with your AI Cabinet
curl -X POST http://localhost:3000/api/secretary/chat \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "sess_1", "message": "Analyze whether we should expand to Europe"}'

# Meetings — multi-agent deliberation (also triggerable from chat)
curl -X POST http://localhost:3000/api/meetings \
  -H "Content-Type: application/json" \
  -d '{"topic": "Q3 Strategy", "advisors": ["financial", "legal", "market"]}'

# Decisions — tiered decision management
curl -X POST http://localhost:3000/api/decisions \
  -H "Content-Type: application/json" \
  -d '{"title": "Hire new analyst", "type": "action"}'

# Workflows — execute multi-step processes
curl -X POST http://localhost:3000/api/factory \
  -H "Content-Type: application/json" \
  -d '{"name": "Quarterly Report", "definition": {...}}'
```

### Employees, Skills, Knowledge

```bash
# Employees
curl http://localhost:3000/api/employees
curl -X POST http://localhost:3000/api/employees \
  -H "Content-Type: application/json" \
  -d '{"name": "Analyst", "role": "analyst", "kind": "ai"}'

# Skills
curl -X POST "http://localhost:3000/api/skills/load?path=/path/to/skill.md"
curl http://localhost:3000/api/skills

# Knowledge base
curl -X POST http://localhost:3000/api/knowledge/index \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/docs"}'
curl -X POST http://localhost:3000/api/knowledge/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is Cabinet?", "top_k": 3}'
```

---

## Configuration

### Environment Variables

| Variable                  | Default       | Description                                 |
| :------------------------ | :------------ | :------------------------------------------ |
| `ANTHROPIC_API_KEY`       | (empty)       | Anthropic API key                           |
| `OPENAI_API_KEY`          | (empty)       | OpenAI API key                              |
| `CABINET_MASTER_PASSWORD` | `change-me`   | Master encryption password for the database |
| `PORT`                    | `3000`        | Server port                                 |
| `NODE_ENV`                | `development` | Runtime environment                         |

### Model Configuration

Models are configured via the LLM gateway (`@cabinet/gateway`) with multi-provider support through Vercel AI SDK. The gateway supports:

- **Role-based routing**: `deep_think`, `fast_execute`, `default` roles mapped to appropriate models
- **Fallback chains**: Automatic failover on timeout (30s) or error
- **Budget guards**: Daily ($5), weekly ($25), monthly ($100) spending limits
- **Cost tracking**: Per-request and aggregate cost monitoring

### MCP Servers

Configure MCP servers in your Cabinet data directory:

```json
{
  "mcp_servers": [
    {
      "name": "filesystem",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path"]
    }
  ]
}
```

### Memory Storage

Cabinet V2.0 uses a four-layer memory architecture backed by SQLite:

- **ShortTerm**: Session context, in-memory + SQLite
- **LongTerm**: Cross-session semantic retrieval with consolidation
- **Entity**: Captain preferences, employee configurations
- **Project**: Goals, milestones, decisions—isolated per project

---

## Development

```bash
# Install dependencies
pnpm install

# Type-check all packages
pnpm typecheck

# Run all tests
pnpm test

# Run E2E tests
pnpm test:e2e

# Architecture layer lint
pnpm lint

# Build all packages
pnpm build

# Start server in dev mode
cd apps/server && pnpm dev

# Start desktop app in dev mode
cd apps/desktop && pnpm tauri:dev

# Start docs site
cd docs/site && pnpm dev
```

CI runs automatically on push and PR to `main` via GitHub Actions (Node 22, pnpm 9).

---

## Deployment

### Docker

```bash
# Build and run
docker compose up -d

# With API keys
ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-... docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Data persists in the `cabinet_data` Docker volume.

### Manual

```bash
pnpm build
node apps/server/dist/main.js
```

The server listens on port 3000 by default. Set `PORT` to change it.

---

## Contributing

Cabinet is still in its early stages. We welcome contributions of all kinds—code, documentation, ideas, or even one of your own AI employees.

**Join the Cabinet. Be the Captain.**
