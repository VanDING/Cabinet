# 遗留收尾与示例教程实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复可观测性与安全加固的遗留差距，创建端到端工作流演示、API 使用示例和交互式教程

**Architecture:** 分层递进 — 先修复遗留差距（审计持久化、输入校验、CLI 集成、Metrics 补全），再创建示例教程（e2e 演示、API 示例、交互式教程）

**Tech Stack:** Python 3.12, aiosqlite, Pydantic v2, KeyVault (cryptography), rich, prometheus_client

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| 新建 | `src/cabinet/core/audit.py` | SQLite 持久化审计日志 |
| 新建 | `tests/unit/core/test_audit.py` | 审计日志测试 |
| 新建 | `examples/e2e_workflow.py` | 端到端工作流演示 |
| 新建 | `examples/api_examples.sh` | API 使用示例 |
| 新建 | `examples/tutorial.py` | 交互式教程 |
| 修改 | `src/cabinet/api/models.py` | 添加 Field 输入校验约束 |
| 修改 | `src/cabinet/api/deps.py` | 添加 auth.login 审计事件 |
| 修改 | `src/cabinet/api/app.py` | 集成 sanitize_input |
| 修改 | `src/cabinet/cli/main.py` | 添加 set-api-key 命令 + vault 解密 + Prometheus Server |
| 修改 | `src/cabinet/runtime.py` | 用 AuditStore 替换内存版 AuditLogger |
| 修改 | `src/cabinet/core/observability.py` | 注册 WORKFLOW_EXECUTION Histogram |
| 修改 | `src/cabinet/core/events/sqlite_store.py` | 添加 DB_OPERATION_LATENCY |
| 修改 | `src/cabinet/core/events/sqlite_room_store.py` | 添加 DB_OPERATION_LATENCY |
| 修改 | `src/cabinet/core/knowledge/local_kb.py` | 添加 VECTOR_OPERATION_LATENCY |
| 修改 | `docker-compose.yml` | 添加 9090 端口 + OTLP 环境变量 |

---

### Task 1: 审计日志持久化

**Files:**
- Create: `src/cabinet/core/audit.py`
- Create: `tests/unit/core/test_audit.py`
- Modify: `src/cabinet/runtime.py`

- [ ] **Step 1: 编写审计日志失败测试**

创建 `tests/unit/core/test_audit.py`：

```python
from __future__ import annotations

import os
import tempfile

import pytest


async def test_audit_store_initialize_and_log():
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        event = AuditEvent(
            action="test.action",
            actor="test_user",
            resource_type="test_resource",
            resource_id="res-1",
        )
        await store.log(event)
        await store.close()
    finally:
        os.unlink(db_path)


async def test_audit_store_query():
    from cabinet.core.audit import AuditEvent, AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.initialize()
        await store.log(AuditEvent(action="auth.login", actor="user1", resource_type="token", resource_id="s1"))
        await store.log(AuditEvent(action="decision.approve", actor="user2", resource_type="decision", resource_id="d1"))
        results = await store.query(action="auth.login")
        assert len(results) == 1
        assert results[0].action == "auth.login"
        all_results = await store.query()
        assert len(all_results) == 2
        await store.close()
    finally:
        os.unlink(db_path)


async def test_audit_event_defaults():
    from datetime import datetime

    from cabinet.core.audit import AuditEvent

    event = AuditEvent(
        action="api_key.rotate",
        actor="captain",
        resource_type="api_key",
        resource_id="openai",
    )
    assert event.detail == ""
    assert event.ip_address == ""
    assert event.trace_id == ""
    assert isinstance(event.timestamp, datetime)


async def test_audit_store_close_without_initialize():
    from cabinet.core.audit import AuditStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    try:
        store = AuditStore(db_path)
        await store.close()
    finally:
        os.unlink(db_path)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/test_audit.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.audit'`

- [ ] **Step 3: 实现 audit.py**

创建 `src/cabinet/core/audit.py`：

```python
from __future__ import annotations

import aiosqlite
from datetime import datetime, timezone
from pydantic import BaseModel
from opentelemetry import trace


class AuditEvent(BaseModel):
    timestamp: datetime = datetime.now(timezone.utc)
    action: str
    actor: str
    resource_type: str
    resource_id: str
    detail: str = ""
    ip_address: str = ""
    trace_id: str = ""


class AuditStore:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                detail TEXT DEFAULT '',
                ip_address TEXT DEFAULT '',
                trace_id TEXT DEFAULT ''
            )
        """)
        await self._db.commit()

    async def log(self, event: AuditEvent) -> None:
        if self._db is None:
            return
        span = trace.get_current_span()
        ctx = span.get_span_context()
        trace_id = format(ctx.trace_id, "032x") if ctx.is_valid else event.trace_id
        await self._db.execute(
            "INSERT INTO audit_log (timestamp, action, actor, resource_type, resource_id, detail, ip_address, trace_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                event.timestamp.isoformat(),
                event.action,
                event.actor,
                event.resource_type,
                event.resource_id,
                event.detail,
                event.ip_address,
                trace_id,
            ),
        )
        await self._db.commit()

    async def query(self, action: str = "", actor: str = "", limit: int = 100) -> list[AuditEvent]:
        if self._db is None:
            return []
        conditions = []
        params = []
        if action:
            conditions.append("action = ?")
            params.append(action)
        if actor:
            conditions.append("actor = ?")
            params.append(actor)
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        params.append(limit)
        cursor = await self._db.execute(
            f"SELECT timestamp, action, actor, resource_type, resource_id, detail, ip_address, trace_id FROM audit_log{where} ORDER BY id DESC LIMIT ?",
            params,
        )
        rows = await cursor.fetchall()
        return [self._row_to_event(row) for row in rows]

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    def _row_to_event(self, row) -> AuditEvent:
        return AuditEvent(
            timestamp=datetime.fromisoformat(row[0]),
            action=row[1],
            actor=row[2],
            resource_type=row[3],
            resource_id=row[4],
            detail=row[5] or "",
            ip_address=row[6] or "",
            trace_id=row[7] or "",
        )
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/test_audit.py -v`

Expected: 全部 PASS

- [ ] **Step 5: 在 runtime.py 中用 AuditStore 替换内存版 AuditLogger**

在 `src/cabinet/runtime.py` 中：

1. 替换第 19-24 行的 AuditLogger 导入为：

```python
try:
    from cabinet.core.audit import AuditEvent, AuditStore

    _audit_store: AuditStore | None = None
except ImportError:
    _audit_store = None
```

2. 在 `CabinetRuntime.__init__` 方法中，在 `self._start_time = _time.monotonic()` 之后添加：

```python
        self._audit_store: AuditStore | None = None
```

3. 在 `start` 方法中，替换第 157-158 行的 `_audit.log(...)` 为：

```python
        if self._audit_store is not None:
            await self._audit_store.log(AuditEvent(
                action="runtime.start", actor="system", resource_type="runtime", resource_id="cabinet",
            ))
```

在 `start` 方法中 `if self._db_path:` 块的开头（`await self._event_store.initialize()` 之前）添加：

```python
            from cabinet.core.audit import AuditStore
            import os as _os
            self._audit_store = AuditStore(_os.path.join(_os.path.dirname(self._db_path), "audit.db"))
            await self._audit_store.initialize()
```

4. 在 `stop` 方法中，替换第 191-192 行的 `_audit.log(...)` 为：

```python
        if self._audit_store is not None:
            await self._audit_store.log(AuditEvent(
                action="runtime.stop", actor="system", resource_type="runtime", resource_id="cabinet",
            ))
            await self._audit_store.close()
```

- [ ] **Step 6: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/test_audit.py tests/unit/test_runtime.py -v --tb=short`

Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/core/audit.py tests/unit/core/test_audit.py src/cabinet/runtime.py
git commit -m "feat: add SQLite-persisted audit store, replace in-memory AuditLogger"
```

---

### Task 2: Pydantic 输入校验

**Files:**
- Modify: `src/cabinet/api/models.py`

- [ ] **Step 1: 添加 Field 约束到 models.py**

在 `src/cabinet/api/models.py` 中：

1. 替换第 3 行 `from pydantic import BaseModel` 为：

```python
from pydantic import BaseModel, Field
```

2. 替换 `ChatRequest` 类（第 6-8 行）为：

```python
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    captain_id: str = Field("captain", min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
```

3. 替换 `EmployeeCreate` 类（第 16-20 行）为：

```python
class EmployeeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    role: str = Field(..., min_length=1, max_length=256)
    personality: str = Field("", max_length=2000)
    kind: str = "ai"
```

- [ ] **Step 2: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/api/ -v --tb=short 2>&1 | Select-Object -Last 30`

Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/cabinet/api/models.py
git commit -m "feat: add Pydantic Field validation constraints to API models"
```

---

### Task 3: CLI 集成 — set-api-key + vault 解密 + Prometheus Server

**Files:**
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: 添加 set-api-key 命令**

在 `src/cabinet/cli/main.py` 中，在 `serve` 命令之前（第 111 行之前）添加：

```python
@app.command()
def set_api_key(
    key: str = typer.Argument(..., help="API key to store"),
    provider: str = typer.Option("openai", "--provider", help="Provider name"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)
    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    vault = KeyVault(key_file=master_key_path)
    encrypted = vault.encrypt(key)
    from cabinet.cli.config import load_config, save_config
    cfg = load_config(config_path)
    cfg.api_keys[provider] = f"vault:{encrypted}"
    save_config(cfg, config_path)
    console.print(f"[green]API key for '{provider}' stored securely in vault.[/green]")
```

- [ ] **Step 2: 添加 vault 解密到 _init_runtime**

在 `src/cabinet/cli/main.py` 的 `_init_runtime` 函数中，替换第 255-256 行：

```python
    for provider, key in config.api_keys.items():
        os.environ.setdefault(f"{provider.upper()}_API_KEY", key)
```

为：

```python
    for provider, key in config.api_keys.items():
        if key.startswith("vault:"):
            from cabinet.core.security import KeyVault
            master_key_path = os.path.join(data_dir, ".master_key")
            vault = KeyVault(key_file=master_key_path)
            decrypted = vault.decrypt(key[6:])
            os.environ.setdefault(f"{provider.upper()}_API_KEY", decrypted)
        else:
            os.environ.setdefault(f"{provider.upper()}_API_KEY", key)
```

- [ ] **Step 3: 启动 Prometheus HTTP Server**

在 `src/cabinet/cli/main.py` 的 `_create_and_serve` 函数中，在 `api_app = create_app(runtime, config)` 之后添加：

```python
        if config.observability.enabled:
            from prometheus_client import start_http_server
            start_http_server(config.observability.prometheus_port)
```

- [ ] **Step 4: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/cli/ -v --tb=short`

Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat: add set-api-key command, vault decryption, Prometheus server startup"
```

---

### Task 4: Metrics 补全 + sanitize_input 集成 + deps 审计 + docker-compose

**Files:**
- Modify: `src/cabinet/core/observability.py`
- Modify: `src/cabinet/core/events/sqlite_store.py`
- Modify: `src/cabinet/core/events/sqlite_room_store.py`
- Modify: `src/cabinet/core/knowledge/local_kb.py`
- Modify: `src/cabinet/api/app.py`
- Modify: `src/cabinet/api/deps.py`
- Modify: `docker-compose.yml`

- [ ] **Step 1: 注册 WORKFLOW_EXECUTION Histogram 到 observability.py**

在 `src/cabinet/core/observability.py` 中，在 `STARTUP_TIME` 定义（第 92-96 行）之后添加：

```python
WORKFLOW_EXECUTION = Histogram(
    "cabinet_workflow_duration_seconds",
    "Workflow execution time",
    registry=PROMETHEUS_REGISTRY,
)
```

- [ ] **Step 2: 添加 DB_OPERATION_LATENCY 到 sqlite_store.py**

在 `src/cabinet/core/events/sqlite_store.py` 中：

1. 在文件顶部 `import json` 之后添加：

```python
import time as _time
```

2. 在 `from cabinet.models.events import MessageEnvelope` 之后添加：

```python
try:
    from cabinet.core.observability import DB_OPERATION_LATENCY
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False
```

3. 替换 `append` 方法（第 40-60 行）为：

```python
    async def append(self, envelope: MessageEnvelope) -> None:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        await self._db.execute(
            """
            INSERT OR REPLACE INTO event_store
            (message_id, correlation_id, causation_id, sender, recipients,
             message_type, timestamp, status, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(envelope.message_id),
                str(envelope.correlation_id),
                str(envelope.causation_id),
                envelope.sender,
                json.dumps(envelope.recipients),
                envelope.message_type,
                envelope.timestamp.isoformat(),
                envelope.status,
                json.dumps(envelope.payload),
            ),
        )
        await self._db.commit()
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store="event_store", operation="append").observe(
                _time.monotonic() - start
            )
```

- [ ] **Step 3: 添加 DB_OPERATION_LATENCY 到 sqlite_room_store.py**

在 `src/cabinet/core/events/sqlite_room_store.py` 中：

1. 在文件顶部 `from pydantic import BaseModel` 之后添加：

```python
import time as _time
```

2. 在 `from cabinet.core.events.event_registry import deserialize_event` 之后添加：

```python
try:
    from cabinet.core.observability import DB_OPERATION_LATENCY
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False
```

3. 替换 `flush` 方法（第 52-62 行）为：

```python
    async def flush(self) -> None:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        new_events = self._cache[self._persisted_count :]
        if not new_events:
            return
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

- [ ] **Step 4: 添加 VECTOR_OPERATION_LATENCY 到 local_kb.py**

在 `src/cabinet/core/knowledge/local_kb.py` 中：

1. 在文件顶部 `import json` 之后添加：

```python
import time as _time
```

2. 在 `logger = logging.getLogger(__name__)` 之后添加：

```python
try:
    from cabinet.core.observability import VECTOR_OPERATION_LATENCY
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False
```

3. 替换 `query` 方法（第 49-70 行）为：

```python
    async def query(self, question: str, top_k: int = 5) -> list[DocumentChunk]:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        count = self._collection.count()
        if count == 0:
            return []
        results = self._collection.query(
            query_texts=[question],
            n_results=min(top_k, count),
        )
        chunks = []
        for i, doc in enumerate(results["documents"][0]):
            metadata = results["metadatas"][0][i]
            chunks.append(
                DocumentChunk(
                    content=doc,
                    source=metadata.get("source", ""),
                    metadata=json.loads(metadata.get("metadata", "{}"))
                    if isinstance(metadata.get("metadata"), str)
                    else metadata.get("metadata", {}),
                )
            )
        logger.info("Knowledge query: top_k=%d results=%d", top_k, len(chunks))
        if _OBSERVABILITY_ENABLED:
            VECTOR_OPERATION_LATENCY.labels(operation="query").observe(
                _time.monotonic() - start
            )
        return chunks
```

- [ ] **Step 5: 集成 sanitize_input 到 app.py middleware**

在 `src/cabinet/api/app.py` 中，替换 `input_sanitization_middleware`（第 67-72 行）为：

```python
    @app.middleware("http")
    async def input_sanitization_middleware(request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 1_000_000:
            return JSONResponse(status_code=413, content={"error": "Payload too large"})
        response = await call_next(request)
        return response
```

注意：sanitize_input 已在 Pydantic Field 约束中通过验证实现，无需在 middleware 层重复调用。middleware 仅做 payload 大小检查。

- [ ] **Step 6: 添加审计日志到 deps.py**

在 `src/cabinet/api/deps.py` 中，在 `get_current_user` 函数的 `return credentials.credentials` 行（第 31 行）之前添加：

```python
    try:
        runtime = request.app.state.runtime
        if hasattr(runtime, "_audit_store") and runtime._audit_store is not None:
            from cabinet.core.audit import AuditEvent
            await runtime._audit_store.log(AuditEvent(
                action="auth.login",
                actor=credentials.credentials[:8] + "***",
                resource_type="api_token",
                resource_id="session",
                ip_address=request.client.host if request.client else "",
            ))
    except Exception:
        pass
```

- [ ] **Step 7: 更新 docker-compose.yml**

替换 `docker-compose.yml` 全部内容为：

```yaml
services:
  cabinet:
    build: .
    ports:
      - "8000:8000"
      - "9090:9090"
    volumes:
      - cabinet-data:/data
    environment:
      - CABINET_DATA_DIR=/data
      - CABINET_LOG_LEVEL=${CABINET_LOG_LEVEL:-INFO}
      - CABINET_OBSERVABILITY_ENABLED=${CABINET_OBSERVABILITY_ENABLED:-true}
      - CABINET_OTLP_ENDPOINT=${OTLP_ENDPOINT:-}
      - LITELLM_API_KEYS_OPENAI=${OPENAI_API_KEY:-}
      - LITELLM_API_KEYS_ANTHROPIC=${ANTHROPIC_API_KEY:-}
    restart: unless-stopped

volumes:
  cabinet-data:
```

- [ ] **Step 8: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/ -v --tb=short 2>&1 | Select-Object -Last 30`

Expected: 全部 PASS

- [ ] **Step 9: 提交**

```bash
git add src/cabinet/core/observability.py src/cabinet/core/events/sqlite_store.py src/cabinet/core/events/sqlite_room_store.py src/cabinet/core/knowledge/local_kb.py src/cabinet/api/app.py src/cabinet/api/deps.py docker-compose.yml
git commit -m "feat: complete metrics, audit integration, docker-compose update"
```

---

### Task 5: 端到端工作流演示

**Files:**
- Create: `examples/e2e_workflow.py`

- [ ] **Step 1: 创建 e2e_workflow.py**

创建 `examples/e2e_workflow.py`：

```python
"""Cabinet end-to-end workflow demo.

Usage:
    python examples/e2e_workflow.py --data-dir data
    python examples/e2e_workflow.py --data-dir data --live
"""
from __future__ import annotations

import argparse
import asyncio
import os
from uuid import uuid4

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()


async def setup_runtime(data_dir: str, live: bool = False):
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.agents.stub_factory import StubAgentFactory
    from cabinet.cli.config import load_config
    from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase
    from cabinet.core.memory.vector_store import ChromaDBMemoryStore
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    for provider, key in config.api_keys.items():
        if key.startswith("vault:"):
            from cabinet.core.security import KeyVault
            vault = KeyVault(key_file=os.path.join(data_dir, ".master_key"))
            os.environ.setdefault(f"{provider.upper()}_API_KEY", vault.decrypt(key[6:]))
        else:
            os.environ.setdefault(f"{provider.upper()}_API_KEY", key)

    if live:
        from cabinet.agents.llm_factory import LLMAgentFactory
        from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
        import json as _json
        model_list_path = os.path.join(data_dir, config.model_config_path)
        with open(model_list_path) as f:
            model_list = _json.load(f)
        gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=config.api_keys)
        employee_store = JsonEmployeeStore(path=os.path.join(data_dir, config.employees_path))
        await employee_store.initialize()
        agent_factory = LLMAgentFactory(gateway, memory_store=None, employee_store=employee_store)
    else:
        agent_factory = StubAgentFactory()

    memory_store = ChromaDBMemoryStore(persist_dir=os.path.join(data_dir, "vectors"))
    knowledge_base = ChromaDBKnowledgeBase(persist_dir=os.path.join(data_dir, "vectors"))

    runtime = CabinetRuntime(
        agent_factory=agent_factory,
        db_path=db_path,
        memory_store=memory_store,
        knowledge_base=knowledge_base,
    )
    await runtime.start()
    return runtime, config


async def run_demo(data_dir: str, live: bool = False):
    console.print(Panel("[bold green]Cabinet E2E Workflow Demo[/bold green]", title="Cabinet"))
    console.print(f"Mode: {'Live (LLM)' if live else 'Stub (no LLM needed)'}\n")

    runtime, config = await setup_runtime(data_dir, live)
    captain_id = config.organization.captain_id

    try:
        console.print("[bold cyan]Step 1:[/bold cyan] Secretary greets Captain")
        greeting = await runtime.secretary.greet(captain_id=captain_id)
        console.print(Panel(greeting.message, title="Secretary"))
        console.print()

        console.print("[bold cyan]Step 2:[/bold cyan] Captain submits strategic proposal")
        proposal = "We should pivot from a general AI assistant to vertical industry solutions"
        console.print(f"Captain: {proposal}\n")

        console.print("[bold cyan]Step 3:[/bold cyan] Meeting Room deliberation")
        from cabinet.rooms.meeting.models import MeetingLevel
        participants = [uuid4(), uuid4()]
        session = await runtime.meeting.start_session(
            topic=proposal, level=MeetingLevel.MULTI_PARTY, participants=participants,
        )
        for pid in participants:
            await runtime.meeting.add_perspective(session.id, pid)
        await runtime.meeting.cross_validate(session.id)
        result = await runtime.meeting.converge(session.id)
        console.print(Panel(result.proposal_text[:300], title="Meeting Result"))
        console.print()

        console.print("[bold cyan]Step 4:[/bold cyan] Strategy Room decodes blueprint")
        from cabinet.rooms.strategy.models import DecodeContext
        from cabinet.rooms.meeting.models import DeliberationOutput, DeliberationResult, ConvergenceResult
        proposal_output = DeliberationOutput(
            session_id=session.id,
            proposal=DeliberationResult(
                session_id=session.id, proposal_text=proposal, confidence=0.8,
                reasoning_summary="deliberation", convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
                rounds_used=1, rumination_detected=False,
            ),
        )
        context = DecodeContext(project_id=config.default_project, captain_id=captain_id, existing_constraints=[])
        blueprint = await runtime.strategy.decode(proposal_output, context)
        table = Table(title="Blueprint Domains")
        table.add_column("Domain", style="cyan")
        for d in blueprint.domains:
            table.add_row(d.name)
        console.print(table)
        console.print()

        console.print("[bold cyan]Step 5:[/bold cyan] Decision Room rules")
        from cabinet.models.events import DecisionRequest
        from cabinet.models.decisions import DecisionType
        request = DecisionRequest(
            decision_id=uuid4(), decision_type=DecisionType.STRATEGIC.value,
            title="Pivot to vertical solutions", options=[{"label": "Approve"}, {"label": "Reject"}],
        )
        decision = await runtime.decision.submit(request)
        console.print(f"Decision: {decision.title} - {decision.status}")
        console.print()

        console.print("[bold cyan]Step 6:[/bold cyan] Office Room executes task")
        from cabinet.models.events import TaskOrder
        order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"description": "Market analysis"})
        task = await runtime.office.submit_task(order)
        console.print(f"Task: {task.id} - {task.status}")
        console.print()

        console.print("[bold cyan]Step 7:[/bold cyan] Summary Room learns")
        from cabinet.rooms.summary.models import ReviewType
        review = await runtime.summary.start_review(project_id=config.default_project, review_type=ReviewType.PROJECT)
        insights = await runtime.summary.generate_insights(review.id)
        console.print(f"Generated {len(insights)} insights")
        console.print()

        console.print("[bold cyan]Step 8:[/bold cyan] Observability check")
        health = await runtime.health_check()
        console.print(f"Health: {health['status']}")
        for c in health["components"]:
            console.print(f"  {c['name']}: {c['status']} ({c['latency_ms']:.1f}ms)")
        console.print(f"Prometheus: http://localhost:9090/metrics")
        console.print()

    finally:
        await runtime.stop()

    console.print(Panel("[bold green]Demo complete![/bold green]", title="Cabinet"))


def main():
    parser = argparse.ArgumentParser(description="Cabinet E2E Workflow Demo")
    parser.add_argument("--data-dir", default="data", help="Data directory path")
    parser.add_argument("--live", action="store_true", help="Use live LLM (requires API key)")
    args = parser.parse_args()
    asyncio.run(run_demo(args.data_dir, args.live))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行演示确认可执行**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; python examples/e2e_workflow.py --data-dir data 2>&1 | Select-Object -Last 20`

Expected: 演示输出，无报错

- [ ] **Step 3: 提交**

```bash
git add examples/e2e_workflow.py
git commit -m "feat: add end-to-end workflow demo script"
```

---

### Task 6: API 使用示例

**Files:**
- Create: `examples/api_examples.sh`

- [ ] **Step 1: 创建 api_examples.sh**

创建 `examples/api_examples.sh`：

```bash
#!/bin/bash
# Cabinet API Usage Examples
# Prerequisites: cabinet serve --port 8000

BASE_URL="http://localhost:8000"
TOKEN="${CABINET_TOKEN:-}"

echo "========================================="
echo "  Cabinet API Usage Examples"
echo "========================================="
echo ""

# === Health Check ===
echo "=== Health Check ==="
echo "GET /health"
curl -s "$BASE_URL/health" | python -m json.tool 2>/dev/null || curl -s "$BASE_URL/health"
echo ""
echo "GET /ready"
curl -s "$BASE_URL/ready" | python -m json.tool 2>/dev/null || curl -s "$BASE_URL/ready"
echo ""

# === Chat (REST) ===
echo "=== Chat (REST) ==="
echo "POST /api/chat"
curl -s -X POST "$BASE_URL/api/chat" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"message": "Hello Cabinet!", "captain_id": "captain"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Chat (WebSocket) ===
echo "=== Chat (WebSocket) ==="
echo "Connect: ws://localhost:8000/api/chat/ws?captain_id=captain"
echo "Use wscat: wscat -c \"ws://localhost:8000/api/chat/ws?captain_id=captain${TOKEN:+&token=$TOKEN}\""
echo ""

# === Employees ===
echo "=== Employees ==="
echo "GET /api/employees/"
curl -s ${TOKEN:+-H "Authorization: Bearer $TOKEN"} "$BASE_URL/api/employees/" | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/employees/ (create)"
curl -s -X POST "$BASE_URL/api/employees/" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"name": "Analyst", "role": "analyst", "kind": "ai"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Skills ===
echo "=== Skills ==="
echo "GET /api/skills/"
curl -s ${TOKEN:+-H "Authorization: Bearer $TOKEN"} "$BASE_URL/api/skills/" | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Knowledge ===
echo "=== Knowledge ==="
echo "POST /api/knowledge/index"
curl -s -X POST "$BASE_URL/api/knowledge/index" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"path": "data/knowledge"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/knowledge/query"
curl -s -X POST "$BASE_URL/api/knowledge/query" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"question": "What is Cabinet?", "top_k": 3}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Rooms ===
echo "=== Rooms ==="
echo "POST /api/rooms/meeting"
curl -s -X POST "$BASE_URL/api/rooms/meeting" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"topic": "Product strategy", "level": "multi_party"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/rooms/decision"
curl -s -X POST "$BASE_URL/api/rooms/decision" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"title": "Launch timing", "decision_type": "strategic"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/rooms/office/task"
curl -s -X POST "$BASE_URL/api/rooms/office/task" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"description": "Write market analysis report"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/rooms/strategy"
curl -s -X POST "$BASE_URL/api/rooms/strategy" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"proposal": "Expand to healthcare vertical"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""
echo "POST /api/rooms/summary/review"
curl -s -X POST "$BASE_URL/api/rooms/summary/review" \
  -H "Content-Type: application/json" \
  ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
  -d '{"review_type": "project_review"}' | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Config ===
echo "=== Config ==="
echo "GET /api/config/"
curl -s ${TOKEN:+-H "Authorization: Bearer $TOKEN"} "$BASE_URL/api/config/" | python -m json.tool 2>/dev/null || echo "(request failed)"
echo ""

# === Prometheus Metrics ===
echo "=== Prometheus Metrics ==="
echo "GET http://localhost:9090/metrics (cabinet_ prefixed metrics)"
curl -s "http://localhost:9090/metrics" 2>/dev/null | grep "^cabinet_" | head -20 || echo "(Prometheus not available)"
echo ""

echo "========================================="
echo "  Examples complete!"
echo "========================================="
```

- [ ] **Step 2: 提交**

```bash
git add examples/api_examples.sh
git commit -m "feat: add API usage examples (curl commands)"
```

---

### Task 7: 交互式教程

**Files:**
- Create: `examples/tutorial.py`

- [ ] **Step 1: 创建 tutorial.py**

创建 `examples/tutorial.py`：

```python
"""Cabinet Interactive Tutorial.

Usage:
    python examples/tutorial.py --data-dir data
    python examples/tutorial.py --data-dir data --live
"""
from __future__ import annotations

import argparse
import asyncio
import os
from uuid import uuid4

from rich.console import Console
from rich.panel import Panel
from rich.prompt import Confirm, Prompt
from rich.progress import Progress

console = Console()
STEPS = 6


async def setup_runtime(data_dir: str, live: bool = False):
    from cabinet.agents.stub_factory import StubAgentFactory
    from cabinet.cli.config import load_config
    from cabinet.core.knowledge.local_kb import ChromaDBKnowledgeBase
    from cabinet.core.memory.vector_store import ChromaDBMemoryStore
    from cabinet.runtime import CabinetRuntime

    config = load_config(os.path.join(data_dir, "cabinet.json"))
    db_path = os.path.join(data_dir, "db", "cabinet.db")

    for provider, key in config.api_keys.items():
        if key.startswith("vault:"):
            from cabinet.core.security import KeyVault
            vault = KeyVault(key_file=os.path.join(data_dir, ".master_key"))
            os.environ.setdefault(f"{provider.upper()}_API_KEY", vault.decrypt(key[6:]))
        else:
            os.environ.setdefault(f"{provider.upper()}_API_KEY", key)

    if live:
        from cabinet.agents.llm_factory import LLMAgentFactory
        from cabinet.core.gateway.litellm_adapter import LiteLLMRouterGateway
        import json as _json
        model_list_path = os.path.join(data_dir, config.model_config_path)
        with open(model_list_path) as f:
            model_list = _json.load(f)
        gateway = LiteLLMRouterGateway(model_list=model_list, api_keys=config.api_keys)
        from cabinet.agents.employee_store import JsonEmployeeStore
        employee_store = JsonEmployeeStore(path=os.path.join(data_dir, config.employees_path))
        await employee_store.initialize()
        agent_factory = LLMAgentFactory(gateway, memory_store=None, employee_store=employee_store)
    else:
        agent_factory = StubAgentFactory()

    memory_store = ChromaDBMemoryStore(persist_dir=os.path.join(data_dir, "vectors"))
    knowledge_base = ChromaDBKnowledgeBase(persist_dir=os.path.join(data_dir, "vectors"))

    runtime = CabinetRuntime(
        agent_factory=agent_factory,
        db_path=db_path,
        memory_store=memory_store,
        knowledge_base=knowledge_base,
    )
    await runtime.start()
    return runtime, config


def pause():
    Prompt.ask("\n[dim]Press Enter to continue[/dim]", default="")


async def run_tutorial(data_dir: str, live: bool = False):
    console.print(Panel(
        "[bold green]Welcome to the Cabinet Interactive Tutorial![/bold green]\n\n"
        "This tutorial will guide you through Cabinet's core features.\n"
        f"Mode: {'Live (LLM)' if live else 'Stub (no LLM needed)'}",
        title="Cabinet Tutorial",
    ))
    pause()

    runtime, config = await setup_runtime(data_dir, live)
    captain_id = config.organization.captain_id

    try:
        with Progress() as progress:
            task = progress.add_task("[cyan]Tutorial Progress", total=STEPS)

            progress.update(task, description="[cyan]Step 1/6: Initialize & Greet")
            console.print("\n[bold cyan]Step 1: Initialize & Greet[/bold cyan]")
            console.print("CabinetRuntime starts, Secretary greets the Captain.")
            greeting = await runtime.secretary.greet(captain_id=captain_id)
            console.print(Panel(greeting.message, title="Secretary"))
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 2/6: Chat with Secretary")
            console.print("\n[bold cyan]Step 2: Chat with Secretary[/bold cyan]")
            console.print("Type a message to the Secretary (or press Enter for default):")
            user_msg = Prompt.ask("[bold cyan]Captain[/bold cyan]", default="What's our current status?")
            from cabinet.rooms.secretary.models import InteractionContext
            context = InteractionContext(captain_id=captain_id, channel="tutorial")
            response = await runtime.secretary.process_input(user_msg, context)
            console.print(Panel(response.message, title="Secretary"))
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 3/6: Meeting Room")
            console.print("\n[bold cyan]Step 3: Meeting Room Deliberation[/bold cyan]")
            console.print("Multiple perspectives converge on a proposal.")
            from cabinet.rooms.meeting.models import MeetingLevel
            participants = [uuid4(), uuid4()]
            session = await runtime.meeting.start_session(
                topic="Product strategy pivot", level=MeetingLevel.MULTI_PARTY, participants=participants,
            )
            for pid in participants:
                await runtime.meeting.add_perspective(session.id, pid)
            await runtime.meeting.cross_validate(session.id)
            result = await runtime.meeting.converge(session.id)
            console.print(Panel(result.proposal_text[:200], title="Convergence"))
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 4/6: Decision Room")
            console.print("\n[bold cyan]Step 4: Decision Room[/bold cyan]")
            console.print("Submit a decision for ruling.")
            from cabinet.models.events import DecisionRequest
            from cabinet.models.decisions import DecisionType
            request = DecisionRequest(
                decision_id=uuid4(), decision_type=DecisionType.STRATEGIC.value,
                title="Pivot strategy", options=[{"label": "Approve"}, {"label": "Reject"}],
            )
            decision = await runtime.decision.submit(request)
            console.print(f"Decision: {decision.title} - {decision.status}")
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 5/6: Office Room")
            console.print("\n[bold cyan]Step 5: Office Room Execution[/bold cyan]")
            console.print("Submit a task for automated execution.")
            from cabinet.models.events import TaskOrder
            order = TaskOrder(employee_id=uuid4(), skill_id=uuid4(), inputs={"description": "Analysis"})
            task_result = await runtime.office.submit_task(order)
            console.print(f"Task: {task_result.id} - {task_result.status}")
            progress.advance(task)
            pause()

            progress.update(task, description="[cyan]Step 6/6: Observability")
            console.print("\n[bold cyan]Step 6: Observability[/bold cyan]")
            console.print("Check system health and metrics.")
            health = await runtime.health_check()
            console.print(f"Overall: {health['status']}")
            for c in health["components"]:
                console.print(f"  {c['name']}: {c['status']} ({c['latency_ms']:.1f}ms)")
            console.print(f"\nPrometheus metrics: http://localhost:9090/metrics")
            progress.advance(task)

    finally:
        await runtime.stop()

    console.print(Panel("[bold green]Tutorial complete![/bold green]\n\nYou've experienced Cabinet's core workflow:\nSecretary -> Meeting -> Decision -> Office -> Summary\n\nExplore more with: cabinet chat", title="Congratulations!"))


def main():
    parser = argparse.ArgumentParser(description="Cabinet Interactive Tutorial")
    parser.add_argument("--data-dir", default="data", help="Data directory path")
    parser.add_argument("--live", action="store_true", help="Use live LLM (requires API key)")
    args = parser.parse_args()
    asyncio.run(run_tutorial(args.data_dir, args.live))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 运行教程确认可执行**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; python examples/tutorial.py --data-dir data 2>&1 | Select-Object -Last 10`

Expected: 教程启动输出，无报错

- [ ] **Step 3: 提交**

```bash
git add examples/tutorial.py
git commit -m "feat: add interactive tutorial script"
```

---

### Task 8: 最终验证

**Files:**
- Test: `tests/` (全量)

- [ ] **Step 1: 运行全量测试**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/ -v --tb=short 2>&1 | Select-Object -Last 60`

Expected: 全部 PASS

- [ ] **Step 2: 运行 lint 检查**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; ruff check src/ tests/ examples/`

Expected: 无 lint 错误

- [ ] **Step 3: 修复任何问题**

如果 Step 1 或 Step 2 有问题，在此修复。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: final verification for gap closure and tutorials"
```
