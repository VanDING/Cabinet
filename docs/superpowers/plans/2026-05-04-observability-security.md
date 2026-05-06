# 可观测性与安全加固实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Cabinet 添加全量可观测性（Prometheus Metrics + OpenTelemetry Tracing + 结构化 JSON 日志 + Health Check）和安全加固（API Key 加密存储 + 输入校验 + 审计日志）

**Architecture:** 统一可观测性核心模块 `observability.py` 管理 Metrics/Tracing/Logging 初始化和关联；Health Check 端点通过 `CabinetRuntime.health_check()` 并行检查子系统；安全模块 `security.py` 使用 Fernet 对称加密存储敏感配置；审计模块 `audit.py` 使用 SQLite 持久化操作日志并关联 trace_id

**Tech Stack:** prometheus-client, opentelemetry-api/sdk, opentelemetry-instrumentation-fastapi, opentelemetry-exporter-otlp-proto-http, cryptography, aiosqlite

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|---------|------|
| 新建 | `src/cabinet/core/observability.py` | 可观测性核心（Metrics + Tracing + Logging） |
| 新建 | `src/cabinet/core/security.py` | KeyVault 加密存储 |
| 新建 | `src/cabinet/core/audit.py` | 审计日志 |
| 新建 | `src/cabinet/api/routes/health.py` | Health Check 端点 |
| 新建 | `tests/unit/core/test_observability.py` | 可观测性核心测试 |
| 新建 | `tests/unit/core/test_security.py` | KeyVault 测试 |
| 新建 | `tests/unit/core/test_audit.py` | 审计日志测试 |
| 新建 | `tests/unit/api/test_health.py` | Health Check 端点测试 |
| 修改 | `src/cabinet/core/logging.py` | 删除，功能合并到 observability.py |
| 修改 | `src/cabinet/cli/config.py` | 添加 ObservabilitySettings + vault_enabled |
| 修改 | `src/cabinet/cli/main.py` | serve 集成可观测性 + set-api-key 命令 |
| 修改 | `src/cabinet/api/app.py` | 注入 Prometheus middleware + OTel + Health 路由 + 输入限制 |
| 修改 | `src/cabinet/api/models.py` | 添加 HealthResponse + ComponentHealth + 输入校验 |
| 修改 | `src/cabinet/api/deps.py` | 审计日志记录登录尝试 |
| 修改 | `src/cabinet/api/routes/chat.py` | WebSocket Gauge + Tracing Span |
| 修改 | `src/cabinet/runtime.py` | 添加 health_check() + AuditStore + _start_time |
| 修改 | `src/cabinet/core/gateway/litellm_adapter.py` | Metrics + Tracing Span |
| 修改 | `src/cabinet/core/events/asyncio_bus.py` | Metrics + Tracing Span |
| 修改 | `src/cabinet/core/events/sqlite_store.py` | DB 操作 Metrics |
| 修改 | `src/cabinet/core/events/sqlite_room_store.py` | DB 操作 Metrics |
| 修改 | `src/cabinet/core/memory/vector_store.py` | Vector 操作 Metrics |
| 修改 | `src/cabinet/core/knowledge/local_kb.py` | Vector 操作 Metrics |
| 修改 | `src/cabinet/rooms/decision/service.py` | ROOM_OPERATION Metrics + 审计日志 |
| 修改 | `src/cabinet/rooms/office/service.py` | ROOM_OPERATION Metrics |
| 修改 | `src/cabinet/rooms/meeting/service.py` | ROOM_OPERATION Metrics |
| 修改 | `src/cabinet/rooms/strategy/service.py` | ROOM_OPERATION Metrics |
| 修改 | `src/cabinet/rooms/summary/service.py` | ROOM_OPERATION Metrics |
| 修改 | `src/cabinet/rooms/secretary/service.py` | ROOM_OPERATION Metrics + Tracing Span |
| 修改 | `pyproject.toml` | 新增 6 个依赖 |
| 修改 | `Dockerfile` | 暴露 Prometheus 9090 端口 |
| 修改 | `docker-compose.yml` | 添加 Prometheus 端口映射 + OTLP 环境变量 |
| 修改 | `.github/workflows/ci.yml` | 添加可观测性相关测试 |

---

### Task 1: 质量验证收尾

**Files:**
- Test: `tests/` (全量)

- [ ] **Step 1: 运行全量测试**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/ -v --tb=short 2>&1 | Select-Object -Last 60`

Expected: 所有测试通过。如有失败，记录失败测试名称和原因。

- [ ] **Step 2: 运行 lint 检查**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; ruff check src/ tests/`

Expected: 无 lint 错误。如有错误，修复后重新运行。

- [ ] **Step 3: 修复任何失败的测试或 lint 错误**

如果 Step 1 或 Step 2 有问题，在此修复。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "fix: resolve test/lint issues before observability work"
```

---

### Task 2: 可观测性核心模块

**Files:**
- Create: `src/cabinet/core/observability.py`
- Create: `tests/unit/core/test_observability.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: 添加新依赖到 pyproject.toml**

在 `pyproject.toml` 的 `dependencies` 列表中添加：

```toml
    "prometheus-client>=0.20",
    "opentelemetry-api>=1.25",
    "opentelemetry-sdk>=1.25",
    "opentelemetry-instrumentation-fastapi>=0.46b0",
    "opentelemetry-exporter-otlp-proto-http>=1.25",
    "cryptography>=42.0",
```

- [ ] **Step 2: 安装新依赖**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pip install -e ".[dev]"`

- [ ] **Step 3: 编写 observability.py 的失败测试**

创建 `tests/unit/core/test_observability.py`：

```python
from __future__ import annotations

import json
import logging

import pytest


def test_observability_config_defaults():
    from cabinet.core.observability import ObservabilityConfig

    config = ObservabilityConfig()
    assert config.enabled is True
    assert config.service_name == "cabinet"
    assert config.log_level == "INFO"
    assert config.log_format == "json"
    assert config.otlp_endpoint is None
    assert config.prometheus_port == 9090


def test_setup_logging_json_format():
    from cabinet.core.observability import ObservabilityConfig, setup_logging

    config = ObservabilityConfig(log_format="json", log_level="DEBUG")
    setup_logging(config)
    root = logging.getLogger()
    assert root.level == logging.DEBUG
    handler = root.handlers[0]
    from cabinet.core.observability import JsonFormatter

    assert isinstance(handler.formatter, JsonFormatter)


def test_setup_logging_text_format():
    from cabinet.core.observability import ObservabilityConfig, setup_logging

    config = ObservabilityConfig(log_format="text", log_level="INFO")
    setup_logging(config)
    root = logging.getLogger()
    handler = root.handlers[0]
    assert not isinstance(handler.formatter, JsonFormatter)


def test_setup_logging_backward_compat():
    from cabinet.core.observability import setup_logging

    setup_logging(level="WARNING")
    root = logging.getLogger()
    assert root.level == logging.WARNING


def test_json_formatter_output():
    from cabinet.core.observability import JsonFormatter

    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname="", lineno=0,
        msg="hello", args=(), exc_info=None,
    )
    output = formatter.format(record)
    data = json.loads(output)
    assert data["level"] == "INFO"
    assert data["logger"] == "test"
    assert data["message"] == "hello"
    assert "timestamp" in data


def test_trace_injecting_filter():
    from cabinet.core.observability import TraceInjectingFilter

    filt = TraceInjectingFilter()
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname="", lineno=0,
        msg="msg", args=(), exc_info=None,
    )
    result = filt.filter(record)
    assert result is True
    assert hasattr(record, "trace_id")
    assert hasattr(record, "span_id")


def test_metrics_registered():
    from cabinet.core.observability import (
        REQUEST_COUNT, REQUEST_LATENCY, LLM_CALL_COUNT,
        LLM_CALL_LATENCY, LLM_TOKEN_USAGE, EVENT_PUBLISHED,
        ROOM_OPERATION, DB_OPERATION_LATENCY, VECTOR_OPERATION_LATENCY,
        ACTIVE_CONNECTIONS, STARTUP_TIME,
    )
    assert REQUEST_COUNT is not None
    assert REQUEST_LATENCY is not None
    assert LLM_CALL_COUNT is not None
    assert LLM_CALL_LATENCY is not None
    assert LLM_TOKEN_USAGE is not None
    assert EVENT_PUBLISHED is not None
    assert ROOM_OPERATION is not None
    assert DB_OPERATION_LATENCY is not None
    assert VECTOR_OPERATION_LATENCY is not None
    assert ACTIVE_CONNECTIONS is not None
    assert STARTUP_TIME is not None


def test_setup_tracing_creates_provider():
    from cabinet.core.observability import ObservabilityConfig, setup_tracing

    config = ObservabilityConfig()
    provider = setup_tracing(config)
    assert provider is not None


def test_get_tracer():
    from cabinet.core.observability import get_tracer

    tracer = get_tracer("test")
    assert tracer is not None


def test_get_registry():
    from cabinet.core.observability import get_registry

    registry = get_registry()
    assert registry is not None


def test_setup_observability_disabled():
    from cabinet.core.observability import ObservabilityConfig, setup_observability

    config = ObservabilityConfig(enabled=False)
    setup_observability(config)
```

- [ ] **Step 4: 运行测试确认失败**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/test_observability.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.observability'`

- [ ] **Step 5: 实现 observability.py**

创建 `src/cabinet/core/observability.py`：

```python
from __future__ import annotations

import json
import logging
import time

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.resources import Resource
from prometheus_client import Counter, Gauge, Histogram, Registry


class ObservabilityConfig:
    def __init__(
        self,
        enabled: bool = True,
        service_name: str = "cabinet",
        log_level: str = "INFO",
        log_format: str = "json",
        otlp_endpoint: str | None = None,
        prometheus_port: int = 9090,
    ):
        self.enabled = enabled
        self.service_name = service_name
        self.log_level = log_level
        self.log_format = log_format
        self.otlp_endpoint = otlp_endpoint
        self.prometheus_port = prometheus_port


PROMETHEUS_REGISTRY = Registry()

REQUEST_COUNT = Counter(
    "cabinet_http_requests_total",
    "HTTP request count",
    ["method", "endpoint", "status"],
    registry=PROMETHEUS_REGISTRY,
)
REQUEST_LATENCY = Histogram(
    "cabinet_http_request_duration_seconds",
    "HTTP request latency",
    ["method", "endpoint"],
    registry=PROMETHEUS_REGISTRY,
)
LLM_CALL_COUNT = Counter(
    "cabinet_llm_calls_total",
    "LLM call count",
    ["model", "status"],
    registry=PROMETHEUS_REGISTRY,
)
LLM_CALL_LATENCY = Histogram(
    "cabinet_llm_call_duration_seconds",
    "LLM call latency",
    ["model"],
    registry=PROMETHEUS_REGISTRY,
)
LLM_TOKEN_USAGE = Counter(
    "cabinet_llm_tokens_total",
    "LLM token usage",
    ["model", "type"],
    registry=PROMETHEUS_REGISTRY,
)
EVENT_PUBLISHED = Counter(
    "cabinet_events_published_total",
    "Events published",
    ["message_type"],
    registry=PROMETHEUS_REGISTRY,
)
ROOM_OPERATION = Counter(
    "cabinet_room_operations_total",
    "Room operations",
    ["room", "operation"],
    registry=PROMETHEUS_REGISTRY,
)
DB_OPERATION_LATENCY = Histogram(
    "cabinet_db_operation_duration_seconds",
    "DB operation latency",
    ["store", "operation"],
    registry=PROMETHEUS_REGISTRY,
)
VECTOR_OPERATION_LATENCY = Histogram(
    "cabinet_vector_operation_duration_seconds",
    "Vector operation latency",
    ["operation"],
    registry=PROMETHEUS_REGISTRY,
)
ACTIVE_CONNECTIONS = Gauge(
    "cabinet_active_connections",
    "Active WebSocket connections",
    registry=PROMETHEUS_REGISTRY,
)
STARTUP_TIME = Gauge(
    "cabinet_startup_seconds",
    "Runtime startup time in seconds",
    registry=PROMETHEUS_REGISTRY,
)


class TraceInjectingFilter(logging.Filter):
    def filter(self, record):
        span = trace.get_current_span()
        ctx = span.get_span_context()
        record.trace_id = format(ctx.trace_id, "032x") if ctx.is_valid else ""
        record.span_id = format(ctx.span_id, "016x") if ctx.is_valid else ""
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record):
        log_entry = {
            "timestamp": self.formatTime(record),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "trace_id": getattr(record, "trace_id", ""),
            "span_id": getattr(record, "span_id", ""),
        }
        if record.exc_info and record.exc_info[1]:
            log_entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(log_entry, ensure_ascii=False)


def setup_logging(config: ObservabilityConfig | None = None, level: str = "INFO") -> None:
    if config is None:
        config = ObservabilityConfig(log_level=level)
    root = logging.getLogger()
    root.setLevel(config.log_level)
    handler = logging.StreamHandler()
    if config.log_format == "json":
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
                " | trace_id=%(trace_id)s span_id=%(span_id)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
    handler.addFilter(TraceInjectingFilter())
    root.handlers.clear()
    root.addHandler(handler)


def setup_tracing(config: ObservabilityConfig) -> TracerProvider:
    resource = Resource.create({"service.name": config.service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    if config.otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

        exporter = OTLPSpanExporter(endpoint=config.otlp_endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    return provider


def setup_observability(config: ObservabilityConfig) -> None:
    if not config.enabled:
        return
    setup_logging(config)
    setup_tracing(config)


def get_tracer(name: str = "cabinet"):
    return trace.get_tracer(name)


def get_registry() -> Registry:
    return PROMETHEUS_REGISTRY
```

- [ ] **Step 6: 运行测试确认通过**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/test_observability.py -v`

Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/core/observability.py tests/unit/core/test_observability.py pyproject.toml
git commit -m "feat: add observability core module (metrics + tracing + logging)"
```

---

### Task 3: 替换 logging.py + CabinetConfig 扩展

**Files:**
- Delete: `src/cabinet/core/logging.py`
- Modify: `src/cabinet/cli/config.py`
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: 更新 main.py 中的 logging 导入**

在 `src/cabinet/cli/main.py` 第 123 行，将：

```python
    from cabinet.core.logging import setup_logging
```

替换为：

```python
    from cabinet.core.observability import setup_logging
```

- [ ] **Step 2: 添加 ObservabilitySettings 到 config.py**

在 `src/cabinet/cli/config.py` 中，在 `CabinetConfig` 类之前添加：

```python
class ObservabilitySettings(BaseModel):
    enabled: bool = True
    log_format: str = "json"
    otlp_endpoint: str | None = None
    prometheus_port: int = 9090
```

在 `CabinetConfig` 类中，在 `created_at` 字段之后添加：

```python
    observability: ObservabilitySettings = ObservabilitySettings()
    vault_enabled: bool = False
```

- [ ] **Step 3: 删除旧 logging.py**

删除 `src/cabinet/core/logging.py`

- [ ] **Step 4: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/ -v --tb=short 2>&1 | Select-Object -Last 30`

Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "refactor: replace logging.py with observability module, extend CabinetConfig"
```

---

### Task 4: Health Check 端点

**Files:**
- Create: `src/cabinet/api/routes/health.py`
- Create: `tests/unit/api/test_health.py`
- Modify: `src/cabinet/api/models.py`
- Modify: `src/cabinet/runtime.py`
- Modify: `src/cabinet/api/app.py`

- [ ] **Step 1: 添加 Health 响应模型到 models.py**

在 `src/cabinet/api/models.py` 末尾添加：

```python
class ComponentHealth(BaseModel):
    name: str
    status: str
    detail: str = ""
    latency_ms: float = 0.0


class HealthResponse(BaseModel):
    status: str
    version: str
    components: list[ComponentHealth]
    uptime_seconds: float
```

- [ ] **Step 2: 编写 health 端点失败测试**

创建 `tests/unit/api/test_health.py`：

```python
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.fixture
def mock_runtime():
    runtime = MagicMock()
    runtime.health_check = AsyncMock(return_value={
        "status": "healthy", "version": "0.1.0", "components": [], "uptime_seconds": 1.0,
    })
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
    from httpx import AsyncClient, ASGITransport
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_liveness(client):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["version"] == "0.1.0"


async def test_readiness(client, mock_runtime):
    response = await client.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    mock_runtime.health_check.assert_awaited_once()
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/api/test_health.py -v`

Expected: FAIL — 路由不存在

- [ ] **Step 4: 在 Runtime 中添加 health_check 和子系统检查方法**

在 `src/cabinet/runtime.py` 中：

1. 在文件顶部 `import logging` 之后添加：

```python
import time as _time
```

2. 在 `CabinetRuntime.__init__` 方法末尾（`self._room_stores = [...]` 之后）添加：

```python
        self._start_time = _time.monotonic()
```

3. 在 `CabinetRuntime` 类的 `stop` 方法之后、属性方法之前，添加：

```python
    async def health_check(self) -> dict:
        import asyncio as _asyncio

        components: list[dict] = []

        async def _check(name: str, coro) -> dict:
            start = _time.monotonic()
            try:
                result = await _asyncio.wait_for(coro, timeout=5.0)
                latency = (_time.monotonic() - start) * 1000
                return {
                    "name": name,
                    "status": result.get("status", "healthy"),
                    "detail": result.get("detail", ""),
                    "latency_ms": round(latency, 2),
                }
            except Exception as e:
                latency = (_time.monotonic() - start) * 1000
                return {
                    "name": name, "status": "unhealthy",
                    "detail": str(e), "latency_ms": round(latency, 2),
                }

        checks = []
        checks.append(_check("sqlite_event_store", self._check_sqlite()))
        if self._memory_store is not None:
            checks.append(_check("chromadb_memory", self._check_chromadb_memory()))
        if self._knowledge_base is not None:
            checks.append(_check("chromadb_knowledge", self._check_chromadb_knowledge()))
        if self._gateway is not None:
            checks.append(_check("llm_gateway", self._check_gateway()))
        if self._mcp_connector is not None:
            checks.append(_check("mcp_connector", self._check_mcp()))
        checks.append(_check("eventbus", self._check_eventbus()))

        components = await _asyncio.gather(*checks)

        overall = "healthy"
        for c in components:
            if c["status"] == "unhealthy":
                overall = "unhealthy"
                break
            if c["status"] == "degraded" and overall == "healthy":
                overall = "degraded"

        return {
            "status": overall,
            "version": "0.1.0",
            "components": components,
            "uptime_seconds": _time.monotonic() - self._start_time,
        }

    async def _check_sqlite(self) -> dict:
        try:
            if self._db_path and hasattr(self._event_store, "_db") and self._event_store._db:
                import aiosqlite
                await self._event_store._db.execute("SELECT 1")
            return {"status": "healthy"}
        except Exception as e:
            return {"status": "unhealthy", "detail": str(e)}

    async def _check_chromadb_memory(self) -> dict:
        try:
            count = self._memory_store._collection.count()
            return {"status": "healthy", "detail": f"count={count}"}
        except Exception as e:
            return {"status": "degraded", "detail": str(e)}

    async def _check_chromadb_knowledge(self) -> dict:
        try:
            count = self._knowledge_base._collection.count()
            return {"status": "healthy", "detail": f"count={count}"}
        except Exception as e:
            return {"status": "degraded", "detail": str(e)}

    async def _check_gateway(self) -> dict:
        return {"status": "healthy", "detail": "gateway configured"}

    async def _check_mcp(self) -> dict:
        try:
            servers = await self._mcp_connector.list_connected_servers()
            return {"status": "healthy", "detail": f"servers={len(servers)}"}
        except Exception as e:
            return {"status": "healthy", "detail": str(e)}

    async def _check_eventbus(self) -> dict:
        handler_count = sum(len(v) for v in self._bus._handlers.values())
        if handler_count > 0:
            return {"status": "healthy", "detail": f"handlers={handler_count}"}
        return {"status": "unhealthy", "detail": "no handlers registered"}
```

4. 无需在 TYPE_CHECKING 块中添加额外导入（health_check 返回 dict，不依赖 api 层）

- [ ] **Step 5: 创建 health 路由**

创建 `src/cabinet/api/routes/health.py`：

```python
from __future__ import annotations

import time

from fastapi import APIRouter, Request

from cabinet.api.models import ComponentHealth, HealthResponse

router = APIRouter()

_start_time: float = time.monotonic()


@router.get("/health", response_model=HealthResponse)
async def liveness():
    return HealthResponse(
        status="healthy",
        version="0.1.0",
        components=[],
        uptime_seconds=time.monotonic() - _start_time,
    )


@router.get("/ready", response_model=HealthResponse)
async def readiness(request: Request):
    runtime = request.app.state.runtime
    result = await runtime.health_check()
    return HealthResponse(
        status=result["status"],
        version=result["version"],
        components=[ComponentHealth(**c) for c in result["components"]],
        uptime_seconds=result["uptime_seconds"],
    )
```

- [ ] **Step 6: 注册 health 路由到 app.py**

在 `src/cabinet/api/app.py` 中：

1. 在路由导入行（第 54 行）之后添加：

```python
    from cabinet.api.routes import health
```

2. 在路由注册块（第 61 行之后）添加：

```python
    app.include_router(health.router, tags=["Health"])
```

- [ ] **Step 7: 运行测试确认通过**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/api/test_health.py -v`

Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: add health check endpoints (/health, /ready)"
```

---

### Task 5: HTTP 层 Prometheus Middleware + OTel FastAPI Instrumentation

**Files:**
- Modify: `src/cabinet/api/app.py`

- [ ] **Step 1: 添加 Prometheus middleware 和 OTel instrumentation 到 app.py**

在 `src/cabinet/api/app.py` 中：

1. 在文件顶部 `import logging` 之后添加：

```python
import time
```

2. 在 `create_app` 函数中，在 `app.add_middleware(CORSMiddleware, ...)` 块之后添加：

```python
    from cabinet.core.observability import REQUEST_COUNT, REQUEST_LATENCY

    @app.middleware("http")
    async def prometheus_middleware(request: Request, call_next):
        start = time.monotonic()
        response = await call_next(request)
        duration = time.monotonic() - start
        endpoint = request.url.path
        REQUEST_COUNT.labels(
            method=request.method, endpoint=endpoint, status=response.status_code
        ).inc()
        REQUEST_LATENCY.labels(method=request.method, endpoint=endpoint).observe(duration)
        return response

    @app.middleware("http")
    async def input_sanitization_middleware(request: Request, call_next):
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > 1_000_000:
            from fastapi.responses import JSONResponse
            return JSONResponse(status_code=413, content={"error": "Payload too large"})
        return await call_next(request)
```

3. 在路由注册块之后（health 路由注册之后）添加：

```python
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        FastAPIInstrumentor.instrument_app(app)
    except ImportError:
        pass
```

4. 在文件顶部添加 `Request` 导入：

```python
from fastapi import FastAPI, Request
```

- [ ] **Step 2: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/api/ -v --tb=short 2>&1 | Select-Object -Last 30`

Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/cabinet/api/app.py
git commit -m "feat: add Prometheus middleware, OTel instrumentation, input sanitization"
```

---

### Task 6: LLM Gateway Metrics + Tracing

**Files:**
- Modify: `src/cabinet/core/gateway/litellm_adapter.py`

- [ ] **Step 1: 添加 Metrics 和 Tracing 到 litellm_adapter.py**

在 `src/cabinet/core/gateway/litellm_adapter.py` 中：

1. 在文件顶部 `import logging` 之后添加：

```python
import time
```

2. 在 `logger = logging.getLogger(__name__)` 之后添加：

```python
try:
    from cabinet.core.observability import (
        LLM_CALL_COUNT, LLM_CALL_LATENCY, LLM_TOKEN_USAGE, get_tracer,
    )
    _tracer = get_tracer("cabinet.gateway")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False
```

3. 替换 `complete` 方法（第 47-67 行）为：

```python
    async def complete(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> ModelResponse:
        start = time.monotonic()
        span = None
        if _OBSERVABILITY_ENABLED:
            span = _tracer.start_as_current_span("llm.complete")
            span.__enter__()
            span.set_attribute("llm.model", model)
        try:
            response = await self._router.acompletion(
                model=model,
                messages=messages,
                temperature=temperature,
                **kwargs,
            )
            usage = {}
            if response.usage:
                usage = {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                }
            logger.info("LLM complete: model=%s tokens=%s", model, usage)
            if _OBSERVABILITY_ENABLED:
                duration = time.monotonic() - start
                LLM_CALL_COUNT.labels(model=model, status="success").inc()
                LLM_CALL_LATENCY.labels(model=model).observe(duration)
                if response.usage:
                    LLM_TOKEN_USAGE.labels(model=model, type="prompt").inc(
                        response.usage.prompt_tokens or 0
                    )
                    LLM_TOKEN_USAGE.labels(model=model, type="completion").inc(
                        response.usage.completion_tokens or 0
                    )
                    if span:
                        span.set_attribute("llm.tokens.prompt", response.usage.prompt_tokens or 0)
                        span.set_attribute("llm.tokens.completion", response.usage.completion_tokens or 0)
            return ModelResponse(
                content=response.choices[0].message.content,
                model=model,
                usage=usage,
            )
        except Exception as e:
            if _OBSERVABILITY_ENABLED:
                LLM_CALL_COUNT.labels(model=model, status="error").inc()
                if span:
                    span.set_attribute("error", True)
                    span.set_attribute("error.message", str(e))
            raise
        finally:
            if span:
                span.__exit__(None, None, None)
```

4. 替换 `stream` 方法（第 69-82 行）为：

```python
    async def stream(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> AsyncIterator[ModelChunk]:
        logger.info("LLM stream start: model=%s", model)
        start = time.monotonic()
        chunk_count = 0
        span = None
        if _OBSERVABILITY_ENABLED:
            span = _tracer.start_as_current_span("llm.stream")
            span.__enter__()
            span.set_attribute("llm.model", model)
        try:
            async for chunk in await self._router.acompletion(
                model=model,
                messages=messages,
                temperature=temperature,
                stream=True,
                **kwargs,
            ):
                delta = chunk.choices[0].delta
                if delta.content:
                    chunk_count += 1
                    yield ModelChunk(content=delta.content, model=model)
        finally:
            if _OBSERVABILITY_ENABLED:
                duration = time.monotonic() - start
                LLM_CALL_COUNT.labels(model=model, status="success").inc()
                LLM_CALL_LATENCY.labels(model=model).observe(duration)
                if span:
                    span.set_attribute("llm.chunks.count", chunk_count)
            if span:
                span.__exit__(None, None, None)
```

- [ ] **Step 2: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/gateway/ -v --tb=short`

Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/cabinet/core/gateway/litellm_adapter.py
git commit -m "feat: add metrics and tracing to LLM gateway"
```

---

### Task 7: EventBus Metrics + Tracing

**Files:**
- Modify: `src/cabinet/core/events/asyncio_bus.py`

- [ ] **Step 1: 添加 Metrics 和 Tracing 到 asyncio_bus.py**

在 `src/cabinet/core/events/asyncio_bus.py` 中：

1. 在文件顶部导入之后添加：

```python
try:
    from cabinet.core.observability import EVENT_PUBLISHED, get_tracer
    _tracer = get_tracer("cabinet.eventbus")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False
```

2. 替换 `publish` 方法（第 15-19 行）为：

```python
    async def publish(self, envelope: MessageEnvelope) -> None:
        if _OBSERVABILITY_ENABLED:
            EVENT_PUBLISHED.labels(message_type=envelope.message_type).inc()
        span = None
        if _OBSERVABILITY_ENABLED:
            span = _tracer.start_as_current_span("eventbus.publish")
            span.__enter__()
            span.set_attribute("event.type", envelope.message_type)
            span.set_attribute("event.source", envelope.source_room or "")
        try:
            await self._store.append(envelope)
            handlers = self._handlers.get(envelope.message_type, [])
            for handler in handlers:
                await handler(envelope)
        finally:
            if span:
                span.__exit__(None, None, None)
```

- [ ] **Step 2: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/events/ -v --tb=short 2>&1 | Select-Object -Last 30`

Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/cabinet/core/events/asyncio_bus.py
git commit -m "feat: add metrics and tracing to event bus"
```

---

### Task 8: Room Service Metrics

**Files:**
- Modify: `src/cabinet/rooms/decision/service.py`
- Modify: `src/cabinet/rooms/office/service.py`
- Modify: `src/cabinet/rooms/meeting/service.py`
- Modify: `src/cabinet/rooms/strategy/service.py`
- Modify: `src/cabinet/rooms/summary/service.py`
- Modify: `src/cabinet/rooms/secretary/service.py`

- [ ] **Step 1: 在每个 Room Service 中添加 ROOM_OPERATION 计数**

对以下 6 个文件，在文件顶部添加导入（在现有导入之后）：

```python
try:
    from cabinet.core.observability import ROOM_OPERATION
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False
```

然后在每个关键方法的第一行添加计数器调用：

**decision/service.py** — 在 `submit`, `approve`, `reject` 方法开头添加：

```python
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="decision", operation="submit").inc()
```

（对应 `approve` 用 `operation="approve"`，`reject` 用 `operation="reject"`）

**office/service.py** — 在 `submit_task`, `execute_workflow` 方法开头添加：

```python
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="office", operation="submit_task").inc()
```

（`execute_workflow` 用 `operation="execute_workflow"`）

**meeting/service.py** — 在 `start_session`, `converge` 方法开头添加：

```python
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="meeting", operation="start_session").inc()
```

（`converge` 用 `operation="converge"`）

**strategy/service.py** — 在 `decode` 方法开头添加：

```python
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="strategy", operation="decode").inc()
```

**summary/service.py** — 在 `start_review` 方法开头添加：

```python
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="summary", operation="start_review").inc()
```

**secretary/service.py** — 在 `process_input` 方法开头添加：

```python
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="secretary", operation="process_input").inc()
```

在 `process_input_stream` 方法开头添加：

```python
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="secretary", operation="process_input_stream").inc()
```

- [ ] **Step 2: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/rooms/ -v --tb=short 2>&1 | Select-Object -Last 30`

Expected: 全部 PASS

- [ ] **Step 3: 提交**

```bash
git add src/cabinet/rooms/
git commit -m "feat: add ROOM_OPERATION metrics to all room services"
```

---

### Task 9: 基础设施层 Metrics

**Files:**
- Modify: `src/cabinet/core/events/sqlite_store.py`
- Modify: `src/cabinet/core/events/sqlite_room_store.py`
- Modify: `src/cabinet/core/memory/vector_store.py`
- Modify: `src/cabinet/core/knowledge/local_kb.py`
- Modify: `src/cabinet/api/routes/chat.py`

- [ ] **Step 1: 添加 DB 操作 Metrics 到 sqlite_store.py**

在 `src/cabinet/core/events/sqlite_store.py` 中：

1. 在文件顶部导入之后添加：

```python
try:
    from cabinet.core.observability import DB_OPERATION_LATENCY
    import time as _time
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False
```

2. 在 `append` 方法中，在 `await self._db.execute(...)` 之前添加计时开始，在 `await self._db.commit()` 之后添加计时结束和指标记录：

将 `append` 方法改为：

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

- [ ] **Step 2: 添加 DB 操作 Metrics 到 sqlite_room_store.py**

在 `src/cabinet/core/events/sqlite_room_store.py` 中：

1. 在文件顶部导入之后添加：

```python
try:
    from cabinet.core.observability import DB_OPERATION_LATENCY
    import time as _time
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False
```

2. 在 `flush` 方法中添加计时：

将 `flush` 方法改为：

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

- [ ] **Step 3: 添加 Vector 操作 Metrics 到 vector_store.py**

在 `src/cabinet/core/memory/vector_store.py` 中：

1. 在文件顶部 `import logging` 之后添加：

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

3. 在 `search` 方法中添加计时：

将 `search` 方法改为：

```python
    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        count = self._collection.count()
        if count == 0:
            return []
        results = self._collection.query(
            query_texts=[query],
            n_results=min(limit, count),
            where={"scope": scope.value},
        )
        items = []
        for i, doc in enumerate(results["documents"][0]):
            metadata = results["metadatas"][0][i]
            items.append(
                MemoryItem(
                    owner_id=UUID(metadata["owner_id"]),
                    scope=scope,
                    content=doc,
                )
            )
        if _OBSERVABILITY_ENABLED:
            VECTOR_OPERATION_LATENCY.labels(operation="search").observe(
                _time.monotonic() - start
            )
        return items
```

- [ ] **Step 4: 添加 Vector 操作 Metrics 到 local_kb.py**

在 `src/cabinet/core/knowledge/local_kb.py` 中：

1. 在文件顶部 `import logging` 之后添加：

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

3. 在 `query` 方法中添加计时：

将 `query` 方法改为：

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

- [ ] **Step 5: 添加 WebSocket Gauge 到 chat.py**

在 `src/cabinet/api/routes/chat.py` 中：

1. 在文件顶部导入之后添加：

```python
try:
    from cabinet.core.observability import ACTIVE_CONNECTIONS
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False
```

2. 在 `chat_ws` 函数中，在 `await websocket.accept()` 之后添加：

```python
    if _OBSERVABILITY_ENABLED:
        ACTIVE_CONNECTIONS.inc()
```

3. 在 `except WebSocketDisconnect:` 之前添加 finally 块，将现有的 try 块改为：

```python
    try:
        while True:
            data = await websocket.receive_text()
            if data == "/quit":
                await websocket.close()
                break

            from cabinet.rooms.secretary.models import InteractionContext

            context = InteractionContext(captain_id=captain_id, channel="api")
            response = runtime.secretary.process_input_stream(data, context)
            async for chunk in response.stream:
                await websocket.send_json({"type": "chunk", "content": chunk})
            await response.finalize()
            await websocket.send_json({"type": "done"})
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected: captain=%s", captain_id)
        pass
    finally:
        if _OBSERVABILITY_ENABLED:
            ACTIVE_CONNECTIONS.dec()
```

- [ ] **Step 6: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/ -v --tb=short 2>&1 | Select-Object -Last 30`

Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/core/events/ src/cabinet/core/memory/ src/cabinet/core/knowledge/ src/cabinet/api/routes/chat.py
git commit -m "feat: add infrastructure layer metrics (DB, vector, WebSocket gauge)"
```

---

### Task 10: 安全加固 — KeyVault

**Files:**
- Create: `src/cabinet/core/security.py`
- Create: `tests/unit/core/test_security.py`

- [ ] **Step 1: 编写 KeyVault 失败测试**

创建 `tests/unit/core/test_security.py`：

```python
from __future__ import annotations

import os
import tempfile

import pytest


def test_generate_master_key():
    from cabinet.core.security import KeyVault

    key = KeyVault.generate_master_key()
    assert isinstance(key, str)
    assert len(key) > 0


def test_encrypt_decrypt_roundtrip():
    from cabinet.core.security import KeyVault

    key = KeyVault.generate_master_key()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".key", delete=False) as f:
        f.write(key)
        key_path = f.name
    try:
        vault = KeyVault(key_path)
        plaintext = "sk-test-api-key-12345"
        encrypted = vault.encrypt(plaintext)
        assert encrypted != plaintext
        decrypted = vault.decrypt(encrypted)
        assert decrypted == plaintext
    finally:
        os.unlink(key_path)


def test_store_and_retrieve_key():
    from cabinet.core.security import KeyVault

    key = KeyVault.generate_master_key()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".key", delete=False) as key_f:
        key_f.write(key)
        key_path = key_f.name
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as cfg_f:
        cfg_f.write("{}")
        config_path = cfg_f.name
    try:
        vault = KeyVault(key_path)
        vault.store_key(config_path, "openai_api_key", "sk-test-key")
        result = vault.retrieve_key(config_path, "openai_api_key")
        assert result == "sk-test-key"
    finally:
        os.unlink(key_path)
        os.unlink(config_path)


def test_retrieve_missing_key():
    from cabinet.core.security import KeyVault

    key = KeyVault.generate_master_key()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".key", delete=False) as key_f:
        key_f.write(key)
        key_path = key_f.name
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as cfg_f:
        cfg_f.write("{}")
        config_path = cfg_f.name
    try:
        vault = KeyVault(key_path)
        result = vault.retrieve_key(config_path, "nonexistent")
        assert result is None
    finally:
        os.unlink(key_path)
        os.unlink(config_path)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/test_security.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.security'`

- [ ] **Step 3: 实现 security.py**

创建 `src/cabinet/core/security.py`：

```python
from __future__ import annotations

import json

from cryptography.fernet import Fernet


class KeyVault:
    def __init__(self, master_key_path: str):
        with open(master_key_path, "rb") as f:
            self._fernet = Fernet(f.read().strip())

    @staticmethod
    def generate_master_key() -> str:
        return Fernet.generate_key().decode()

    def encrypt(self, plaintext: str) -> str:
        return self._fernet.encrypt(plaintext.encode()).decode()

    def decrypt(self, ciphertext: str) -> str:
        return self._fernet.decrypt(ciphertext.encode()).decode()

    def store_key(self, config_path: str, name: str, value: str) -> None:
        with open(config_path) as f:
            config = json.load(f)
        vault = config.setdefault("vault", {})
        vault[name] = self.encrypt(value)
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

    def retrieve_key(self, config_path: str, name: str) -> str | None:
        with open(config_path) as f:
            config = json.load(f)
        encrypted = config.get("vault", {}).get(name)
        if encrypted is None:
            return None
        return self.decrypt(encrypted)
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/test_security.py -v`

Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/security.py tests/unit/core/test_security.py
git commit -m "feat: add KeyVault for encrypted API key storage"
```

---

### Task 11: 安全加固 — 输入校验 + 审计日志

**Files:**
- Create: `src/cabinet/core/audit.py`
- Create: `tests/unit/core/test_audit.py`
- Modify: `src/cabinet/api/models.py`
- Modify: `src/cabinet/api/deps.py`

- [ ] **Step 1: 添加输入校验到 models.py**

在 `src/cabinet/api/models.py` 中：

1. 在文件顶部 `from pydantic import BaseModel` 改为：

```python
from pydantic import BaseModel, Field
```

2. 替换 `ChatRequest` 类为：

```python
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    captain_id: str = Field("captain", min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
```

3. 替换 `EmployeeCreate` 类为：

```python
class EmployeeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    role: str = Field(..., min_length=1, max_length=256)
    personality: str = Field("", max_length=2000)
    kind: str = "ai"
```

- [ ] **Step 2: 编写审计日志失败测试**

创建 `tests/unit/core/test_audit.py`：

```python
from __future__ import annotations

import os
import tempfile

import pytest

from cabinet.core.audit import AuditEvent, AuditStore


async def test_audit_store_initialize_and_log():
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


async def test_audit_event_defaults():
    from datetime import datetime, timezone

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
```

- [ ] **Step 3: 运行测试确认失败**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/test_audit.py -v`

Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.audit'`

- [ ] **Step 4: 实现 audit.py**

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

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/unit/core/test_audit.py -v`

Expected: 全部 PASS

- [ ] **Step 6: 添加审计日志到 deps.py**

在 `src/cabinet/api/deps.py` 中：

1. 在 `get_current_user` 函数中，在 `return credentials.credentials` 之前添加审计日志：

```python
    try:
        from cabinet.core.audit import AuditEvent
        runtime = request.app.state.runtime
        if hasattr(runtime, "_audit_store") and runtime._audit_store is not None:
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

- [ ] **Step 7: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/ -v --tb=short 2>&1 | Select-Object -Last 30`

Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add src/cabinet/core/audit.py tests/unit/core/test_audit.py src/cabinet/api/models.py src/cabinet/api/deps.py
git commit -m "feat: add audit logging and input validation"
```

---

### Task 12: CLI 集成 + Runtime 审计 + Docker/CI 更新

**Files:**
- Modify: `src/cabinet/runtime.py`
- Modify: `src/cabinet/cli/main.py`
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: 在 Runtime 中添加 AuditStore**

在 `src/cabinet/runtime.py` 中：

1. 在 `CabinetRuntime.__init__` 方法的 `self._start_time = _time.monotonic()` 之后添加：

```python
        self._audit_store = None
        if db_path:
            from cabinet.core.audit import AuditStore
            self._audit_store = AuditStore(os.path.join(os.path.dirname(db_path), "audit.db"))
```

2. 在文件顶部 `import time as _time` 之后添加：

```python
import os
```

3. 在 `start` 方法中，在 `if self._db_path:` 块的开头添加：

```python
            if self._audit_store is not None:
                await self._audit_store.initialize()
```

4. 在 `stop` 方法中，在 `logger.info("CabinetRuntime stopped")` 之前添加：

```python
        if self._audit_store is not None:
            await self._audit_store.close()
```

- [ ] **Step 2: 更新 serve 命令集成可观测性**

在 `src/cabinet/cli/main.py` 中：

1. 替换 serve 命令中的日志初始化（第 122-125 行）为：

```python
    log_level = os.environ.get("CABINET_LOG_LEVEL", "INFO").upper()
    from cabinet.core.observability import ObservabilityConfig, setup_observability

    obs_config = ObservabilityConfig(log_level=log_level, log_format="json")
    setup_observability(obs_config)
```

2. 在 `_create_and_serve` 函数中，在 `api_app = create_app(runtime, config)` 之后添加：

```python
        if config.observability.enabled:
            from prometheus_client import start_http_server
            start_http_server(config.observability.prometheus_port)
```

- [ ] **Step 3: 添加 set-api-key 命令**

在 `src/cabinet/cli/main.py` 中，在 `knowledge_app` 定义之前添加：

```python
@app.command()
def set_api_key(
    key: str = typer.Argument(..., help="API key to store"),
    provider: str = typer.Option("openai", "--provider", help="Provider name"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    config_path = os.path.join(data_dir, "cabinet.json")
    master_key_path = os.path.join(data_dir, ".master_key")
    if not os.path.exists(config_path):
        console.print("[red]Error:[/red] Cabinet not initialized. Run 'cabinet init' first.")
        raise typer.Exit(code=1)
    if not os.path.exists(master_key_path):
        from cabinet.core.security import KeyVault
        master_key = KeyVault.generate_master_key()
        with open(master_key_path, "w") as f:
            f.write(master_key)
        import stat
        os.chmod(master_key_path, stat.S_IRUSR | stat.S_IWUSR)
    from cabinet.core.security import KeyVault
    vault = KeyVault(master_key_path)
    vault.store_key(config_path, f"{provider}_api_key", key)
    console.print(f"[green]API key for '{provider}' stored securely in vault.[/green]")
```

- [ ] **Step 4: 更新 _init_runtime 支持 vault 解密**

在 `src/cabinet/cli/main.py` 的 `_init_runtime` 函数中，在 `for provider, key in config.api_keys.items():` 行之前添加：

```python
    master_key_path = os.path.join(data_dir, ".master_key")
    if os.path.exists(master_key_path) and config.vault_enabled:
        from cabinet.core.security import KeyVault
        vault = KeyVault(master_key_path)
        for key_name in ["openai_api_key", "anthropic_api_key"]:
            decrypted = vault.retrieve_key(os.path.join(data_dir, "cabinet.json"), key_name)
            if decrypted:
                provider = key_name.replace("_api_key", "")
                os.environ.setdefault(f"{provider.upper()}_API_KEY", decrypted)
```

- [ ] **Step 5: 更新 Dockerfile**

在 `Dockerfile` 中，在 `EXPOSE 8000` 之后添加：

```dockerfile
EXPOSE 9090
```

- [ ] **Step 6: 更新 docker-compose.yml**

在 `docker-compose.yml` 的 `cabinet` service 中，在 `ports` 列表中添加：

```yaml
      - "9090:9090"
```

在 `environment` 列表中添加：

```yaml
      - CABINET_OBSERVABILITY_ENABLED=${CABINET_OBSERVABILITY_ENABLED:-true}
      - CABINET_OTLP_ENDPOINT=${OTLP_ENDPOINT:-}
```

- [ ] **Step 7: 运行测试确认无破坏**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/ -v --tb=short 2>&1 | Select-Object -Last 30`

Expected: 全部 PASS

- [ ] **Step 8: 提交**

```bash
git add src/cabinet/runtime.py src/cabinet/cli/main.py Dockerfile docker-compose.yml
git commit -m "feat: integrate observability into CLI, add audit store, update Docker"
```

---

### Task 13: 最终验证

**Files:**
- Test: `tests/` (全量)

- [ ] **Step 1: 运行全量测试**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; pytest tests/ -v --tb=short 2>&1 | Select-Object -Last 60`

Expected: 全部 PASS

- [ ] **Step 2: 运行 lint 检查**

Run: `cd c:\Users\dotty\Documents\trae_projects\Cabinet; ruff check src/ tests/`

Expected: 无 lint 错误

- [ ] **Step 3: 修复任何问题**

如果 Step 1 或 Step 2 有问题，在此修复。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore: final verification for observability and security hardening"
```
