# Infrastructure Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete test gaps, add Docker containerization, CI/CD pipeline, and structured logging to make Cabinet deployable and observable.

**Architecture:** Four phases in dependency order — test completion ensures codebase health, Docker produces a deployable image, CI/CD automates validation, logging adds observability. Each phase produces a verifiable deliverable.

**Tech Stack:** Python 3.12, pytest, ruff, Docker, GitHub Actions, stdlib logging

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `tests/unit/api/test_skills.py` | Add test_load_skill |
| Modify | `tests/integration/test_api_integration.py` | Add 2 integration tests |
| Create | `Dockerfile` | Multi-stage build |
| Create | `docker-compose.yml` | Single service + volume |
| Create | `.dockerignore` | Exclude unnecessary files |
| Create | `.github/workflows/ci.yml` | CI pipeline |
| Create | `src/cabinet/core/logging.py` | Logging configuration |
| Modify | `src/cabinet/runtime.py` | Add logging calls |
| Modify | `src/cabinet/api/app.py` | Add logging calls |
| Modify | `src/cabinet/api/routes/chat.py` | Add logging calls |
| Modify | `src/cabinet/core/gateway/litellm_adapter.py` | Add logging calls |
| Modify | `src/cabinet/core/memory/sqlite_store.py` | Add logging calls |
| Modify | `src/cabinet/core/memory/vector_store.py` | Add logging calls |
| Modify | `src/cabinet/core/knowledge/local_kb.py` | Add logging calls |
| Modify | `src/cabinet/agents/llm_agent.py` | Add logging calls |
| Modify | `src/cabinet/cli/main.py` | Initialize logging in serve command |
| Create | `tests/unit/core/test_logging.py` | Test logging setup |

---

### Task 1: Test Completion — test_load_skill

**Files:**
- Modify: `tests/unit/api/test_skills.py`
- Reference: `src/cabinet/api/routes/skills.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/api/test_skills.py` (add `from unittest.mock import patch` to existing imports):

```python
@pytest.mark.asyncio
async def test_load_skill(app, mock_runtime):
    from cabinet.models.primitives import SkillDefinition
    from uuid import uuid4

    mock_skill = SkillDefinition(
        id=uuid4(),
        name="test-skill",
        kind="prompt",
        description="A test skill",
        requires_knowledge=False,
    )

    with patch("cabinet.core.tools.skill_store.SkillStore") as MockStore:
        mock_store_instance = AsyncMock()
        mock_store_instance.load_skill = AsyncMock(return_value=mock_skill)
        MockStore.return_value = mock_store_instance

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/api/skills/load",
                params={"path": "/tmp/test-skill.md"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["name"] == "test-skill"
            assert data["description"] == "A test skill"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/api/test_skills.py::test_load_skill -v`
Expected: FAIL (test may pass or fail depending on SkillStore behavior — verify the test runs)

- [ ] **Step 3: Run test to verify it passes**

Run: `python -m pytest tests/unit/api/test_skills.py::test_load_skill -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add tests/unit/api/test_skills.py
git commit -m "test: add test_load_skill for /api/skills/load endpoint"
```

---

### Task 2: Test Completion — Integration Tests

**Files:**
- Modify: `tests/integration/test_api_integration.py`
- Reference: `src/cabinet/api/routes/config.py`, `src/cabinet/api/routes/chat.py`

- [ ] **Step 1: Write test_config_does_not_leak_secrets**

Add to `tests/integration/test_api_integration.py`:

```python
@pytest.mark.asyncio
async def test_config_does_not_leak_secrets(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/config",
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "api_keys" not in data
        assert "api_token" not in data
```

- [ ] **Step 2: Write test_chat_to_secretary_flow**

Add to `tests/integration/test_api_integration.py`:

```python
@pytest.mark.asyncio
async def test_chat_to_secretary_flow(app, mock_runtime):
    from cabinet.rooms.secretary.models import SecretaryResponse

    mock_runtime.secretary.process_input = AsyncMock(
        return_value=SecretaryResponse(message="Hello, Captain!", level="normal")
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/chat",
            json={"message": "Hello", "captain_id": "cap1"},
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "response" in data
        assert data["captain_id"] == "cap1"
```

- [ ] **Step 3: Run integration tests**

Run: `python -m pytest tests/integration/test_api_integration.py -v`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_api_integration.py
git commit -m "test: add config leak and chat flow integration tests"
```

---

### Task 3: Full Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 2: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Commit (if any fixes were needed)**

Only commit if fixes were applied during verification.

---

### Task 4: Docker — .dockerignore

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Create .dockerignore**

```
.git
.github
__pycache__
*.pyc
*.pyo
.venv
venv
*.egg-info
dist
build
.pytest_cache
.ruff_cache
docs
tests
.mypy_cache
.coverage
htmlcov
.trae
```

- [ ] **Step 2: Commit**

```bash
git add .dockerignore
git commit -m "infra: add .dockerignore"
```

---

### Task 5: Docker — Dockerfile

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM python:3.12-slim AS builder

WORKDIR /build

COPY pyproject.toml .
COPY src/ src/

RUN pip wheel . --no-deps -w /dist


FROM python:3.12-slim

WORKDIR /app

COPY --from=builder /dist /dist
RUN pip install /dist/*.whl

RUN mkdir -p /data

ENV CABINET_DATA_DIR=/data
ENV CABINET_LOG_LEVEL=INFO

EXPOSE 8000

ENTRYPOINT ["cabinet", "serve", "--host", "0.0.0.0", "--port", "8000", "--data-dir", "/data"]
```

- [ ] **Step 2: Verify Docker build**

Run: `docker build -t cabinet:test .`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "infra: add multi-stage Dockerfile"
```

---

### Task 6: Docker — docker-compose.yml

**Files:**
- Create: `docker-compose.yml`

- [ ] **Step 1: Create docker-compose.yml**

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
      - CABINET_LOG_LEVEL=${CABINET_LOG_LEVEL:-INFO}
      - LITELLM_API_KEYS_OPENAI=${OPENAI_API_KEY:-}
      - LITELLM_API_KEYS_ANTHROPIC=${ANTHROPIC_API_KEY:-}
    restart: unless-stopped

volumes:
  cabinet-data:
```

- [ ] **Step 2: Verify docker-compose config**

Run: `docker compose config`
Expected: Valid YAML output with no errors

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "infra: add docker-compose.yml with volume persistence"
```

---

### Task 7: CI/CD — GitHub Actions Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create CI workflow**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Install dependencies
        run: pip install -e ".[dev]"

      - name: Lint
        run: ruff check src/ tests/

      - name: Test
        run: pytest tests/ -v --tb=short

      - name: Build wheel
        run: pip wheel . --no-deps -w dist/
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow for lint, test, build"
```

---

### Task 8: Structured Logging — Configuration Module

**Files:**
- Create: `src/cabinet/core/logging.py`
- Create: `tests/unit/core/test_logging.py`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/test_logging.py`:

```python
import logging

from cabinet.core.logging import setup_logging


def test_setup_logging_sets_level():
    setup_logging("DEBUG")
    root = logging.getLogger()
    assert root.level == logging.DEBUG


def test_setup_logging_default_info():
    setup_logging()
    root = logging.getLogger()
    assert root.level == logging.INFO


def test_setup_logging_configures_handler():
    setup_logging()
    root = logging.getLogger()
    assert len(root.handlers) > 0
    handler = root.handlers[0]
    assert "%(name)s" in handler.formatter._fmt
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/core/test_logging.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.logging'`

- [ ] **Step 3: Write implementation**

Create `src/cabinet/core/logging.py`:

```python
from __future__ import annotations

import logging


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        force=True,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/test_logging.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/logging.py tests/unit/core/test_logging.py
git commit -m "feat: add structured logging configuration module"
```

---

### Task 9: Structured Logging — P0 Injection (Runtime + API)

**Files:**
- Modify: `src/cabinet/runtime.py`
- Modify: `src/cabinet/api/app.py`
- Modify: `src/cabinet/api/routes/chat.py`
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: Add logging to runtime.py**

At the top of `src/cabinet/runtime.py`, after the existing imports, add:

```python
import logging

logger = logging.getLogger(__name__)
```

In the `start()` method, add after the method definition line:

```python
logger.info("CabinetRuntime starting")
```

At the end of `start()`, after `await self._discover_mcp_tools()`:

```python
logger.info("CabinetRuntime started successfully")
```

In the `stop()` method, add after the method definition line:

```python
logger.info("CabinetRuntime stopping")
```

At the end of `stop()`, after the last line:

```python
logger.info("CabinetRuntime stopped")
```

- [ ] **Step 2: Add logging to api/app.py**

At the top of `src/cabinet/api/app.py`, after the existing imports, add:

```python
import logging

logger = logging.getLogger(__name__)
```

In the `lifespan` function, add after `await runtime.start()`:

```python
logger.info("Cabinet API started")
```

Before `yield`, add:

```python
logger.info("Cabinet API ready")
```

After `await runtime.stop()`:

```python
logger.info("Cabinet API stopped")
```

- [ ] **Step 3: Add logging to api/routes/chat.py**

At the top of `src/cabinet/api/routes/chat.py`, after the existing imports, add:

```python
import logging

logger = logging.getLogger(__name__)
```

In the `chat` function, after extracting context, add:

```python
logger.info("Chat request from captain=%s", req.captain_id)
```

In the `chat_ws` function, after accepting the websocket, add:

```python
logger.info("WebSocket connection from captain=%s", captain_id)
```

In the `except WebSocketDisconnect` block, add:

```python
logger.info("WebSocket disconnected: captain=%s", captain_id)
```

- [ ] **Step 4: Initialize logging in CLI serve command**

In `src/cabinet/cli/main.py`, at the top of the file, add to the existing imports:

```python
import logging
```

In the `serve` function, after the `config_path` check, add:

```python
log_level = os.environ.get("CABINET_LOG_LEVEL", "INFO").upper()
from cabinet.core.logging import setup_logging
setup_logging(log_level)
```

- [ ] **Step 5: Run tests**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/runtime.py src/cabinet/api/app.py src/cabinet/api/routes/chat.py src/cabinet/cli/main.py
git commit -m "feat: add P0 structured logging to runtime, API, and chat"
```

---

### Task 10: Structured Logging — P1 Injection (Core Services)

**Files:**
- Modify: `src/cabinet/core/gateway/litellm_adapter.py`
- Modify: `src/cabinet/core/memory/sqlite_store.py`
- Modify: `src/cabinet/core/memory/vector_store.py`
- Modify: `src/cabinet/core/knowledge/local_kb.py`

- [ ] **Step 1: Add logging to litellm_adapter.py**

At the top of `src/cabinet/core/gateway/litellm_adapter.py`, after the existing imports, add:

```python
import logging

logger = logging.getLogger(__name__)
```

In the `complete` method, after the `response = await self._router.acompletion(...)` line, add:

```python
logger.info("LLM complete: model=%s tokens=%s", model, usage)
```

In the `stream` method, before the `async for` loop, add:

```python
logger.info("LLM stream start: model=%s", model)
```

- [ ] **Step 2: Add logging to sqlite_store.py**

At the top of `src/cabinet/core/memory/sqlite_store.py`, after the existing imports, add:

```python
import logging

logger = logging.getLogger(__name__)
```

In the `initialize` method, after `await self._db.commit()`, add:

```python
logger.info("SQLiteMemoryStore initialized: db_path=%s", self._db_path)
```

In the `close` method, after `self._db = None`, add:

```python
logger.info("SQLiteMemoryStore closed")
```

- [ ] **Step 3: Add logging to vector_store.py**

At the top of `src/cabinet/core/memory/vector_store.py`, after the existing imports, add:

```python
import logging

logger = logging.getLogger(__name__)
```

In the `close` method, after `self._client._system.stop()`, add:

```python
logger.info("ChromaDBMemoryStore closed")
```

- [ ] **Step 4: Add logging to local_kb.py**

At the top of `src/cabinet/core/knowledge/local_kb.py`, after the existing imports, add:

```python
import logging

logger = logging.getLogger(__name__)
```

In the `index` method, after the `self._collection.upsert(...)` call, add:

```python
logger.info("Indexed %d documents", len(documents))
```

In the `query` method, after the `chunks` list is built, add:

```python
logger.info("Knowledge query: top_k=%d results=%d", top_k, len(chunks))
```

- [ ] **Step 5: Run tests**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/gateway/litellm_adapter.py src/cabinet/core/memory/sqlite_store.py src/cabinet/core/memory/vector_store.py src/cabinet/core/knowledge/local_kb.py
git commit -m "feat: add P1 structured logging to gateway, memory, and knowledge"
```

---

### Task 11: Structured Logging — P2 Injection (Agents)

**Files:**
- Modify: `src/cabinet/agents/llm_agent.py`

- [ ] **Step 1: Add logging to llm_agent.py**

At the top of `src/cabinet/agents/llm_agent.py`, after the existing imports, add:

```python
import logging

logger = logging.getLogger(__name__)
```

In the `execute` method, after the `response = await self._gateway.complete(...)` line, add:

```python
logger.info("Agent execute: employee=%s model=%s", self._employee.role, context.model)
```

In the `execute_stream` method, after `complete = "".join(full_content)`, add:

```python
logger.info("Agent stream complete: employee=%s model=%s", self._employee.role, context.model)
```

- [ ] **Step 2: Run tests**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/agents/llm_agent.py
git commit -m "feat: add P2 structured logging to LLM agent"
```

---

### Task 12: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 2: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Verify Docker build**

Run: `docker build -t cabinet:final .`
Expected: Build succeeds

- [ ] **Step 4: Verify logging output**

Run: `python -c "from cabinet.core.logging import setup_logging; setup_logging('DEBUG'); import logging; logger = logging.getLogger('test'); logger.info('works')"`
Expected: Output contains `works` with structured format
