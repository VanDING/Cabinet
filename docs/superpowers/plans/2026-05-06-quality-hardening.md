# Quality Hardening & Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 Cabinet 全模块进行轻量质量加固，使框架从 Alpha 走向生产可用。

**Architecture:** 自底向上四阶段流水线：T1 测试补全 → T2 健壮性加固 → T3 性能优化 → T4 运维友好。每阶段有明确验收标准，必须全部满足后才能进入下一阶段。

**Tech Stack:** Python 3.12+, pytest, aiosqlite, asyncio, litellm, pydantic, fastapi, httpx

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `tests/unit/api/test_agents_routes.py` | Agent API 路由测试 |
| `tests/unit/api/test_workflows_routes.py` | Workflow API 路由测试 |
| `tests/unit/agents/test_context.py` | AgentContext/AgentOutput/SkillContext/SkillOutput 模型测试 |
| `tests/unit/api/conftest.py` | API 共享 fixture |
| `tests/unit/core/conftest.py` | Core 共享 fixture |
| `tests/unit/rooms/conftest.py` | Room 共享 fixture |
| `tests/unit/agents/conftest.py` | Agent 共享 fixture |
| `src/cabinet/core/db/connection_manager.py` | SharedConnectionManager |
| `src/cabinet/core/workflow/safe_eval.py` | 安全表达式求值器 |

### Modified Files

| File | Changes |
|------|---------|
| `pyproject.toml` | pytest markers, CI 覆盖率门槛 |
| `.github/workflows/ci.yml` | 覆盖率门槛 60→75 |
| `tests/conftest.py` | 全局共享 fixture |
| `src/cabinet/core/gateway/litellm_adapter.py` | stream() 异常处理 + 缓存 |
| `src/cabinet/core/events/asyncio_bus.py` | 并发 handler + 持久化解耦 |
| `src/cabinet/core/workflow/dead_letter_queue.py` | close() 方法 |
| `src/cabinet/core/workflow/engine.py` | 条件异常保护 + 并行错误处理 + 全局超时 + safe_eval |
| `src/cabinet/runtime.py` | 事务式初始化 + 完整关停 + preflight check |
| `src/cabinet/core/audit.py` | close() 时序修复 |
| `src/cabinet/rooms/decision/service.py` | LLM 异常保护 + delegate 日志 |
| `src/cabinet/rooms/secretary/service.py` | LLM 异常保护 |
| `src/cabinet/rooms/meeting/service.py` | LLM 异常保护 |
| `src/cabinet/rooms/strategy/service.py` | LLM 异常保护 |
| `src/cabinet/rooms/summary/service.py` | LLM 异常保护 |
| `src/cabinet/rooms/office/service.py` | LLM 异常保护 |
| `src/cabinet/core/events/sqlite_store.py` | 接收 SharedConnectionManager |
| `src/cabinet/core/events/sqlite_room_store.py` | 接收 SharedConnectionManager + executemany |
| `src/cabinet/core/memory/sqlite_store.py` | 接收 SharedConnectionManager |
| `src/cabinet/core/audit.py` | 接收 SharedConnectionManager |
| `src/cabinet/core/workflow/dead_letter_queue.py` | 接收 SharedConnectionManager |
| `src/cabinet/cli/config.py` | MCPServerConfig + 友好错误 |
| `src/cabinet/cli/main.py` | serve 信号处理 + status --preflight |

---

## Phase T1: Test Completion

### Task 1: API Routes — Agents Test Coverage

**Files:**
- Create: `tests/unit/api/test_agents_routes.py`
- Reference: `src/cabinet/api/routes/agents.py`

- [ ] **Step 1: Write the failing test for agent pool status**

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest


@pytest.fixture
def mock_runtime():
    runtime = MagicMock()
    runtime.agent_pool = MagicMock()
    runtime.agent_pool.health_check = AsyncMock(return_value={
        "total": 3, "idle": 2, "busy": 1, "by_role": {"executor": 3},
    })
    runtime.capability_registry = MagicMock()
    runtime.capability_registry.discover = AsyncMock(return_value=[])
    runtime.handoff_manager = MagicMock()
    runtime.handoff_manager.request_handoff = AsyncMock(return_value=None)
    runtime.mailbox_router = MagicMock()
    runtime.mailbox_router.get_mailbox = MagicMock(return_value=None)
    return runtime


@pytest.fixture
def mock_config():
    config = MagicMock()
    config.cors_origins = ["*"]
    config.api_token = ""
    return config


@pytest.fixture
def app(mock_runtime, mock_config):
    from cabinet.api.app import create_app
    return create_app(mock_runtime, mock_config)


@pytest.fixture
def client(app):
    from httpx import ASGITransport, AsyncClient
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_agent_pool_status(client):
    response = await client.get("/api/agents/pool/status")
    assert response.status_code == 200
    data = response.json()
    assert "total" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/api/test_agents_routes.py::test_agent_pool_status -v`
Expected: FAIL (file does not exist)

- [ ] **Step 3: Create the test file with full coverage**

Create `tests/unit/api/test_agents_routes.py` with tests for all 4 endpoints:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest


@pytest.fixture
def mock_runtime():
    runtime = MagicMock()
    runtime.agent_pool = MagicMock()
    runtime.agent_pool.health_check = AsyncMock(return_value={
        "total": 3, "idle": 2, "busy": 1, "by_role": {"executor": 3},
    })
    runtime.capability_registry = MagicMock()
    runtime.capability_registry.discover = AsyncMock(return_value=[])
    runtime.handoff_manager = MagicMock()
    runtime.handoff_manager.request_handoff = AsyncMock(return_value=None)
    runtime.mailbox_router = MagicMock()
    runtime.mailbox_router.get_mailbox = MagicMock(return_value=None)
    return runtime


@pytest.fixture
def mock_config():
    config = MagicMock()
    config.cors_origins = ["*"]
    config.api_token = ""
    return config


@pytest.fixture
def app(mock_runtime, mock_config):
    from cabinet.api.app import create_app
    return create_app(mock_runtime, mock_config)


@pytest.fixture
def client(app):
    from httpx import ASGITransport, AsyncClient
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_agent_pool_status(client):
    response = await client.get("/api/agents/pool/status")
    assert response.status_code == 200
    data = response.json()
    assert "total" in data


async def test_agent_discover(client, mock_runtime):
    response = await client.post("/api/agents/discover", json={"role": "executor"})
    assert response.status_code == 200
    data = response.json()
    assert "agents" in data
    mock_runtime.capability_registry.discover.assert_awaited_once()


async def test_agent_compose_team(client, mock_runtime):
    mock_runtime.capability_registry.discover = AsyncMock(return_value=[])
    response = await client.post("/api/agents/compose-team", json={
        "task": "analyze data", "required_roles": ["executor"],
    })
    assert response.status_code == 200


async def test_agent_handoff_invalid_uuid(client):
    response = await client.post("/api/agents/handoff", json={
        "from_agent_id": "not-a-uuid",
        "to_agent_id": str(uuid4()),
        "task_description": "test",
    })
    assert response.status_code == 400


async def test_agent_mailbox_status(client, mock_runtime):
    agent_id = str(uuid4())
    response = await client.get(f"/api/agents/mailbox/{agent_id}")
    assert response.status_code == 200
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/api/test_agents_routes.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/api/test_agents_routes.py
git commit -m "test: add API route tests for agents endpoints"
```

---

### Task 2: API Routes — Workflows Test Coverage

**Files:**
- Create: `tests/unit/api/test_workflows_routes.py`
- Reference: `src/cabinet/api/routes/workflows.py`

- [ ] **Step 1: Write the failing test**

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest


@pytest.fixture
def mock_runtime():
    runtime = MagicMock()
    runtime.office = MagicMock()
    runtime.office.execute_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "completed", "results": {}}),
    ))
    runtime.office.resume_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "completed"}),
    ))
    runtime.office.cancel_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "cancelled"}),
    ))
    runtime.office._executions = {}
    return runtime


@pytest.fixture
def mock_config():
    config = MagicMock()
    config.cors_origins = ["*"]
    config.api_token = ""
    return config


@pytest.fixture
def app(mock_runtime, mock_config):
    from cabinet.api.app import create_app
    return create_app(mock_runtime, mock_config)


@pytest.fixture
def client(app):
    from httpx import ASGITransport, AsyncClient
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_execute_workflow(client):
    response = await client.post("/api/workflows/execute", json={
        "workflow_id": str(uuid4()), "inputs": {},
    })
    assert response.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/api/test_workflows_routes.py::test_execute_workflow -v`
Expected: FAIL (file does not exist)

- [ ] **Step 3: Create the test file with full coverage**

Create `tests/unit/api/test_workflows_routes.py`:

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest


@pytest.fixture
def mock_runtime():
    runtime = MagicMock()
    runtime.office = MagicMock()
    runtime.office.execute_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "completed", "results": {}}),
    ))
    runtime.office.resume_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "completed"}),
    ))
    runtime.office.cancel_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "cancelled"}),
    ))
    runtime.office._executions = {}
    return runtime


@pytest.fixture
def mock_config():
    config = MagicMock()
    config.cors_origins = ["*"]
    config.api_token = ""
    return config


@pytest.fixture
def app(mock_runtime, mock_config):
    from cabinet.api.app import create_app
    return create_app(mock_runtime, mock_config)


@pytest.fixture
def client(app):
    from httpx import ASGITransport, AsyncClient
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_execute_workflow(client):
    response = await client.post("/api/workflows/execute", json={
        "workflow_id": str(uuid4()), "inputs": {},
    })
    assert response.status_code == 200


async def test_resume_workflow(client, mock_runtime):
    exec_id = uuid4()
    response = await client.post(f"/api/workflows/{exec_id}/resume", json={
        "decision_result": {"approved": True},
    })
    assert response.status_code == 200
    mock_runtime.office.resume_workflow.assert_awaited_once()


async def test_cancel_workflow(client, mock_runtime):
    exec_id = uuid4()
    response = await client.post(f"/api/workflows/{exec_id}/cancel", json={
        "reason": "no longer needed",
    })
    assert response.status_code == 200
    mock_runtime.office.cancel_workflow.assert_awaited_once()


async def test_get_workflow_execution_not_found(client, mock_runtime):
    exec_id = uuid4()
    response = await client.get(f"/api/workflows/{exec_id}")
    assert response.status_code == 404
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/api/test_workflows_routes.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/api/test_workflows_routes.py
git commit -m "test: add API route tests for workflows endpoints"
```

---

### Task 3: Agent Context Model Test Coverage

**Files:**
- Create: `tests/unit/agents/test_context.py`
- Reference: `src/cabinet/agents/context.py`

- [ ] **Step 1: Write the failing test**

```python
from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from cabinet.agents.context import AgentContext, AgentOutput, SkillContext, SkillOutput, TeamContext, TeamOutput


def test_agent_context_defaults():
    ctx = AgentContext()
    assert ctx.model == "default"
    assert ctx.temperature == 0.7
    assert ctx.max_tokens is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/agents/test_context.py -v`
Expected: FAIL (file does not exist)

- [ ] **Step 3: Create the test file with full coverage**

Create `tests/unit/agents/test_context.py`:

```python
from __future__ import annotations

from uuid import uuid4

import pytest
from pydantic import ValidationError

from cabinet.agents.context import AgentContext, AgentOutput, SkillContext, SkillOutput, TeamContext, TeamOutput


def test_agent_context_defaults():
    ctx = AgentContext()
    assert ctx.model == "default"
    assert ctx.temperature == 0.7
    assert ctx.max_tokens is None


def test_agent_context_custom():
    ctx = AgentContext(model="gpt-4", temperature=0.3, max_tokens=1000)
    assert ctx.model == "gpt-4"
    assert ctx.temperature == 0.3
    assert ctx.max_tokens == 1000


def test_agent_output_required_fields():
    emp_id = uuid4()
    out = AgentOutput(content="hello", employee_id=emp_id)
    assert out.content == "hello"
    assert out.employee_id == emp_id
    assert out.status == "completed"
    assert out.structured_data is None
    assert out.artifacts == []
    assert out.token_usage is None
    assert out.duration_ms is None


def test_agent_output_missing_content():
    with pytest.raises(ValidationError):
        AgentOutput(employee_id=uuid4())


def test_skill_context_defaults():
    ctx = SkillContext()
    assert ctx.model == "default"
    assert ctx.temperature == 0.7


def test_skill_output_required_fields():
    skill_id = uuid4()
    out = SkillOutput(content="result", skill_id=skill_id)
    assert out.content == "result"
    assert out.skill_id == skill_id


def test_team_context_defaults():
    ctx = TeamContext()
    assert ctx.model == "default"


def test_team_output_required_fields():
    team_id = uuid4()
    out = TeamOutput(content="team result", team_id=team_id)
    assert out.content == "team result"
    assert out.team_id == team_id


def test_agent_output_serialization():
    emp_id = uuid4()
    out = AgentOutput(content="test", employee_id=emp_id, token_usage={"prompt": 10})
    data = out.model_dump()
    assert data["content"] == "test"
    assert data["token_usage"] == {"prompt": 10}
    restored = AgentOutput.model_validate(data)
    assert restored.content == "test"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/agents/test_context.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/agents/test_context.py
git commit -m "test: add agent context model validation tests"
```

---

### Task 4: Shared Fixture Extraction & Pytest Markers

**Files:**
- Modify: `tests/conftest.py`
- Create: `tests/unit/api/conftest.py`
- Create: `tests/unit/core/conftest.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: Write the failing test for marker**

在 `pyproject.toml` 中添加 markers 配置：

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
markers = [
    "unit: fast unit tests",
    "integration: tests requiring database/files",
    "slow: tests taking more than 1 second",
]
```

- [ ] **Step 2: Create API shared conftest**

Create `tests/unit/api/conftest.py`，提取 API 测试共享 fixture：

```python
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def mock_config():
    config = MagicMock()
    config.cors_origins = ["*"]
    config.api_token = ""
    return config


@pytest.fixture
def mock_runtime():
    runtime = MagicMock()
    runtime.health_check = AsyncMock(return_value={
        "status": "healthy", "version": "0.1.0", "components": [], "uptime_seconds": 1.0,
    })
    runtime.agent_pool = MagicMock()
    runtime.agent_pool.health_check = AsyncMock(return_value={"total": 0})
    runtime.capability_registry = MagicMock()
    runtime.capability_registry.discover = AsyncMock(return_value=[])
    runtime.handoff_manager = MagicMock()
    runtime.handoff_manager.request_handoff = AsyncMock(return_value=None)
    runtime.mailbox_router = MagicMock()
    runtime.mailbox_router.get_mailbox = MagicMock(return_value=None)
    runtime.office = MagicMock()
    runtime.office.execute_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "completed"}),
    ))
    runtime.office.resume_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "completed"}),
    ))
    runtime.office.cancel_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "cancelled"}),
    ))
    runtime.office._executions = {}
    return runtime


@pytest.fixture
def app(mock_runtime, mock_config):
    from cabinet.api.app import create_app
    return create_app(mock_runtime, mock_config)


@pytest.fixture
def client(app):
    from httpx import ASGITransport, AsyncClient
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
```

- [ ] **Step 3: Create Core shared conftest**

Create `tests/unit/core/conftest.py`：

```python
from __future__ import annotations

import pytest


@pytest.fixture
def tmp_db(tmp_path):
    return str(tmp_path / "test.db")
```

- [ ] **Step 4: Remove duplicate fixtures from existing API test files**

从 `tests/unit/api/test_health.py`、`tests/unit/api/test_skills.py`、`tests/unit/api/test_chat.py`、`tests/unit/api/test_rooms.py`、`tests/unit/api/test_knowledge.py`、`tests/unit/api/test_employees.py`、`tests/unit/api/test_config.py` 中移除与 `conftest.py` 重复的 `mock_runtime`、`mock_config`、`app`、`client` fixture 定义。

- [ ] **Step 5: Run all API tests to verify no regressions**

Run: `pytest tests/unit/api/ -v`
Expected: All PASS

- [ ] **Step 6: Commit**

```bash
git add tests/conftest.py tests/unit/api/conftest.py tests/unit/core/conftest.py pyproject.toml tests/unit/api/test_health.py tests/unit/api/test_skills.py tests/unit/api/test_chat.py tests/unit/api/test_rooms.py tests/unit/api/test_knowledge.py tests/unit/api/test_employees.py tests/unit/api/test_config.py
git commit -m "refactor: extract shared fixtures to conftest, add pytest markers"
```

---

### Task 5: CI Coverage Threshold Update

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Update CI coverage threshold**

在 `.github/workflows/ci.yml` 中将 `--cov-fail-under=60` 改为 `--cov-fail-under=75`。

- [ ] **Step 2: Run full test suite with new threshold locally**

Run: `pytest tests/ -v --cov=cabinet --cov-fail-under=75`
Expected: PASS (with all new tests added in Tasks 1-3)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: raise coverage threshold from 60% to 75%"
```

---

## Phase T2: Robustness Hardening

### Task 6: P0 Fix — DeadLetterQueue close() & Runtime Connection Cleanup

**Files:**
- Modify: `src/cabinet/core/workflow/dead_letter_queue.py`
- Modify: `src/cabinet/runtime.py`
- Test: `tests/unit/core/workflow/test_dead_letter_queue.py`

- [ ] **Step 1: Write the failing test**

在 `tests/unit/core/workflow/test_dead_letter_queue.py` 中添加：

```python
@pytest.mark.asyncio
async def test_dlq_close_closes_connection(tmp_path):
    import aiosqlite
    db_path = str(tmp_path / "test.db")
    db = await aiosqlite.connect(db_path)
    await db.execute("""
        CREATE TABLE IF NOT EXISTS dead_letter_queue (
            id TEXT PRIMARY KEY, event_type TEXT, source TEXT,
            payload TEXT, error TEXT, retry_count INTEGER DEFAULT 0,
            created_at TEXT, last_retry_at TEXT
        )
    """)
    await db.commit()
    from cabinet.core.workflow.dead_letter_queue import DeadLetterQueue
    dlq = DeadLetterQueue(db)
    await dlq.close()
    with pytest.raises(Exception):
        await db.execute("SELECT 1")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/core/workflow/test_dead_letter_queue.py::test_dlq_close_closes_connection -v`
Expected: FAIL (DeadLetterQueue has no close method)

- [ ] **Step 3: Add close() method to DeadLetterQueue**

在 `src/cabinet/core/workflow/dead_letter_queue.py` 末尾添加：

```python
    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None
```

- [ ] **Step 4: Update runtime.stop() to close DLQ connection**

在 `src/cabinet/runtime.py` 的 `stop()` 方法中，在 `await self._wiring.unregister_all()` 之后添加：

```python
        if self._dead_letter_queue is not None:
            await self._dead_letter_queue.close()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/unit/core/workflow/test_dead_letter_queue.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/core/workflow/dead_letter_queue.py src/cabinet/runtime.py tests/unit/core/workflow/test_dead_letter_queue.py
git commit -m "fix: add close() to DeadLetterQueue, close DLQ connection in runtime.stop()"
```

---

### Task 7: P0 Fix — Stream LLM Error Metrics Misreporting

**Files:**
- Modify: `src/cabinet/core/gateway/litellm_adapter.py`
- Test: `tests/unit/core/gateway/test_litellm_adapter.py`

- [ ] **Step 1: Write the failing test**

在 `tests/unit/core/gateway/test_litellm_adapter.py` 中添加：

```python
@pytest.mark.asyncio
async def test_stream_records_error_on_exception():
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    from unittest.mock import AsyncMock, MagicMock, patch

    gateway = LiteLLMRouterGateway(model_list=[{
        "model_name": "test",
        "litellm_params": {"model": "openai/test"},
    }])

    mock_response = AsyncMock()
    mock_response.__aiter__ = MagicMock(return_value=iter([]))
    mock_response.__anext__ = AsyncMock(side_effect=RuntimeError("stream error"))

    with patch.object(gateway._router, "acompletion", return_value=mock_response):
        with pytest.raises(RuntimeError, match="stream error"):
            chunks = []
            async for chunk in gateway.stream([], "test"):
                chunks.append(chunk)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/core/gateway/test_litellm_adapter.py::test_stream_records_error_on_exception -v`
Expected: FAIL (stream() doesn't propagate exceptions correctly)

- [ ] **Step 3: Fix stream() method**

将 `src/cabinet/core/gateway/litellm_adapter.py` 的 `stream()` 方法替换为：

```python
    async def stream(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> AsyncIterator[ModelChunk]:
        logger.debug("LLM stream start: model=%s", model)
        start = time.monotonic()
        chunk_count = 0
        span = None
        status = "success"
        if _OBSERVABILITY_ENABLED:
            span = _tracer.start_span("llm.stream")
            span.set_attribute("llm.model", model)
        try:
            async for chunk in await self._router.acompletion(
                model=model,
                messages=messages,
                temperature=temperature,
                stream=True,
                **kwargs,
            ):
                if chunk.choices:
                    delta = chunk.choices[0].delta
                    if delta.content:
                        chunk_count += 1
                        yield ModelChunk(content=delta.content, model=model)
        except Exception as e:
            status = "error"
            if _OBSERVABILITY_ENABLED and span:
                span.set_attribute("error", True)
                span.set_attribute("error.message", str(e))
            raise
        finally:
            if _OBSERVABILITY_ENABLED:
                duration = time.monotonic() - start
                LLM_CALL_COUNT.labels(model=model, status=status).inc()
                LLM_CALL_LATENCY.labels(model=model).observe(duration)
                if span:
                    span.set_attribute("llm.chunks.count", chunk_count)
            if span:
                span.end()
```

关键变更：
1. 添加 `status = "success"` 变量
2. 添加 `except` 块设置 `status = "error"` 并 re-raise
3. `finally` 中使用 `status` 变量而非硬编码 `"success"`
4. 防护 `chunk.choices` 为空列表
5. 日志级别从 INFO 改为 DEBUG

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/gateway/test_litellm_adapter.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/gateway/litellm_adapter.py tests/unit/core/gateway/test_litellm_adapter.py
git commit -m "fix: stream() error metrics misreporting and empty choices guard"
```

---

### Task 8: P0 Fix — Runtime Transactional Init & Graceful Shutdown

**Files:**
- Modify: `src/cabinet/runtime.py`
- Modify: `src/cabinet/core/audit.py`
- Test: `tests/unit/test_runtime.py`

- [ ] **Step 1: Write the failing test**

在 `tests/unit/test_runtime.py` 中添加：

```python
@pytest.mark.asyncio
async def test_runtime_stop_cancels_backup_task():
    from cabinet.runtime import CabinetRuntime
    from cabinet.agents.stub_factory import StubAgentFactory
    import tempfile, os

    with tempfile.TemporaryDirectory() as tmp:
        db_path = os.path.join(tmp, "db", "cabinet.db")
        os.makedirs(os.path.dirname(db_path))
        runtime = CabinetRuntime(
            agent_factory=StubAgentFactory(),
            db_path=db_path,
        )
        await runtime.start()
        assert runtime._backup_task is not None
        assert not runtime._backup_task.done()
        await runtime.stop()
        assert runtime._backup_task.done()


@pytest.mark.asyncio
async def test_runtime_start_rollback_on_failure():
    from cabinet.runtime import CabinetRuntime
    from cabinet.agents.stub_factory import StubAgentFactory

    runtime = CabinetRuntime(
        agent_factory=StubAgentFactory(),
        db_path=None,
    )
    runtime._db_path = "/nonexistent/path/db.db"
    with pytest.raises(Exception):
        await runtime.start()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_runtime.py::test_runtime_stop_cancels_backup_task -v`
Expected: FAIL (backup task not cancelled in stop)

- [ ] **Step 3: Fix runtime.stop() for complete resource cleanup**

将 `src/cabinet/runtime.py` 的 `stop()` 方法替换为：

```python
    async def stop(self) -> None:
        logger.info("CabinetRuntime stopping")
        if self._audit_store is not None:
            await self._audit_store.log(AuditEvent(
                action="runtime.stop", actor="system", resource_type="runtime", resource_id="cabinet",
            ))
        if self._backup_task is not None:
            self._backup_task.cancel()
            try:
                await self._backup_task
            except asyncio.CancelledError:
                pass
            self._backup_task = None
        await self._wiring.unregister_all()
        if self._dead_letter_queue is not None:
            await self._dead_letter_queue.close()
            self._dead_letter_queue = None
        if self._mcp_connector is not None:
            await self._mcp_connector.disconnect_all()
        if self._memory_store is not None:
            await self._memory_store.close()
        if self._db_path:
            for store in self._room_stores:
                await store.close()
            await self._event_store.close()
        if self._audit_store is not None:
            await self._audit_store.close()
        logger.info("CabinetRuntime stopped")
```

- [ ] **Step 4: Add _rollback_init() method**

在 `src/cabinet/runtime.py` 的 `CabinetRuntime` 类中添加：

```python
    async def _rollback_init(self) -> None:
        logger.warning("CabinetRuntime init failed, rolling back")
        if self._backup_task is not None:
            self._backup_task.cancel()
        if self._audit_store is not None:
            try:
                await self._audit_store.close()
            except Exception:
                pass
        if self._dead_letter_queue is not None:
            try:
                await self._dead_letter_queue.close()
            except Exception:
                pass
        try:
            await self._wiring.unregister_all()
        except Exception:
            pass
        if self._db_path:
            for store in self._room_stores:
                try:
                    await store.close()
                except Exception:
                    pass
            try:
                await self._event_store.close()
            except Exception:
                pass
```

- [ ] **Step 5: Wrap start() in try/except with rollback**

将 `src/cabinet/runtime.py` 的 `start()` 方法体包裹在 try/except 中：

```python
    async def start(self) -> None:
        logger.info("CabinetRuntime starting")
        try:
            # ... existing start() body unchanged ...
            logger.info("CabinetRuntime started successfully")
        except Exception:
            await self._rollback_init()
            raise
```

- [ ] **Step 6: Fix AuditStore.close() timing**

将 `src/cabinet/core/audit.py` 的 `close()` 方法替换为：

```python
    async def close(self) -> None:
        await self._flush_buffer()
        if self._flush_task is not None:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
        if self._db is not None:
            await self._db.close()
            self._db = None
```

关键变更：先 flush buffer 再 cancel task，确保数据不丢失。

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/unit/test_runtime.py -v`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add src/cabinet/runtime.py src/cabinet/core/audit.py tests/unit/test_runtime.py
git commit -m "fix: runtime transactional init with rollback, graceful shutdown, audit close timing"
```

---

### Task 9: P1 Fix — Room Service LLM Exception Protection

**Files:**
- Modify: `src/cabinet/rooms/decision/service.py`
- Modify: `src/cabinet/rooms/secretary/service.py`
- Modify: `src/cabinet/rooms/meeting/service.py`
- Modify: `src/cabinet/rooms/strategy/service.py`
- Modify: `src/cabinet/rooms/summary/service.py`
- Modify: `src/cabinet/rooms/office/service.py`
- Test: corresponding test files

- [ ] **Step 1: Add LLM error handling to Secretary greet()**

在 `src/cabinet/rooms/secretary/service.py` 的 `greet()` 方法中，将 LLM 调用包裹在 try/except 中：

```python
    async def greet(self, captain_id: str) -> Greeting:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="secretary", operation="greet").inc()
        memory_context = ""
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope

            items = await self._memory_store.search(
                captain_id,
                MemoryScope.LONG_TERM,
                limit=3,
            )
            memory_context = "\n".join(item.content for item in items)

        try:
            agent = await self._agent_factory.create_agent(uuid4(), "secretary")
            context = AgentContext(model="default", temperature=0.7)
            prompt = f"Generate a greeting for Captain {captain_id}."
            if memory_context:
                prompt += f"\n\nCaptain's preferences and history:\n{memory_context}"
            prompt += " Include a brief summary of what you can help with today."
            output = await agent.execute(prompt, context)
            greeting_text = output.content
        except Exception as exc:
            logger.exception("LLM call failed in secretary greet: %s", exc)
            greeting_text = f"Welcome back, Captain {captain_id}. How can I assist you today?"

        event = CaptainGreeted(captain_id=captain_id, greeting_text=greeting_text)
        await self._publish_and_apply(event)
        return Greeting(
            captain_id=captain_id,
            message=greeting_text,
            auto_processed_summary="",
            today_highlights=[],
        )
```

- [ ] **Step 2: Add LLM error handling to Secretary process_input()**

在 `src/cabinet/rooms/secretary/service.py` 的 `process_input()` 方法中，将 LLM 调用包裹在 try/except 中。在 `agent = await self._agent_factory.create_agent(...)` 和 `output = await agent.execute(...)` 周围添加：

```python
        try:
            agent = await self._agent_factory.create_agent(uuid4(), "secretary")
            agent_context = AgentContext(model="default", temperature=0.7)
            # ... existing prompt construction ...
            output = await agent.execute(prompt, agent_context)
            response_text = output.content
        except Exception as exc:
            logger.exception("LLM call failed in secretary process_input: %s", exc)
            response_text = "I encountered an error processing your request. Please try again."
```

然后用 `response_text` 替换后续代码中的 `output.content`。

- [ ] **Step 3: Add LLM error handling to Decision submit()**

在 `src/cabinet/rooms/decision/service.py` 的 `submit()` 方法中：

```python
    async def submit(self, request: DecisionRequest) -> Decision:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="decision", operation="submit").inc()
        description = request.options if isinstance(request.options, str) else str(request.options)
        try:
            agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
            context = AgentContext(model="default", temperature=0.3)
            output = await agent.execute(
                f"Analyze this decision request and provide an enriched description.\n\n"
                f"Title: {request.title}\n"
                f"Type: {request.decision_type}\n"
                f"Options: {request.options}\n\n"
                f"Provide a detailed description of this decision, its implications, and urgency.",
                context,
            )
            description = output.content
        except Exception as exc:
            logger.exception("LLM call failed in decision submit: %s", exc)
```

- [ ] **Step 4: Fix Decision delegate() silent exception swallowing**

在 `src/cabinet/rooms/decision/service.py` 的 `delegate()` 方法中，将 `except (ValueError, Exception): pass` 替换为：

```python
            except Exception as exc:
                logger.exception("Handoff failed in decision delegate: %s", exc)
```

- [ ] **Step 5: Add LLM error handling to Meeting add_perspective()**

在 `src/cabinet/rooms/meeting/service.py` 的 `add_perspective()` 方法中，将 LLM 调用包裹在 try/except 中：

```python
        if content is None:
            try:
                agent = await self._agent_factory.create_agent(agent_id, "advisor")
                session = self._sessions[session_id]
                context = AgentContext(model="default", temperature=0.8)
                output = await agent.execute(
                    f"Analyze the following topic from your perspective:\n\n"
                    f"Topic: {session.topic}\n"
                    f"Meeting Level: {session.level}\n\n"
                    f"Provide your analysis, considering risks, opportunities, and trade-offs.",
                    context,
                )
                content = output.content
            except Exception as exc:
                logger.exception("LLM call failed in meeting add_perspective: %s", exc)
                content = f"[Error generating perspective: {exc}]"
```

- [ ] **Step 6: Add LLM error handling to Strategy decode()**

在 `src/cabinet/rooms/strategy/service.py` 的 `decode()` 方法中，将 LLM 调用包裹在 try/except 中：

```python
        try:
            agent = await self._agent_factory.create_agent(uuid4(), "strategist")
            agent_context = AgentContext(model="default", temperature=0.5)
            output = await agent.execute(
                # ... existing prompt ...
                agent_context,
            )
            action_domains, constraints, success_criteria = self._parse_blueprint_output(output.content)
        except Exception as exc:
            logger.exception("LLM call failed in strategy decode: %s", exc)
            action_domains = ["primary"]
            constraints = ["budget"]
            success_criteria = ["revenue increase"]
```

- [ ] **Step 7: Add LLM error handling to Summary generate_insights()**

在 `src/cabinet/rooms/summary/service.py` 的 `generate_insights()` 方法中：

```python
        try:
            agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
            context = AgentContext(model="default", temperature=0.7)
            output = await agent.execute(
                # ... existing prompt ...
                context,
            )
            insights = self._parse_insights_output(output.content, session_id)
        except Exception as exc:
            logger.exception("LLM call failed in summary generate_insights: %s", exc)
            insights = [Insight(
                session_id=session_id, insight_type="error",
                content=f"Failed to generate insights: {exc}",
                confidence=0.0, auto_applicable=False, requires_captain=True,
            )]
```

- [ ] **Step 8: Add LLM error handling to Office execute_workflow() fallback branch**

在 `src/cabinet/rooms/office/service.py` 的 `execute_workflow()` 方法中，将 fallback LLM 分支（L306-L312）包裹在 try/except 中：

```python
        try:
            agent = await self._agent_factory.create_agent(uuid4(), "executor")
            context = AgentContext(model="default", temperature=0.3)
            output = await agent.execute(
                f"Execute workflow {workflow_id} with inputs: {inputs}\n\n"
                f"Describe the execution plan and first step results.",
                context,
            )
        except Exception as exc:
            logger.exception("LLM call failed in office execute_workflow fallback: %s", exc)
            from cabinet.models.workflows import WorkflowFailed
            fail_event = WorkflowFailed(
                execution_id=execution_id, error_message=str(exc), retry_count=0,
            )
            await self._publish_and_apply(fail_event)
            return self._executions[execution_id]
```

- [ ] **Step 9: Run all room tests**

Run: `pytest tests/unit/rooms/ -v`
Expected: All PASS

- [ ] **Step 10: Commit**

```bash
git add src/cabinet/rooms/decision/service.py src/cabinet/rooms/secretary/service.py src/cabinet/rooms/meeting/service.py src/cabinet/rooms/strategy/service.py src/cabinet/rooms/summary/service.py src/cabinet/rooms/office/service.py
git commit -m "fix: add LLM exception protection to all room services with graceful degradation"
```

---

### Task 10: P1 Fix — Event Bus Concurrent Handlers & Persistence Decoupling

**Files:**
- Modify: `src/cabinet/core/events/asyncio_bus.py`
- Test: `tests/unit/core/events/test_asyncio_bus.py`

- [ ] **Step 1: Write the failing test**

在 `tests/unit/core/events/test_asyncio_bus.py` 中添加：

```python
@pytest.mark.asyncio
async def test_publish_concurrent_handlers():
    from cabinet.core.events.asyncio_bus import AsyncIOEventBus
    from cabinet.models.events import MessageEnvelope
    from uuid import uuid4
    from datetime import datetime, timezone

    bus = AsyncIOEventBus()
    results = []

    async def handler_a(envelope):
        results.append("a")

    async def handler_b(envelope):
        results.append("b")

    await bus.subscribe("test.event", handler_a)
    await bus.subscribe("test.event", handler_b)

    envelope = MessageEnvelope(
        message_id=uuid4(), correlation_id=uuid4(), causation_id=uuid4(),
        sender="test", recipients=[], message_type="test.event",
        timestamp=datetime.now(timezone.utc), status="new", payload={},
    )
    await bus.publish(envelope)
    assert "a" in results
    assert "b" in results


@pytest.mark.asyncio
async def test_publish_continues_if_handler_fails():
    from cabinet.core.events.asyncio_bus import AsyncIOEventBus
    from cabinet.models.events import MessageEnvelope
    from uuid import uuid4
    from datetime import datetime, timezone

    bus = AsyncIOEventBus()
    results = []

    async def bad_handler(envelope):
        raise RuntimeError("boom")

    async def good_handler(envelope):
        results.append("good")

    await bus.subscribe("test.event", bad_handler)
    await bus.subscribe("test.event", good_handler)

    envelope = MessageEnvelope(
        message_id=uuid4(), correlation_id=uuid4(), causation_id=uuid4(),
        sender="test", recipients=[], message_type="test.event",
        timestamp=datetime.now(timezone.utc), status="new", payload={},
    )
    await bus.publish(envelope)
    assert "good" in results
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/core/events/test_asyncio_bus.py::test_publish_continues_if_handler_fails -v`
Expected: FAIL (current serial execution stops at bad_handler)

- [ ] **Step 3: Rewrite publish() with concurrent handlers and decoupled persistence**

将 `src/cabinet/core/events/asyncio_bus.py` 的 `publish()` 方法替换为：

```python
    async def publish(self, envelope: MessageEnvelope) -> None:
        if _OBSERVABILITY_ENABLED:
            EVENT_PUBLISHED.labels(message_type=envelope.message_type).inc()
        span = None
        if _OBSERVABILITY_ENABLED:
            span = _tracer.start_span("eventbus.publish")
            span.set_attribute("event.type", envelope.message_type)
            span.set_attribute("event.source", envelope.sender)
        try:
            handlers = self._handlers.get(envelope.message_type, [])
            if handlers:
                tasks = [self._invoke_handler(h, envelope) for h in handlers]
                await asyncio.gather(*tasks, return_exceptions=True)
            if self._store is not None:
                try:
                    await self._store.append(envelope)
                except Exception as exc:
                    logger.warning("Event persistence failed for %s: %s", envelope.message_type, exc)
        finally:
            if span:
                span.end()

    async def _invoke_handler(self, handler, envelope: MessageEnvelope) -> None:
        try:
            await asyncio.wait_for(handler(envelope), timeout=30.0)
        except asyncio.TimeoutError:
            logger.warning("Handler %s timed out for %s", handler.__name__, envelope.message_type)
            if self._dlq is not None:
                await self._dlq.enqueue(
                    event_type="handler.timeout",
                    source=f"eventbus:{envelope.message_type}",
                    payload={"message_id": str(envelope.message_id), "handler": handler.__name__},
                    error="timeout after 30s",
                )
        except Exception as exc:
            logger.exception("Handler %s failed for %s: %s", handler.__name__, envelope.message_type, exc)
            if self._dlq is not None:
                await self._dlq.enqueue(
                    event_type="handler.error",
                    source=f"eventbus:{envelope.message_type}",
                    payload={"message_id": str(envelope.message_id), "sender": envelope.sender},
                    error=str(exc),
                )
```

同时在文件顶部添加 `import asyncio`。

关键变更：
1. handler 并发执行（`asyncio.gather`）
2. 每个 handler 有 30 秒超时
3. 先分发事件给 handler，再持久化
4. 持久化失败只记录 warning，不阻断
5. handler 失败使用 `logger.exception` 记录完整堆栈

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/events/test_asyncio_bus.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/events/asyncio_bus.py tests/unit/core/events/test_asyncio_bus.py
git commit -m "fix: event bus concurrent handlers with timeout, decoupled persistence"
```

---

### Task 11: Workflow Robustness — Condition Protection, Parallel DLQ, Global Timeout, Safe Eval

**Files:**
- Modify: `src/cabinet/core/workflow/engine.py`
- Create: `src/cabinet/core/workflow/safe_eval.py`
- Test: `tests/unit/core/workflow/test_engine.py`, `tests/unit/core/workflow/test_safe_eval.py`

- [ ] **Step 1: Create safe_eval.py**

Create `src/cabinet/core/workflow/safe_eval.py`：

```python
from __future__ import annotations

import ast
import operator

_SAFE_OPS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.And: lambda a, b: a and b,
    ast.Or: lambda a, b: a or b,
    ast.USub: operator.neg,
    ast.Not: operator.not_,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}


def safe_eval(expr: str, context_data: dict):
    try:
        tree = ast.parse(expr, mode="eval")
        return _eval_node(tree.body, context_data)
    except Exception:
        return None


def _eval_node(node, context_data):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        return context_data.get(node.id)
    if isinstance(node, ast.Attribute):
        value = _eval_node(node.value, context_data)
        if isinstance(value, dict):
            return value.get(node.attr)
        return getattr(value, node.attr, None)
    if isinstance(node, ast.Subscript):
        value = _eval_node(node.value, context_data)
        key = _eval_node(node.slice, context_data)
        if isinstance(value, (dict, list)):
            return value[key] if key is not None else None
        return None
    if isinstance(node, ast.BoolOp):
        if isinstance(node.op, ast.And):
            result = True
            for val in node.values:
                result = _eval_node(val, context_data)
                if not result:
                    return result
            return result
        else:
            result = False
            for val in node.values:
                result = _eval_node(val, context_data)
                if result:
                    return result
            return result
    if isinstance(node, ast.UnaryOp):
        operand = _eval_node(node.operand, context_data)
        op_func = _SAFE_OPS.get(type(node.op))
        if op_func:
            return op_func(operand)
        return None
    if isinstance(node, ast.Compare):
        left = _eval_node(node.left, context_data)
        for op, comparator in zip(node.ops, node.comparators):
            right = _eval_node(comparator, context_data)
            op_func = _SAFE_OPS.get(type(op))
            if op_func is None:
                return None
            if not op_func(left, right):
                return False
            left = right
        return True
    if isinstance(node, ast.BinOp):
        left = _eval_node(node.left, context_data)
        right = _eval_node(node.right, context_data)
        op_func = _SAFE_OPS.get(type(node.op))
        if op_func:
            return op_func(left, right)
        return None
    if isinstance(node, ast.List):
        return [_eval_node(e, context_data) for e in node.elts]
    if isinstance(node, ast.Tuple):
        return tuple(_eval_node(e, context_data) for e in node.elts)
    if isinstance(node, ast.IfExp):
        test = _eval_node(node.test, context_data)
        if test:
            return _eval_node(node.body, context_data)
        return _eval_node(node.orelse, context_data)
    if isinstance(node, ast.Call):
        return None
    return None
```

- [ ] **Step 2: Write safe_eval tests**

Create `tests/unit/core/workflow/test_safe_eval.py`：

```python
from cabinet.core.workflow.safe_eval import safe_eval


def test_safe_eval_arithmetic():
    assert safe_eval("1 + 2", {}) == 3
    assert safe_eval("10 / 3", {}) == 10 / 3


def test_safe_eval_comparison():
    assert safe_eval("x > 0", {"x": 1}) is True
    assert safe_eval("x < 0", {"x": 1}) is False


def test_safe_eval_logical():
    assert safe_eval("x > 0 and y > 0", {"x": 1, "y": 2}) is True
    assert safe_eval("x > 0 or y > 0", {"x": -1, "y": 2}) is True


def test_safe_eval_attribute_access():
    assert safe_eval("context.x", {"context": {"x": 42}}) == 42


def test_safe_eval_subscript():
    assert safe_eval("items[0]", {"items": [10, 20, 30]}) == 10


def test_safe_eval_rejects_function_call():
    assert safe_eval("open('/etc/passwd')", {}) is None


def test_safe_eval_rejects_import():
    assert safe_eval("__import__('os')", {}) is None


def test_safe_eval_invalid_syntax():
    assert safe_eval("!!!invalid", {}) is None


def test_safe_eval_in_operator():
    assert safe_eval("x in items", {"x": 1, "items": [1, 2, 3]}) is True
```

- [ ] **Step 3: Run safe_eval tests**

Run: `pytest tests/unit/core/workflow/test_safe_eval.py -v`
Expected: All PASS

- [ ] **Step 4: Update engine.py — replace eval() with safe_eval**

在 `src/cabinet/core/workflow/engine.py` 中：
1. 添加导入：`from cabinet.core.workflow.safe_eval import safe_eval`
2. 替换 `_eval_expr` 方法：

```python
    @staticmethod
    def _eval_expr(expr: str, context_data: dict):
        return safe_eval(expr, context_data)
```

- [ ] **Step 5: Add exception protection to _execute_condition()**

将 `_execute_condition()` 方法替换为：

```python
    async def _execute_condition(self, node: ConditionNode, context_data: dict) -> NodeResult:
        try:
            agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
            context = AgentContext(model="default", temperature=0.2)
            output = await agent.execute(
                f"Evaluate this condition expression: {node.expression}\n\n"
                f"Context: {context_data}\n\n"
                f"Respond with only TRUE or FALSE.",
                context,
            )
            is_true = "TRUE" in output.content.upper()[:20]
        except Exception as exc:
            logger.exception("Condition evaluation failed for %s: %s", node.id, exc)
            is_true = True
        next_id = node.true_next if is_true else node.false_next
        return NodeResult(node.id, {"condition_result": is_true}, next_node_id=next_id)
```

- [ ] **Step 6: Add DLQ push for _execute_parallel() failures**

将 `_execute_parallel()` 方法中的错误处理替换为：

```python
    async def _execute_parallel(
        self,
        node: ParallelNode,
        context_data: dict,
        node_map: dict[UUID, WorkflowNode],
        edge_map: dict[UUID, list[tuple[UUID, str | None]]],
        context: EngineContext,
    ) -> NodeResult:
        branch_results = {}
        tasks = []
        for branch_id in node.branch_node_ids:
            branch_node = node_map.get(branch_id)
            if branch_node is not None:
                tasks.append(self._execute_node(branch_node, context_data, node_map, edge_map, context))
        if tasks:
            completed = await asyncio.gather(*tasks, return_exceptions=True)
            for i, result in enumerate(completed):
                if isinstance(result, Exception):
                    branch_id = str(node.branch_node_ids[i])
                    branch_results[branch_id] = {"error": str(result)}
                    logger.error("Parallel branch %s failed: %s", branch_id, result)
                    if self._dead_letter_queue is not None:
                        await self._dead_letter_queue.enqueue(
                            event_type="parallel.branch_failed",
                            source=f"node:{node.id}:branch:{branch_id}",
                            error=str(result),
                        )
                else:
                    branch_results[str(result.node_id)] = result.output
        return NodeResult(node.id, branch_results)
```

- [ ] **Step 7: Add global timeout to run() method**

将 `run()` 方法添加超时参数：

```python
    async def run(
        self,
        workflow: Workflow,
        inputs: dict,
        on_node_completed: object | None = None,
        context: EngineContext | None = None,
        timeout_seconds: float = 1800.0,
    ) -> dict:
        node_map, edge_map = self._build_maps(workflow)
        trigger_nodes = [n for n in workflow.nodes if isinstance(n, TriggerNode)]
        if not trigger_nodes:
            raise ValueError("Workflow has no trigger node")

        start_id = trigger_nodes[0].id
        if context and context.resume_from:
            start_id = context.resume_from

        self._current_execution_id = context.execution_id if context else None

        try:
            graph_result = await asyncio.wait_for(
                self._execute_graph(
                    start_id, node_map, edge_map, dict(inputs), context or EngineContext(),
                    on_node_completed=on_node_completed,
                ),
                timeout=timeout_seconds,
            )
        except asyncio.TimeoutError:
            return {"__end__": {"status": "timeout", "timeout_seconds": timeout_seconds}}

        results = dict(graph_result.output)
        if graph_result.paused and graph_result.pause_info:
            results["__paused__"] = graph_result.pause_info
        if graph_result.completed:
            if "__end__" not in results:
                results["__end__"] = {"status": "completed"}

        return results
```

- [ ] **Step 8: Run all workflow tests**

Run: `pytest tests/unit/core/workflow/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/cabinet/core/workflow/safe_eval.py src/cabinet/core/workflow/engine.py tests/unit/core/workflow/test_safe_eval.py tests/unit/core/workflow/test_engine.py
git commit -m "fix: safe eval, condition protection, parallel DLQ, workflow global timeout"
```

---

### Task 12: API Server Signal Handling

**Files:**
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: Add signal handling to serve command**

将 `src/cabinet/cli/main.py` 的 `serve` 命令中的 `_create_and_serve()` 函数替换为：

```python
    async def _create_and_serve():
        runtime, config = await _init_runtime(data_dir)
        api_app = create_app(runtime, config)
        if config.observability.enabled:
            from prometheus_client import start_http_server
            start_http_server(config.observability.prometheus_port)
        uv_config = uvicorn.Config(api_app, host=host, port=port)
        server = uvicorn.Server(uv_config)

        import signal

        loop = asyncio.get_running_loop()

        def _signal_handler():
            server.should_exit = True

        for sig in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(sig, _signal_handler)

        try:
            await server.serve()
        finally:
            for sig in (signal.SIGINT, signal.SIGTERM):
                try:
                    loop.remove_signal_handler(sig)
                except Exception:
                    pass
            await runtime.stop()
```

- [ ] **Step 2: Run lint**

Run: `ruff check src/cabinet/cli/main.py`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat: add SIGINT/SIGTERM signal handling to serve command"
```

---

## Phase T3: Performance Optimization

### Task 13: SharedConnectionManager

**Files:**
- Create: `src/cabinet/core/db/connection_manager.py`
- Test: `tests/unit/core/test_connection_manager.py`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/core/test_connection_manager.py`：

```python
import pytest
import aiosqlite
import os


@pytest.mark.asyncio
async def test_shared_connection_manager_initialize(tmp_path):
    from cabinet.core.db.connection_manager import SharedConnectionManager

    db_path = str(tmp_path / "test.db")
    mgr = SharedConnectionManager(db_path)
    await mgr.initialize()
    assert mgr._conn is not None
    await mgr.close()


@pytest.mark.asyncio
async def test_shared_connection_manager_write_and_read(tmp_path):
    from cabinet.core.db.connection_manager import SharedConnectionManager

    db_path = str(tmp_path / "test.db")
    mgr = SharedConnectionManager(db_path)
    await mgr.initialize()
    await mgr.execute_write(
        "CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)"
    )
    await mgr.execute_write("INSERT INTO test (id, value) VALUES (?, ?)", (1, "hello"))
    rows = await mgr.execute_read("SELECT value FROM test WHERE id = ?", (1,))
    assert len(rows) == 1
    assert rows[0][0] == "hello"
    await mgr.close()


@pytest.mark.asyncio
async def test_shared_connection_manager_close(tmp_path):
    from cabinet.core.db.connection_manager import SharedConnectionManager

    db_path = str(tmp_path / "test.db")
    mgr = SharedConnectionManager(db_path)
    await mgr.initialize()
    await mgr.close()
    assert mgr._conn is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/core/test_connection_manager.py -v`
Expected: FAIL (module does not exist)

- [ ] **Step 3: Create SharedConnectionManager**

Create `src/cabinet/core/db/__init__.py` (empty) and `src/cabinet/core/db/connection_manager.py`：

```python
from __future__ import annotations

import asyncio
import logging

import aiosqlite

logger = logging.getLogger(__name__)


class SharedConnectionManager:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        self._write_lock = asyncio.Lock()

    async def initialize(self) -> None:
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA synchronous=NORMAL")
        await self._conn.commit()
        logger.info("SharedConnectionManager initialized: %s", self._db_path)

    async def execute_write(self, sql: str, params: tuple = ()) -> None:
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        async with self._write_lock:
            await self._conn.execute(sql, params)
            await self._conn.commit()

    async def execute_writemany(self, sql: str, params_seq: list[tuple]) -> None:
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        async with self._write_lock:
            await self._conn.executemany(sql, params_seq)
            await self._conn.commit()

    async def execute_read_one(self, sql: str, params: tuple = ()) -> list:
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        cursor = await self._conn.execute(sql, params)
        return await cursor.fetchall()

    async def execute_read_one(self, sql: str, params: tuple = ('):
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        cursor = await self._conn.execute(sql, params)
        return await cursor.fetchone()

    @property
    def connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        return self._conn

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
            logger.info("SharedConnectionManager closed")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/test_connection_manager.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/db/__init__.py src/cabinet/core/db/connection_manager.py tests/unit/core/test_connection_manager.py
git commit -m "feat: add SharedConnectionManager for SQLite connection pooling"
```

---

### Task 14: Migrate Components to SharedConnectionManager

**Files:**
- Modify: `src/cabinet/core/events/sqlite_store.py`
- Modify: `src/cabinet/core/events/sqlite_room_store.py`
- Modify: `src/cabinet/core/memory/sqlite_store.py`
- Modify: `src/cabinet/core/audit.py`
- Modify: `src/cabinet/core/workflow/dead_letter_queue.py`
- Modify: `src/cabinet/runtime.py`

- [ ] **Step 1: Update SqliteEventStore to accept SharedConnectionManager**

在 `src/cabinet/core/events/sqlite_store.py` 中，修改构造函数和 initialize 方法：

```python
class SqliteEventStore:
    def __init__(self, db_path: str = "data/db/cabinet.db", conn_manager: object | None = None):
        self._db_path = db_path
        self._conn_manager = conn_manager
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        if self._conn_manager is not None:
            self._db = self._conn_manager.connection
        else:
            self._db = await aiosqlite.connect(self._db_path)
            self._db.row_factory = aiosqlite.Row
            await self._db.commit()
```

修改 `close()` 方法：

```python
    async def close(self) -> None:
        if self._conn_manager is None and self._db:
            await self._db.close()
        self._db = None
```

- [ ] **Step 2: Update SqliteRoomEventStore similarly**

在 `src/cabinet/core/events/sqlite_room_store.py` 中，修改构造函数和 initialize 方法：

```python
class SqliteRoomEventStore:
    def __init__(self, room_name: str, db_path: str = "data/db/cabinet.db",
                 max_cache_size: int = 10000, conn_manager: object | None = None):
        self._room_name = room_name
        self._db_path = db_path
        self._conn_manager = conn_manager
        self._db: aiosqlite.Connection | None = None
        self._cache: list[BaseModel] = []
        self._persisted_count: int = 0
        self._max_cache_size = max_cache_size

    async def initialize(self) -> None:
        if self._conn_manager is not None:
            self._db = self._conn_manager.connection
        else:
            self._db = await aiosqlite.connect(self._db_path)
            await self._db.commit()
        await self._load_cache()
```

修改 `flush()` 使用 `executemany`：

```python
    async def flush(self) -> None:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        new_events = self._cache[self._persisted_count :]
        if not new_events:
            return
        if self._conn_manager is not None:
            params_seq = [
                (self._room_name, type(event).__name__, event.model_dump_json())
                for event in new_events
            ]
            await self._conn_manager.execute_writemany(
                "INSERT INTO room_events (room_name, event_type, event_data) VALUES (?, ?, ?)",
                params_seq,
            )
        else:
            for event in new_events:
                await self._db.execute(
                    "INSERT INTO room_events (room_name, event_type, event_data) VALUES (?, ?, ?)",
                    (self._room_name, type(event).__name__, event.model_dump_json()),
                )
            await self._db.commit()
        self._persisted_count = len(self._cache)
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store=self._room_name, operation="flush").observe(
                _time.monotonic() - start
            )
```

修改 `close()`：

```python
    async def close(self) -> None:
        await self.flush()
        if self._conn_manager is None and self._db:
            await self._db.close()
        self._db = None
```

- [ ] **Step 3: Update SQLiteMemoryStore similarly**

在 `src/cabinet/core/memory/sqlite_store.py` 中，添加 `conn_manager` 参数，修改 `initialize()` 和 `close()` 同上模式。

- [ ] **Step 4: Update AuditStore similarly**

在 `src/cabinet/core/audit.py` 中，添加 `conn_manager` 参数，修改 `initialize()` 和 `close()` 同上模式。

- [ ] **Step 5: Update DeadLetterQueue similarly**

在 `src/cabinet/core/workflow/dead_letter_queue.py` 中，添加 `conn_manager` 参数，修改构造函数和 `close()` 同上模式。

- [ ] **Step 6: Update runtime.py to create and pass SharedConnectionManager**

在 `src/cabinet/runtime.py` 的 `__init__` 和 `start()` 方法中：

1. 在 `__init__` 中添加 `self._conn_manager = None`
2. 在 `start()` 中，在数据库迁移之后创建 `SharedConnectionManager`：

```python
            from cabinet.core.db.connection_manager import SharedConnectionManager

            self._conn_manager = SharedConnectionManager(self._db_path)
            await self._conn_manager.initialize()
```

3. 将 `conn_manager=self._conn_manager` 传递给所有 SQLite 组件

4. 在 `stop()` 中关闭 `self._conn_manager`

- [ ] **Step 7: Run full test suite**

Run: `pytest tests/ -v --tb=short`
Expected: All PASS

- [ ] **Step 8: Commit**

```bash
git add src/cabinet/core/events/sqlite_store.py src/cabinet/core/events/sqlite_room_store.py src/cabinet/core/memory/sqlite_store.py src/cabinet/core/audit.py src/cabinet/core/workflow/dead_letter_queue.py src/cabinet/runtime.py
git commit -m "refactor: migrate all SQLite components to SharedConnectionManager with batch writes"
```

---

### Task 15: LLM Result Cache (Optional)

**Files:**
- Modify: `src/cabinet/core/gateway/litellm_adapter.py`
- Test: `tests/unit/core/gateway/test_litellm_adapter.py`

- [ ] **Step 1: Write the failing test**

在 `tests/unit/core/gateway/test_litellm_adapter.py` 中添加：

```python
def test_gateway_cache_disabled_by_default():
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    gateway = LiteLLMRouterGateway(model_list=[{
        "model_name": "test", "litellm_params": {"model": "openai/test"},
    }])
    assert gateway._enable_cache is False


def test_gateway_cache_can_be_enabled():
    from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
    gateway = LiteLLMRouterGateway(
        model_list=[{"model_name": "test", "litellm_params": {"model": "openai/test"}}],
        enable_cache=True, cache_ttl=60,
    )
    assert gateway._enable_cache is True
    assert gateway._cache_ttl == 60
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/core/gateway/test_litellm_adapter.py::test_gateway_cache_disabled_by_default -v`
Expected: FAIL (no enable_cache parameter)

- [ ] **Step 3: Add cache to LiteLLMRouterGateway**

在 `src/cabinet/core/gateway/litellm_adapter.py` 的 `__init__` 中添加参数和初始化：

```python
    def __init__(
        self,
        model_list: list[dict],
        fallbacks: list[dict] | None = None,
        context_window_fallbacks: list[dict] | None = None,
        num_retries: int = 3,
        timeout: int = 30,
        api_keys: dict[str, str] | None = None,
        enable_cache: bool = False,
        cache_ttl: int = 300,
    ):
        # ... existing init code ...
        self._enable_cache = enable_cache
        self._cache_ttl = cache_ttl
        self._cache: dict[str, tuple[float, str]] = {}
```

在 `complete()` 方法中，在 LLM 调用前检查缓存：

```python
        if self._enable_cache:
            cache_key = self._cache_key(model, messages, temperature)
            cached = self._get_cached(cache_key)
            if cached is not None:
                return cached
```

在成功返回前缓存结果：

```python
        if self._enable_cache:
            self._set_cache(cache_key, response)
```

添加缓存辅助方法：

```python
    @staticmethod
    def _cache_key(model: str, messages: list[dict], temperature: float) -> str:
        import hashlib, json
        data = json.dumps({"model": model, "messages": messages, "temperature": temperature}, sort_keys=True)
        return hashlib.sha256(data.encode()).hexdigest()

    def _get_cached(self, key: str) -> ModelResponse | None:
        import time
        entry = self._cache.get(key)
        if entry is None:
            return None
        ts, _ = entry
        if time.monotonic() - ts > self._cache_ttl:
            del self._cache[key]
            return None
        from cabinet.core.gateway.protocol import ModelResponse
        return ModelResponse.model_validate_json(self._cache[key][1])

    def _set_cache(self, key: str, response: ModelResponse) -> None:
        import time
        self._cache[key] = (time.monotonic(), response.model_dump_json())

    def _invalidate_cache(self) -> None:
        self._cache.clear()
```

在 `add_model()`、`remove_model()`、`replace_model()` 中添加 `self._invalidate_cache()`。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/core/gateway/test_litellm_adapter.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/gateway/litellm_adapter.py tests/unit/core/gateway/test_litellm_adapter.py
git commit -m "feat: add optional LLM result cache with TTL to gateway"
```

---

## Phase T4: Operations Friendliness

### Task 16: Startup Preflight Check

**Files:**
- Modify: `src/cabinet/runtime.py`
- Modify: `src/cabinet/cli/main.py`
- Test: `tests/unit/test_runtime.py`

- [ ] **Step 1: Write the failing test**

在 `tests/unit/test_runtime.py` 中添加：

```python
@pytest.mark.asyncio
async def test_preflight_check_returns_dict():
    from cabinet.runtime import CabinetRuntime
    from cabinet.agents.stub_factory import StubAgentFactory

    runtime = CabinetRuntime(agent_factory=StubAgentFactory(), db_path=None)
    result = await runtime.preflight_check()
    assert isinstance(result, dict)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_runtime.py::test_preflight_check_returns_dict -v`
Expected: FAIL (no preflight_check method)

- [ ] **Step 3: Add preflight_check() method to CabinetRuntime**

在 `src/cabinet/runtime.py` 的 `CabinetRuntime` 类中添加：

```python
    async def preflight_check(self) -> dict[str, str]:
        checks = {}
        checks["llm"] = await self._check_llm_reachable()
        checks["chromadb"] = await self._check_chromadb_writable()
        checks["api_keys"] = self._check_api_keys_valid()
        return checks

    async def _check_llm_reachable(self) -> str:
        if self._gateway is None:
            return "not_configured"
        models = self._gateway.list_models()
        if not models:
            return "no_models"
        return "ok"

    async def _check_chromadb_writable(self) -> str:
        if self._memory_store is None:
            return "not_configured"
        try:
            if hasattr(self._memory_store, '_collection'):
                count = self._memory_store._collection.count()
                return f"ok(count={count})"
            return "ok"
        except Exception as e:
            return f"error:{e}"

    def _check_api_keys_valid(self) -> str:
        if not self._api_keys:
            return "no_keys"
        empty_keys = [k for k, v in self._api_keys.items() if not v]
        if empty_keys:
            return f"empty_keys:{','.join(empty_keys)}"
        return "ok"
```

- [ ] **Step 4: Add --preflight option to status command**

在 `src/cabinet/cli/main.py` 的 `status` 命令中添加 `--preflight` 选项：

```python
@app.command()
def status(
    data_dir: str = typer.Option("data", "--data-dir"),
    preflight: bool = typer.Option(False, "--preflight", help="Run preflight dependency checks"),
):
```

在命令体中，如果 `preflight` 为 True，则运行 `runtime.preflight_check()` 并输出结果。

- [ ] **Step 5: Update _check_gateway() in health_check()**

将 `src/cabinet/runtime.py` 的 `_check_gateway()` 方法替换为：

```python
    async def _check_gateway(self) -> dict:
        if self._gateway is None:
            return {"status": "degraded", "detail": "no gateway configured"}
        models = self._gateway.list_models()
        if not models:
            return {"status": "degraded", "detail": "no models configured"}
        return {"status": "healthy", "detail": f"models={len(models)}"}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/unit/test_runtime.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/runtime.py src/cabinet/cli/main.py tests/unit/test_runtime.py
git commit -m "feat: add preflight check, enhance gateway health check, add --preflight to status"
```

---

### Task 17: Configuration Validation Enhancement

**Files:**
- Modify: `src/cabinet/cli/config.py`
- Test: `tests/unit/cli/test_config.py`

- [ ] **Step 1: Write the failing test**

在 `tests/unit/cli/test_config.py` 中添加：

```python
def test_load_config_missing_file():
    from cabinet.cli.config import load_config
    with pytest.raises(FileNotFoundError):
        load_config("/nonexistent/path/cabinet.json")


def test_load_config_friendly_error():
    from cabinet.cli.config import load_config
    try:
        load_config("/nonexistent/path/cabinet.json")
    except FileNotFoundError as e:
        assert "cabinet init" in str(e).lower() or "init" in str(e).lower()


def test_mcp_server_config_validates():
    from cabinet.cli.config import MCPServerConfig
    config = MCPServerConfig(name="test", transport="stdio", command="echo")
    assert config.name == "test"


def test_mcp_server_config_requires_name():
    from cabinet.cli.config import MCPServerConfig
    with pytest.raises(ValidationError):
        MCPServerConfig(transport="stdio", command="echo")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/cli/test_config.py -v`
Expected: FAIL (no MCPServerConfig)

- [ ] **Step 3: Add MCPServerConfig and enhance load_config()**

在 `src/cabinet/cli/config.py` 中添加：

```python
from typing import Literal


class MCPServerConfig(BaseModel):
    name: str = Field(..., min_length=1)
    transport: Literal["stdio", "sse"] = "stdio"
    command: str = Field(..., min_length=1)
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
```

修改 `CabinetConfig` 的 `mcp_servers` 字段类型：

```python
    mcp_servers: list[MCPServerConfig] = []
```

修改 `load_config()` 添加友好错误：

```python
def load_config(path: str = "data/cabinet.json") -> CabinetConfig:
    from pathlib import Path
    if not Path(path).exists():
        raise FileNotFoundError(
            f"Configuration file not found: {path}. "
            f"Please run 'cabinet init' first to create a new organization."
        )
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    try:
        return CabinetConfig.model_validate(data)
    except Exception as e:
        raise ValueError(f"Invalid configuration in {path}: {e}") from e
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/unit/cli/test_config.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/config.py tests/unit/cli/test_config.py
git commit -m "feat: add MCPServerConfig validation, friendly load_config errors"
```

---

### Task 18: Structured Logging Enhancement

**Files:**
- Modify: `src/cabinet/core/workflow/engine.py`
- Modify: `src/cabinet/core/workflow/dead_letter_queue.py`
- Modify: `src/cabinet/core/gateway/litellm_adapter.py`
- Modify: `src/cabinet/core/observability.py`

- [ ] **Step 1: Fix log levels**

1. `src/cabinet/core/gateway/litellm_adapter.py` L86: `logger.info("LLM complete: model=%s tokens=%s", ...)` → `logger.debug(...)`
2. `src/cabinet/core/workflow/engine.py` L210: `logger.warning("Tool registry execution failed...")` → `logger.error("Tool registry execution failed...", exc_info=True)`
3. `src/cabinet/core/workflow/dead_letter_queue.py` L34: `logger.info("DLQ enqueue: ...")` → `logger.warning("DLQ enqueue: ...")`

- [ ] **Step 2: Add request_id injection for CLI mode**

在 `src/cabinet/core/observability.py` 中扩展 `TraceInjectingFilter`，在非 OTel 上下文中注入 `request_id`：

```python
import uuid as _uuid


class TraceInjectingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        span = trace.get_current_span()
        ctx = span.get_span_context()
        if ctx.is_valid:
            record.trace_id = format(ctx.trace_id, "032x")
            record.span_id = format(ctx.span_id, "016x")
        else:
            record.trace_id = ""
            record.span_id = ""
        if not hasattr(record, "request_id"):
            record.request_id = ""
        return True


_cli_request_id: str = ""


def set_cli_request_id() -> str:
    global _cli_request_id
    _cli_request_id = str(_uuid.uuid4())[:8]
    return _cli_request_id


def get_cli_request_id() -> str:
    return _cli_request_id
```

在 `JsonFormatter` 中添加 `request_id` 字段输出。

- [ ] **Step 3: Set request_id in CLI main.py**

在 `src/cabinet/cli/main.py` 的 `main` 回调中添加：

```python
from cabinet.core.observability import set_cli_request_id


@app.callback()
def main():
    set_cli_request_id()
```

- [ ] **Step 4: Run lint and tests**

Run: `ruff check src/cabinet/ && pytest tests/ -v --tb=short`
Expected: No lint errors, all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/gateway/litellm_adapter.py src/cabinet/core/workflow/engine.py src/cabinet/core/workflow/dead_letter_queue.py src/cabinet/core/observability.py src/cabinet/cli/main.py
git commit -m "fix: correct log levels, add request_id for CLI mode, add exc_info to error logs"
```

---

### Task 19: Migration Dry-Run & Auto-Backup

**Files:**
- Modify: `src/cabinet/cli/main.py`
- Modify: `src/cabinet/core/events/migrations/runner.py`

- [ ] **Step 1: Add --dry-run option to db migrate command**

在 `src/cabinet/cli/main.py` 的 `db migrate` 命令中添加 `--dry-run` 选项：

```python
@db_app.command("migrate")
def db_migrate(
    data_dir: str = typer.Option("data", "--data-dir"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Preview SQL without executing"),
):
```

在命令体中，如果 `dry_run` 为 True，则输出待执行的 SQL 而不执行。

- [ ] **Step 2: Add auto-backup before migration**

在 `db_migrate` 命令体中，在实际执行迁移前自动创建备份：

```python
    if not dry_run:
        from cabinet.core.backup import BackupManager
        manager = BackupManager(data_dir)
        backup_path = await manager.create_backup(label="pre-migration")
        console.print(f"  Pre-migration backup: {backup_path}")
```

- [ ] **Step 3: Run lint**

Run: `ruff check src/cabinet/cli/main.py`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat: add --dry-run and auto-backup to db migrate command"
```

---

### Task 20: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `pytest tests/ -v --tb=short --cov=cabinet --cov-fail-under=75`
Expected: All PASS, coverage ≥ 75%

- [ ] **Step 2: Run lint**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Run type check**

Run: `mypy src/cabinet/ --ignore-missing-imports`
Expected: No critical errors

- [ ] **Step 4: Verify all T1-T4 acceptance criteria**

T1: ✅ API 路由测试盲区消除 ✅ 共享 fixture 提取 ✅ pytest markers ✅ CI 75%
T2: ✅ P0/P1 修复 ✅ 优雅关停 ✅ 工作流超时 ✅ LLM 异常保护 ✅ safe_eval
T3: ✅ SharedConnectionManager ✅ executemany ✅ handler 超时 ✅ LLM 缓存可选
T4: ✅ preflight check ✅ 配置校验 ✅ 健康检查增强 ✅ 日志结构化 ✅ 迁移 dry-run

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: quality hardening and production readiness complete"
```
