# Infrastructure Enhancement Design

**Date**: 2026-05-04
**Status**: Approved
**Scope**: Test completion, Docker containerization, CI/CD pipeline, structured logging

## Overview

This design covers four infrastructure improvements for the Cabinet project, executed in dependency order:

1. **Test Completion + Verification** — Ensure codebase health before packaging
2. **Docker Containerization** — Produce a deployable container image
3. **CI/CD Pipeline** — Automate lint + test + build validation
4. **Structured Logging** — Add observability for production operation

## Phase 1: Test Completion + Verification

### Goal

Fill 3 test gaps from the quality/production readiness plan, then run full test suite + linter to confirm codebase health.

### Missing Tests

#### Unit Test: `test_load_skill`

- **File**: `tests/unit/api/test_skills.py`
- **Purpose**: Verify `/api/skills/load` endpoint loads a skill file correctly
- **Pattern**: Follow existing `test_run_skill_success`/`test_run_skill_not_found` pattern
- **Key assertions**: Response status 200, skill name in response, SkillStore.load called

#### Integration Test: `test_config_does_not_leak_secrets`

- **File**: `tests/integration/test_api_integration.py`
- **Purpose**: Verify `/api/config` endpoint does not expose `api_keys` or `api_token`
- **Pattern**: Set `api_token` and `api_keys` in config, call endpoint, assert secrets not in response
- **Key assertions**: `"api_keys" not in data`, `"api_token" not in data`

#### Integration Test: `test_chat_to_secretary_flow`

- **File**: `tests/integration/test_api_integration.py`
- **Purpose**: Verify `/api/chat` REST endpoint reaches Secretary and returns a response
- **Pattern**: Mock SecretaryAgentService, send chat request, verify response
- **Key assertions**: Response status 200, response contains message field

### Verification Steps

1. `python -m pytest tests/ -v` — All tests pass
2. `ruff check src/ tests/` — No lint errors

### Design Principles

- No production code changes — only test additions
- Follow existing test patterns (TestClient + mock dependency injection)

---

## Phase 2: Docker Containerization

### Goal

Create Dockerfile + docker-compose.yml for one-command deployment with persistent storage.

### Architecture

**Multi-stage Dockerfile**:

```
Stage 1 (builder):
  - Base: python:3.12-slim
  - Install build dependencies
  - Build wheel: pip wheel . --no-deps -w /dist

Stage 2 (runtime):
  - Base: python:3.12-slim
  - Copy wheel from builder
  - Install: pip install /dist/*.whl
  - Expose port 8000
  - Entry: cabinet serve
```

**docker-compose.yml**:

Single service with volumes:

```yaml
services:
  cabinet:
    build: .
    ports:
      - "8000:8000"
    volumes:
      - cabinet-data:/data
    environment:
      - CABINET_DATA_DIR=/data
      - CABINET_LOG_LEVEL=INFO
      - LITELLM_API_KEYS_OPENAI=${OPENAI_API_KEY:-}
    command: cabinet serve --host 0.0.0.0 --port 8000

volumes:
  cabinet-data:
```

### ChromaDB Deployment Mode

**Embedded mode** (recommended): ChromaDB runs inside the Cabinet container using `PersistentClient`. Data persisted via volume mount.

Rationale:
- No code changes required
- Self-contained single container
- Simpler deployment and networking
- Can migrate to standalone ChromaDB later if needed

### Files to Create

| File | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build |
| `docker-compose.yml` | Single service + volume |
| `.dockerignore` | Exclude .git, __pycache__, .venv, tests, docs |

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CABINET_DATA_DIR` | `/data` | Data directory for SQLite + ChromaDB + skills |
| `CABINET_LOG_LEVEL` | `INFO` | Logging level |
| `LITELLM_API_KEYS_OPENAI` | (empty) | OpenAI API key |
| `LITELLM_API_KEYS_ANTHROPIC` | (empty) | Anthropic API key |

---

## Phase 3: CI/CD Pipeline

### Goal

Create GitHub Actions workflow for automated PR validation: lint + test + build.

### Workflow Design

**File**: `.github/workflows/ci.yml`

**Triggers**:
- `push` to `main`
- `pull_request` to `main`

**Single job with serial steps**:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: pip install -e ".[dev]"
      - run: ruff check src/ tests/
      - run: pytest tests/ -v --tb=short
      - run: pip wheel . --no-deps -w dist/
```

### Design Decisions

- **Single job**: Project is small enough that parallel jobs add complexity without benefit
- **No Docker build in CI**: Docker build belongs in a release workflow, not PR validation
- **No coverage gate**: Ensure tests pass first, add coverage requirements later
- **Python 3.12 only**: Matches `pyproject.toml` requirement
- **No matrix testing**: Single Python version keeps CI fast

---

## Phase 4: Structured Logging

### Goal

Establish unified logging infrastructure for all core modules.

### Current State

- 62 `console.print()` calls — all in `cli/main.py` (Rich terminal output, appropriate for CLI)
- 5 files with `import logging` — only event_handlers
- 4 actual `logger.warning()` calls — all for "unknown event type"
- **Zero logging configuration** — no `basicConfig`, no handlers, no format
- ~90 files with no logging at all

### Design

#### 1. Logging Configuration Module

**File**: `src/cabinet/core/logging.py`

```python
import logging

def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
```

- Uses standard library `logging` — no third-party dependencies
- Unified format: timestamp | level | module name | message
- Level controlled by `CABINET_LOG_LEVEL` environment variable

#### 2. Logger Injection Points

Prioritized in three batches:

**P0 — Critical path (lifecycle + API)**:

| Module | Key Log Points |
|--------|---------------|
| `runtime.py` | `start()`, `stop()` lifecycle events |
| `api/app.py` | Lifespan startup/shutdown |
| `api/routes/chat.py` | Request entry, response, errors |

**P1 — Core services**:

| Module | Key Log Points |
|--------|---------------|
| `core/gateway/litellm_adapter.py` | Model calls, errors, fallback |
| `core/memory/sqlite_store.py` | Memory read/write operations |
| `core/memory/vector_store.py` | Vector store operations, close |
| `core/knowledge/local_kb.py` | Index/query operations |

**P2 — Business logic**:

| Module | Key Log Points |
|--------|---------------|
| `agents/llm_agent.py` | Agent execution, stream completion |
| `rooms/*/service.py` | Room service operations |

#### 3. Initialization Points

- `CabinetRuntime.start()` — call `setup_logging()`
- CLI `serve` command — read `CABINET_LOG_LEVEL` from env

#### 4. Design Principles

- `console.print()` in CLI layer stays unchanged — it's user-facing terminal output
- `logger` is for developer-facing operational logging
- No changes to any public API or protocol
- All loggers use `logger = logging.getLogger(__name__)` pattern
- Existing `logger` usage in event_handlers stays as-is (already correct pattern)

---

## Execution Order

```
Phase 1 (Test Completion)
    ↓ verify all tests pass + linter clean
Phase 2 (Docker)
    ↓ verify docker-compose up works
Phase 3 (CI/CD)
    ↓ verify workflow runs on push
Phase 4 (Logging)
    ↓ verify log output is structured
```

Each phase produces a verifiable deliverable before the next begins.
