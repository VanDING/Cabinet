[中文](README_CN.md) | English

# Cabinet - Your AI Council

[![CI](https://github.com/VanDING/Cabinet/actions/workflows/ci.yml/badge.svg)](https://github.com/VanDING/Cabinet/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/VanDING/Cabinet/branch/main/graph/badge.svg)](https://codecov.io/gh/VanDING/Cabinet)
[![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

> *O Captain! My Captain!*

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

**Cabinet takes a different view.** It is designed from the perspective of an *organization*, assembling for you a structurally complete AI team with clearly defined roles that work in concert.

This is not an assistant. This is a **Cabinet**. It holds a Meeting Room for structured debate, a Strategy Room for blueprinting, a Decision Room for tiered adjudication, an Office for execution, and a Summary Room for extracting lessons. When you need it, an entire organization moves under the force of your will.

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

| Capability Gap | Solution |
|:---|:---|
| AI is not good at a specific task | Load a **Skill**—plug-and-play specialized capability |
| Multi-step work lacks coordination | Establish a **Workflow**—discipline through structure |
| External tools or data are needed | Connect via **MCP**—open a door to the outside world |
| Another AI's capabilities are required | Connect an **External AI Node**—even the strong can call for aid |
| The task itself requires a human to complete | Insert a **Human Node**—abstract a human collaborator as a configurable node in the workflow |

---

## Human Node: When the Machine Reaches Its Boundary

A **Human Node** is a special type of node in Cabinet's workflow. It represents a task unit that needs a human to complete—not the Captain's decision, but a unit of work that requires human hands, or is outsourced to external manpower and requires waiting for a human result to return.

Within Cabinet's worldview, a Human Node is not a "defect marker." It is a precise declaration of a boundary. It says: **Here is where the AI pipeline ends. Here, human involvement is needed.**

But the manner of this involvement is carefully designed: a Human Node is **configurable**. It defines input format, output format, expected completion time, and escalation strategy. A human collaborator works *within* this node, but the context, handoff, and quality verification of the whole workflow are still carried by the system.

This ensures that human intervention never becomes a black hole in the process. It is transparent, traceable, and integrated into the overall orchestration.

---

## The Captain's Node: The Irreplaceable Arbiter

A distinction must be made here.

**A Human Node is a supplement at the edge of AI's capability. The Captain is the apex of decision-making authority.**

When the workflow encounters a Human Node, the system is saying, "This requires a human to complete." When a matter is escalated to the Decision Room, the system is saying, "This requires *you* to adjudicate."

Cabinet does not try to fill everything with AI. It precisely maps the boundary between AI and human capability, and then establishes an efficient collaboration protocol along that line.

---

## Core Capabilities

- **The Five-Room Model · From Strategy to Execution**
  Meeting Room, Strategy Room, Decision Room, Office, and Summary Room—five chambers forming a complete organizational loop.

- **Secretary Interface · Your Single Natural Language Entry Point**
  No complex commands to learn. Simply talk to your Secretary, and it coordinates the entire Cabinet on your behalf.

- **Capability Pipeline Model · Flexible and Reusable AI Employees**
  Employees are no longer fixed-identity agents. They are now a dual-layer structure of **Capability Pipeline + Persona Shell**. Pipelines are reusable and composable; shells accumulate collaborative memory over the long term.

- **Intelligent Workflow · Dynamic Judgment and Tiered Decision-Making**
  The workflow engine has a built-in Execution Judgment Module that operates autonomously within L0–L3 decision boundaries, escalating only when necessary.

- **Human Node · Configurable Human Collaborator Nodes**
  Work that requires outsourcing or external human effort is abstracted as configurable nodes, ensuring human intervention never becomes a process black hole.

- **Skills · Plug-and-Play Capabilities**
  Specialized capabilities are packaged as Markdown-format Skills, installable on demand and infinitely extensible.

- **Local Knowledge Base · Your Externalized Mind**
  Index your local documents and make your experience and intellectual assets visible to the entire team.

- **Harness Quality Assurance · Built-in Evaluation and Verification Gates**
  Every output passes through evaluators and verification gates before delivery, ensuring quality is never an afterthought.

- **Open Interfaces · CLI and API**
  Command-line control, HTTP, and WebSocket support for seamless integration with other systems.

- **Observability · Transparent and Auditable**
  Built-in OpenTelemetry tracing and Prometheus metrics mean your AI team's operations are never a black box.

---

## Quick Start

### Installation

```bash
pip install -e .
```

### Initialize

```bash
cabinet init "My Organization"
cabinet set-api-key sk-your-api-key --provider openai
```

> **Note:** `cabinet config set-key` is deprecated. Use `cabinet set-api-key` instead. Keys are now stored encrypted in the KeyVault.

### Chat

```bash
cabinet chat
```

### Docker

```bash
docker compose up -d
```

## CLI Reference

### Top-Level Commands

| Command | Description |
|---------|-------------|
| `cabinet init <name>` | Initialize a new Cabinet organization |
| `cabinet serve` | Start the API server |
| `cabinet chat` | Start interactive chat with Secretary |
| `cabinet set-api-key <key> --provider <p>` | Store API key encrypted in KeyVault |
| `cabinet status` | Show organization status |
| `cabinet version` | Show version |

### Config Management

| Command | Description |
|---------|-------------|
| `cabinet config set-key <provider> <key>` | Set API key for a provider *(deprecated, use `set-api-key`)* |
| `cabinet config get-key <provider>` | Get masked API key |
| `cabinet config list-keys` | List all configured providers |
| `cabinet config set-token <token>` | Set API authentication token |
| `cabinet config get-token` | Get current API token |

### Employee Management

| Command | Description |
|---------|-------------|
| `cabinet employee add --name <n> --role <r>` | Add an employee |
| `cabinet employee list` | List all employees |

Options for `employee add`: `--personality`, `--kind` (default: `ai`)

### Skill Management

| Command | Description |
|---------|-------------|
| `cabinet skill load <path>` | Load a skill from a Markdown file |
| `cabinet skill list` | List all loaded skills |
| `cabinet skill run <name>` | Execute a skill |

Options for `skill run`: `-i key=value` (repeatable)

### Knowledge Management

| Command | Description |
|---------|-------------|
| `cabinet knowledge index <path>` | Index documents (.md, .txt) |
| `cabinet knowledge query <question>` | Query the knowledge base |

### Chat Slash Commands

| Command | Description |
|---------|-------------|
| `/meeting <topic>` | Start a deliberation session |
| `/decide <title>` | Submit a decision request |
| `/task <description>` | Submit an execution task |
| `/strategy <proposal>` | Decode a strategic proposal |
| `/review` | Start a review session |
| `/skills` | List available skills |
| `/employees` | List registered employees |
| `/status` | Show pending summary |
| `/help` | Show help |
| `/quit` | Exit chat |

## Interactive API Docs

When the API server is running, interactive documentation is available at:

- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

## API Examples

The API server runs at `http://localhost:8000` by default.

### Authentication

When `api_token` is configured, all endpoints require a Bearer token:

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/config
```

When `api_token` is empty (default), no authentication is required.

### Chat

**REST:**

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "captain_id": "captain"}'
```

**WebSocket:**

```javascript
const ws = new WebSocket("ws://localhost:8000/api/chat/ws?captain_id=captain&token=<token>");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.send("Hello");
```

Response format: `{"type": "chunk", "content": "..."}` followed by `{"type": "done"}`

### Employees

```bash
# List employees
curl http://localhost:8000/api/employees

# Create employee
curl -X POST http://localhost:8000/api/employees \
  -H "Content-Type: application/json" \
  -d '{"name": "Analyst", "role": "analyst", "kind": "ai"}'

# Get employee
curl http://localhost:8000/api/employees/<employee_id>

# Mount skill to employee
curl -X POST http://localhost:8000/api/employees/<employee_id>/skills/<skill_id>
```

### Skills

```bash
# List skills
curl http://localhost:8000/api/skills

# Load skill
curl -X POST "http://localhost:8000/api/skills/load?path=/path/to/skill.md"

# Run skill
curl -X POST http://localhost:8000/api/skills/<name>/run \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"key": "value"}}'
```

### Knowledge

```bash
# Index documents
curl -X POST http://localhost:8000/api/knowledge/index \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/docs"}'

# Query knowledge base
curl -X POST http://localhost:8000/api/knowledge/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is Cabinet?", "top_k": 3}'
```

### Rooms

```bash
# Meeting
curl -X POST http://localhost:8000/api/rooms/meeting \
  -H "Content-Type: application/json" \
  -d '{"topic": "Q3 Strategy", "level": "multi_party"}'

# Decision
curl -X POST http://localhost:8000/api/rooms/decision \
  -H "Content-Type: application/json" \
  -d '{"title": "Hire new analyst", "decision_type": "action"}'

# Task
curl -X POST http://localhost:8000/api/rooms/task \
  -H "Content-Type: application/json" \
  -d '{"description": "Prepare quarterly report"}'

# Strategy
curl -X POST http://localhost:8000/api/rooms/strategy \
  -H "Content-Type: application/json" \
  -d '{"proposal": "Expand to European market"}'

# Review
curl -X POST http://localhost:8000/api/rooms/review \
  -H "Content-Type: application/json" \
  -d '{"review_type": "project_review"}'
```

### Config

```bash
# Get current config
curl http://localhost:8000/api/config

# List available models
curl http://localhost:8000/api/config/models
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CABINET_DATA_DIR` | `data` | Data directory path |
| `CABINET_LOG_LEVEL` | `INFO` | Logging level (DEBUG/INFO/WARNING/ERROR) |
| `LITELLM_API_KEYS_OPENAI` | (empty) | OpenAI API key |
| `LITELLM_API_KEYS_ANTHROPIC` | (empty) | Anthropic API key |

### Model Configuration

Models are configured in `data/models.json` using the LiteLLM Router format:

```json
[
  {
    "model_name": "default",
    "litellm_params": {
      "model": "gpt-4o-mini"
    }
  },
  {
    "model_name": "fast",
    "litellm_params": {
      "model": "gpt-4o-mini"
    }
  }
]
```

### MCP Servers

Add MCP servers in `data/cabinet.json`:

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

### API Authentication

Set an API token to protect all endpoints:

```bash
cabinet config set-token your-secret-token
```

When configured, all API requests require `Authorization: Bearer your-secret-token`.

### Memory Storage

Set `memory_type` in `data/cabinet.json`:

- `"chromadb"` (default) — Vector-based long-term memory with semantic search
- `"sqlite"` — Simple SQLite-based short-term memory

## Python SDK

```python
from cabinet import CabinetRuntime, CabinetConfig
from cabinet.core.memory import SQLiteMemoryStore
from cabinet.agents import StubAgentFactory

async def main():
    runtime = CabinetRuntime(
        agent_factory=StubAgentFactory(),
        db_path="data/db/cabinet.db",
        memory_store=SQLiteMemoryStore(db_path="data/db/memory.db"),
    )
    await runtime.start()

    greeting = await runtime.secretary.greet(captain_id="captain")
    print(greeting.message)

    await runtime.stop()
```

## Observability

Cabinet includes built-in observability with OpenTelemetry tracing and Prometheus metrics.

### Configuration

```python
from cabinet.core.observability import ObservabilityConfig

config = ObservabilityConfig(
    enabled=True,
    service_name="my-cabinet",
    log_level="INFO",
    log_format="json",
    otlp_endpoint="http://localhost:4317",
    prometheus_port=9090,
)
```

### Metrics Endpoint

Prometheus metrics are exposed at `http://localhost:9090/metrics` when observability is enabled.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CABINET_OBSERVABILITY_ENABLED` | `true` | Enable/disable observability |
| `CABINET_OTLP_ENDPOINT` | (empty) | OpenTelemetry OTLP gRPC endpoint |
| `CABINET_PROMETHEUS_PORT` | `9090` | Prometheus metrics port |

## Deployment

### Docker

```bash
# Build and run
docker compose up -d

# With API keys
OPENAI_API_KEY=sk-xxx docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Data persists in the `cabinet-data` Docker volume.

### Manual

```bash
cabinet serve --host 0.0.0.0 --port 8000 --data-dir /data
```

## Development

```bash
# Install with dev dependencies
pip install -e ".[dev]"

# Run tests
pytest tests/ -v

# Lint
ruff check src/ tests/

# Build
pip wheel . --no-deps -w dist/
```

CI runs automatically on push/PR to `main` via GitHub Actions.

---

## Roadmap

Cabinet 1.0 established the complete organizational framework. Its core achievement: **A Captain is now able to assemble and command an AI team.**

V2.0 will take this framework from "functional" to "discerning," delivering on the promise that a Captain can do everything, but should do one thing.

### Capability Restructuring: The Dual-Layer Employee Model
- Refactor Employees from fixed-identity agents into a **"Capability Pipeline + Persona Shell"** dual-layer model
- A single pipeline template can be instantiated multiple times with different names, personalities, and collaborative memory
- Support for three collaboration paradigms—conversational, structured, and silent—in any combination
- Pipelines can be independently tested, free of permissions, memory, or persona dependencies

### Execution Intelligence Upgrade
- A built-in **Execution Judgment Module** within the workflow engine that makes dynamic decisions atop preset logic
- Introduction of a **four-tier decision boundary (L0–L3)** to precisely define the scope of AI autonomy
- Intelligent path selection when condition branches are not fully met, automatic reconciliation of parallel contradictions, and dynamic handling of execution timeouts
- **External AI Nodes** are scheduled as peers alongside internal pipelines in the workflow, subject to the same Harness quality assurance

### Captain Role Deepening: From Manager to Arbiter
- Workflow orchestration, pipeline parameter tuning, and project tracking are all handled autonomously by the system
- The Secretary reports to the Captain only when necessary; the Captain's daily view reduces to a handful of decision cards in the Decision Room
- Phase 1: manual setup by Captain → Phase 2: system observes and learns patterns → Phase 3: a single sentence from Captain triggers the entire flow autonomously

### Interface Expansion
- **Desktop**: A three-column strategic command center with multiple entry points (Decision Room chat, Meeting Room floor, Office canvas drag-and-drop)
- **Mobile**: A tactical decision terminal carrying *only* the Captain's sole core responsibility: deciding
- Mobile supports notification-bar quick actions for L1-level confirmations without opening the app

### Intelligence Layer Enhancements
- **Cabinet Designer**: Conversational workflow and employee design. Describe your need → system generates → Captain confirms
- **Secretary Agent Upgrades**: Proactive template recommendations, automatic pipeline parameter calibration, cross-project conflict detection, deep personality customization
- **Summary Room Upgrades**: Pre-mortem analysis (surface historical similar cases at decision time), proactive organizational memory retrieval, authorization audit and adjustment recommendations

### Community Ecosystem Expansion
- New: **Pipe Templates**—reusable capability bundles sitting between Skills and Team Blueprints in scope
- New: **Harness Rule Templates**—industry-specific quality standards (legal compliance review, financial analysis checks, etc.)
- New: **External AI Connectors**—adaptation Skills that wrap third-party AI services

### Further Down the Road
- **The Inevitable GUI**: A graphical interface allowing the Captain to survey the entire landscape at a glance
- **Community Skill and Pipeline Marketplace**: Share and reuse capability units created by others, allowing the ecosystem to grow continuously
- **Proactive Organizational Memory**: No longer passive retrieval; the system actively surfaces relevant historical lessons at the moment of decision

---

**The ultimate daily routine for Cabinet is a quiet picture.**

The Captain opens the system. In the Decision Room, a handful of decision cards rest quietly. Everything else—workflows running, pipelines tuning themselves, projects advancing—is handled autonomously by the system in the background. The Secretary only knocks gently when truly necessary.

---

## Contributing

Cabinet is still in its early stages. We welcome contributions of all kinds—code, documentation, ideas, or even one of your own AI employees.

**Join the Cabinet. Be the Captain.**
