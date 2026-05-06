# Documentation Enhancement Design

**Date**: 2026-05-04
**Status**: Approved
**Scope**: Bilingual README.md + README\_CN.md with CLI reference, API examples, and configuration guide

## Overview

Create two comprehensive README files for the Cabinet project:

- `README.md` — English version (GitHub default)
- `README_CN.md` — Chinese version

Both files share identical structure and content, differing only in language. Each file links to the other at the top for easy language switching.

## File Structure

Each README contains the following sections:

```
README.md / README_CN.md
├── Language Switcher
├── Badges (CI, Python, License)
├── Project Introduction (one-liner + core philosophy)
├── Architecture Overview (4-layer + 5-room model)
├── Quick Start
│   ├── Installation
│   ├── Initialization
│   ├── CLI Chat
│   └── Docker Deployment
├── CLI Command Reference
│   ├── Top-level Commands
│   ├── Chat Slash Commands
│   ├── Employee Management
│   ├── Skill Management
│   └── Knowledge Management
├── API Usage Examples
│   ├── Authentication
│   ├── Chat (REST + WebSocket)
│   ├── Employees
│   ├── Skills
│   ├── Knowledge
│   └── Rooms
├── Configuration Guide
│   ├── Environment Variables
│   ├── Model Configuration
│   ├── MCP Servers
│   └── API Authentication
└── Development
    ├── Local Development Setup
    ├── Running Tests
    └── CI/CD
```

## Section Details

### Language Switcher

`README.md` top:

```
[中文](README_CN.md) | English
```

`README_CN.md` top:

```
中文 | [English](README.md)
```

### Badges

- CI status: `[![CI](https://github.com/VanDING/Cabinet/actions/workflows/ci.yml/badge.svg)]`
- Python: `![Python 3.12+](https://img.shields.io/badge/python-3.12%2B-blue)`
- License: To be determined

### Project Introduction

One-paragraph summary of Cabinet: an open-source AI collaboration framework for super-individuals and one-person companies. Core philosophy: "Human Harness, AI Execute" — the user (Captain) leads, AI employees execute.

### Architecture Overview

ASCII art diagram showing:

```
┌─────────────────────────────────────────┐
│           User Interface Layer          │
│         CLI / HTTP API / WebSocket      │
├─────────────────────────────────────────┤
│         Workspace & Decision Layer      │
│  Meeting → Strategy → Decision → Office │
│              → Summary + Secretary      │
├─────────────────────────────────────────┤
│        Agent & Collaboration Layer      │
│    LiteLLMAgent / LLMTeam / Factory    │
├─────────────────────────────────────────┤
│         Foundation Layer                │
│  Gateway / EventBus / Memory / Knowledge│
│  Tools / Workflow / Harness             │
└─────────────────────────────────────────┘
```

Five-room model explanation:

- **Meeting Room** — Thinking: brainstorm and deliberate
- **Strategy Decoder** — Translation: decode proposals into blueprints
- **Decision Room** — Adjudication: make decisions with escalation
- **Office** — Execution: schedule tasks with verification gates
- **Summary Room** — Learning: extract insights and feedback

### Quick Start

**Installation**:

```bash
pip install -e .
```

**Initialization**:

```bash
cabinet init "My Organization"
cabinet config set-key openai sk-xxx
```

**CLI Chat**:

```bash
cabinet chat
```

**Docker**:

```bash
docker compose up -d
```

### CLI Command Reference

Table format covering all commands with parameters and descriptions. Based on the actual CLI implementation in `src/cabinet/cli/main.py`.

Key commands:

- `cabinet init`, `cabinet serve`, `cabinet chat`, `cabinet status`
- `cabinet config set-key/get-key/list-keys/set-token/get-token`
- `cabinet employee add/list`
- `cabinet skill load/list/run`
- `cabinet knowledge index/query`

Chat slash commands: `/meeting`, `/decide`, `/task`, `/strategy`, `/review`, `/skills`, `/employees`, `/status`, `/help`, `/quit`

### API Usage Examples

All examples use `curl` for maximum copy-paste usability.

**Authentication** (when `api_token` is configured):

```bash
curl -H "Authorization: Bearer <token>" http://localhost:8000/api/config
```

**Chat**:

```bash
curl -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello", "captain_id": "captain"}'
```

**WebSocket**:

```javascript
const ws = new WebSocket("ws://localhost:8000/api/chat/ws?captain_id=captain&token=<token>");
ws.onmessage = (e) => console.log(JSON.parse(e.data));
ws.send("Hello");
```

**Employees**:

```bash
curl -X POST http://localhost:8000/api/employees \
  -H "Content-Type: application/json" \
  -d '{"name": "Analyst", "role": "analyst"}'
```

**Skills**:

```bash
curl -X POST "http://localhost:8000/api/skills/load?path=/path/to/skill.md"
curl -X POST http://localhost:8000/api/skills/hello-world/run \
  -H "Content-Type: application/json" \
  -d '{"inputs": {"name": "World"}}'
```

**Knowledge**:

```bash
curl -X POST http://localhost:8000/api/knowledge/index \
  -H "Content-Type: application/json" \
  -d '{"path": "/path/to/docs"}'
curl -X POST http://localhost:8000/api/knowledge/query \
  -H "Content-Type: application/json" \
  -d '{"question": "What is Cabinet?", "top_k": 3}'
```

**Rooms**:

```bash
curl -X POST http://localhost:8000/api/rooms/meeting \
  -H "Content-Type: application/json" \
  -d '{"topic": "Q3 Strategy", "level": "multi_party"}'
```

### Configuration Guide

**Environment Variables**:

| Variable                     | Default | Description                              |
| ---------------------------- | ------- | ---------------------------------------- |
| `CABINET_DATA_DIR`           | `data`  | Data directory                           |
| `CABINET_LOG_LEVEL`          | `INFO`  | Logging level (DEBUG/INFO/WARNING/ERROR) |
| `LITELLM_API_KEYS_OPENAI`    | (empty) | OpenAI API key                           |
| `LITELLM_API_KEYS_ANTHROPIC` | (empty) | Anthropic API key                        |

**Model Configuration**: `data/models.json` file format (LiteLLM Router model\_list format).

**MCP Servers**: `mcp_servers` field in `cabinet.json` configuration.

**API Authentication**: Set `api_token` via `cabinet config set-token <token>`. When configured, all API endpoints require `Authorization: Bearer <token>` header.

### Development

**Local Setup**:

```bash
pip install -e ".[dev]"
```

**Running Tests**:

```bash
pytest tests/ -v
```

**Linting**:

```bash
ruff check src/ tests/
```

**CI/CD**: GitHub Actions runs on push/PR to main — lint, test, build.

## Design Decisions

1. **Two separate files** rather than a single bilingual file — cleaner reading experience, no language mixing
2. **curl for API examples** — universal, copy-paste friendly, no language-specific HTTP client needed
3. **ASCII art for architecture** — renders everywhere, no external tooling
4. **No CHANGELOG/CONTRIBUTING/ROADMAP** — YAGNI, add when needed
5. **No badges with hardcoded GitHub username** — use placeholder that can be updated after repository setup
6. **Content derived from actual code** — all commands, endpoints, and models verified against source

## Files to Create

| File           | Language | Purpose                                |
| -------------- | -------- | -------------------------------------- |
| `README.md`    | English  | GitHub default, international audience |
| `README_CN.md` | Chinese  | Chinese-speaking audience              |

