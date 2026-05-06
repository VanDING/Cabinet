# 可观测性与安全加固设计

> 日期: 2026-05-04
> 状态: 已批准
> 方案: 全量一体化 (Metrics + Tracing + Structured Logging + Health Check + 安全加固)

## 1. 目标

在质量加固 Task 1-9 已实施的基础上，完成：

1. **Task 10 验证收尾** — 全量测试 + lint + 端到端验证
2. **统一可观测性核心** — Prometheus Metrics + OpenTelemetry Tracing + 结构化 JSON 日志 + trace_id 关联
3. **Health Check 端点** — `/health` 存活探针 + `/ready` 就绪探针
4. **全路径埋点** — HTTP 层 → LLM Gateway → 业务层 → 基础设施层
5. **安全加固** — API Key 加密存储 + 输入校验强化 + 操作审计日志

## 2. 新增依赖

```
# pyproject.toml dependencies 新增
"prometheus-client>=0.20",                        # Prometheus 指标采集
"opentelemetry-api>=1.25",                        # OTel API
"opentelemetry-sdk>=1.25",                        # OTel SDK
"opentelemetry-instrumentation-fastapi>=0.46b0",   # FastAPI 自动埋点
"opentelemetry-exporter-otlp-proto-http>=1.25",    # OTLP HTTP 导出
"cryptography>=42.0",                             # API Key 加密存储
```

## 3. 可观测性核心基础设施

### 3.1 新模块: `src/cabinet/core/observability.py`

统一管理 Metrics + Tracing + Structured Logging 的初始化和关联。

```python
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field

from opentelemetry import trace
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from prometheus_client import Counter, Histogram, Gauge, Registry


@dataclass
class ObservabilityConfig:
    enabled: bool = True
    service_name: str = "cabinet"
    log_level: str = "INFO"
    log_format: str = "json"
    otlp_endpoint: str | None = None
    prometheus_port: int = 9090


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
WORKFLOW_EXECUTION = Histogram(
    "cabinet_workflow_duration_seconds",
    "Workflow execution time",
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

    if config.otlp_endpoint:
        exporter = OTLPSpanExporter(endpoint=config.otlp_endpoint)
        provider.add_span_processor(BatchSpanProcessor(exporter))
    else:
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))

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

### 3.2 替换现有 `logging.py`

现有 `src/cabinet/core/logging.py` (12行) 将被 `observability.py` 中的 `setup_logging()` 完全替代。所有 `from cabinet.core.logging import setup_logging` 的引用改为 `from cabinet.core.observability import setup_logging`。`setup_logging()` 保持向后兼容签名 `setup_logging(level="INFO")`，同时支持新的 `ObservabilityConfig` 参数。

### 3.3 CabinetConfig 扩展

在 `src/cabinet/cli/config.py` 中添加：

```python
class ObservabilitySettings(BaseModel):
    enabled: bool = True
    log_format: str = "json"
    otlp_endpoint: str | None = None
    prometheus_port: int = 9090

class CabinetConfig(BaseModel):
    # ... 现有字段 ...
    observability: ObservabilitySettings = ObservabilitySettings()
    vault_enabled: bool = False
```

## 4. Health Check 端点

### 4.1 新路由: `src/cabinet/api/routes/health.py`

```python
from __future__ import annotations

import time
from fastapi import APIRouter, Request

from cabinet.api.models import HealthResponse, ComponentHealth

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
    return await runtime.health_check()
```

### 4.2 响应模型

在 `src/cabinet/api/models.py` 中添加：

```python
class ComponentHealth(BaseModel):
    name: str
    status: str          # "healthy" | "degraded" | "unhealthy"
    detail: str = ""
    latency_ms: float = 0.0

class HealthResponse(BaseModel):
    status: str          # "healthy" | "degraded" | "unhealthy"
    version: str
    components: list[ComponentHealth]
    uptime_seconds: float
```

### 4.3 Runtime.health_check()

在 `CabinetRuntime` 中添加：

```python
async def health_check(self) -> HealthResponse:
        import asyncio
        import time as _time

        components: list[ComponentHealth] = []

        async def _check(name: str, coro) -> ComponentHealth:
            start = _time.monotonic()
            try:
                result = await asyncio.wait_for(coro, timeout=5.0)
                latency = (_time.monotonic() - start) * 1000
                return ComponentHealth(
                    name=name,
                    status=result.get("status", "healthy"),
                    detail=result.get("detail", ""),
                    latency_ms=round(latency, 2),
                )
            except Exception as e:
                latency = (_time.monotonic() - start) * 1000
                return ComponentHealth(
                    name=name, status="unhealthy",
                    detail=str(e), latency_ms=round(latency, 2),
                )

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

        components = await asyncio.gather(*checks)

        overall = "healthy"
        for c in components:
            if c.status == "unhealthy":
                overall = "unhealthy"
                break
            if c.status == "degraded" and overall == "healthy":
                overall = "degraded"

        return HealthResponse(
            status=overall,
            version="0.1.0",
            components=components,
            uptime_seconds=_time.monotonic() - self._start_time,
        )

注意：`self._start_time` 需在 `CabinetRuntime.__init__` 中初始化为 `time.monotonic()`。
```

### 4.4 各子系统检查方法

| 组件 | 方法 | 检查逻辑 |
|------|------|---------|
| SQLite EventStore | `_check_sqlite()` | `SELECT 1`; unhealthy → 整体 unhealthy |
| ChromaDB MemoryStore | `_check_chromadb_memory()` | `collection.count()`; unhealthy → degraded |
| ChromaDB KnowledgeBase | `_check_chromadb_knowledge()` | `collection.count()`; unhealthy → degraded |
| LLM Gateway | `_check_gateway()` | 发送极简 prompt "ok"; unhealthy → degraded |
| MCP Connector | `_check_mcp()` | `list_connected_servers()`; 无连接仍 healthy |
| EventBus | `_check_eventbus()` | 已注册 handler 数 > 0; 0 → unhealthy |

### 4.5 路由注册

在 `app.py` 中：

```python
from cabinet.api.routes import health
app.include_router(health.router, tags=["Health"])
```

注意：health 路由不需要 `/api` 前缀，不需要认证。

## 5. Prometheus Metrics 埋点

### 5.1 HTTP 层 (FastAPI Middleware)

在 `create_app()` 中添加 Prometheus middleware：

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
```

### 5.2 LLM Gateway 层

修改 `src/cabinet/core/gateway/litellm_adapter.py`：

在 `complete()` 和 `stream()` 中添加 Metrics + Tracing Span：

```python
from cabinet.core.observability import (
    LLM_CALL_COUNT, LLM_CALL_LATENCY, LLM_TOKEN_USAGE, get_tracer,
)

tracer = get_tracer("cabinet.gateway")

async def complete(self, prompt, model=None, **kwargs):
    model = model or self._default_model
    with tracer.start_as_current_span("llm.complete") as span:
        span.set_attribute("llm.model", model)
        start = time.monotonic()
        try:
            response = await self._acompletion(model=model, messages=[...], **kwargs)
            duration = time.monotonic() - start
            LLM_CALL_COUNT.labels(model=model, status="success").inc()
            LLM_CALL_LATENCY.labels(model=model).observe(duration)
            if hasattr(response, "usage") and response.usage:
                LLM_TOKEN_USAGE.labels(model=model, type="prompt").inc(response.usage.prompt_tokens or 0)
                LLM_TOKEN_USAGE.labels(model=model, type="completion").inc(response.usage.completion_tokens or 0)
                span.set_attribute("llm.tokens.prompt", response.usage.prompt_tokens or 0)
                span.set_attribute("llm.tokens.completion", response.usage.completion_tokens or 0)
            return response.choices[0].message.content
        except Exception as e:
            LLM_CALL_COUNT.labels(model=model, status="error").inc()
            span.set_attribute("error", True)
            span.set_attribute("error.message", str(e))
            raise
```

### 5.3 litellm 回调集成

利用 litellm 的 `success_callback` / `failure_callback` 自动捕获所有 LLM 调用：

```python
import litellm
from cabinet.core.observability import LLM_CALL_COUNT, LLM_CALL_LATENCY, LLM_TOKEN_USAGE

def _litellm_success_callback(kwargs, completion_obj, start_time, end_time):
    model = kwargs.get("model", "unknown")
    duration = (end_time - start_time).total_seconds()
    LLM_CALL_COUNT.labels(model=model, status="success").inc()
    LLM_CALL_LATENCY.labels(model=model).observe(duration)
    if hasattr(completion_obj, "usage") and completion_obj.usage:
        LLM_TOKEN_USAGE.labels(model=model, type="prompt").inc(completion_obj.usage.prompt_tokens or 0)
        LLM_TOKEN_USAGE.labels(model=model, type="completion").inc(completion_obj.usage.completion_tokens or 0)

def _litellm_failure_callback(kwargs, completion_obj, start_time, end_time):
    model = kwargs.get("model", "unknown")
    LLM_CALL_COUNT.labels(model=model, status="error").inc()

litellm.success_callback = [_litellm_success_callback]
litellm.failure_callback = [_litellm_failure_callback]
```

### 5.4 EventBus 埋点

修改 `src/cabinet/core/events/asyncio_bus.py`：

```python
from cabinet.core.observability import EVENT_PUBLISHED, get_tracer

tracer = get_tracer("cabinet.eventbus")

async def publish(self, envelope):
    EVENT_PUBLISHED.labels(message_type=envelope.message_type).inc()
    with tracer.start_as_current_span("eventbus.publish") as span:
        span.set_attribute("event.type", envelope.message_type)
        span.set_attribute("event.source", envelope.source_room or "")
        # ... 现有逻辑 ...
```

### 5.5 Room Service 埋点

在各 Room Service 的关键方法入口添加：

```python
from cabinet.core.observability import ROOM_OPERATION

# DecisionRoomService
ROOM_OPERATION.labels(room="decision", operation="submit").inc()
ROOM_OPERATION.labels(room="decision", operation="approve").inc()
ROOM_OPERATION.labels(room="decision", operation="reject").inc()

# OfficeSchedulerService
ROOM_OPERATION.labels(room="office", operation="submit_task").inc()
ROOM_OPERATION.labels(room="office", operation="execute_workflow").inc()

# MeetingRoomService
ROOM_OPERATION.labels(room="meeting", operation="start_session").inc()
ROOM_OPERATION.labels(room="meeting", operation="converge").inc()

# StrategyDecoderService
ROOM_OPERATION.labels(room="strategy", operation="decode").inc()

# SummaryRoomService
ROOM_OPERATION.labels(room="summary", operation="start_review").inc()

# SecretaryAgentService
ROOM_OPERATION.labels(room="secretary", operation="process_input").inc()
```

### 5.6 基础设施层埋点

**SQLite 操作** — 在 `SqliteEventStore` 和 `SqliteRoomEventStore` 中：

```python
from cabinet.core.observability import DB_OPERATION_LATENCY

async def append(self, event):
    start = time.monotonic()
    # ... 现有逻辑 ...
    DB_OPERATION_LATENCY.labels(store=self._room_name, operation="append").observe(
        time.monotonic() - start
    )
```

**ChromaDB 操作** — 在 `ChromaDBMemoryStore` 和 `ChromaDBKnowledgeBase` 中：

```python
from cabinet.core.observability import VECTOR_OPERATION_LATENCY

async def search(self, ...):
    start = time.monotonic()
    # ... 现有逻辑 ...
    VECTOR_OPERATION_LATENCY.labels(operation="search").observe(
        time.monotonic() - start
    )
```

### 5.7 Prometheus Metrics Server

在 `serve` 命令中启动独立 HTTP server：

```python
from prometheus_client import start_http_server

if config.observability.enabled:
    start_http_server(config.observability.prometheus_port)
```

### 5.8 WebSocket 连接 Gauge

在 `chat.py` WebSocket 端点中：

```python
from cabinet.core.observability import ACTIVE_CONNECTIONS

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, ...):
    ACTIVE_CONNECTIONS.inc()
    try:
        # ... 现有逻辑 ...
    finally:
        ACTIVE_CONNECTIONS.dec()
```

## 6. OpenTelemetry Tracing

### 6.1 Tracer 初始化

在 `observability.py` 的 `setup_tracing()` 中：

- 创建 `TracerProvider`，设置 `service.name` resource
- 配置 OTLP exporter（如果 `otlp_endpoint` 已设置）
- 否则使用 `ConsoleSpanExporter` 用于开发调试
- 使用 `BatchSpanProcessor` 异步批量导出

### 6.2 FastAPI 自动 Instrumentation

在 `create_app()` 中：

```python
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

FastAPIInstrumentor.instrument_app(app)
```

自动为每个 HTTP 请求创建 Span，包含 method、url、status_code 等属性。

### 6.3 关键路径 Span 设计

```
HTTP 请求 (自动 by FastAPIInstrumentor)
├── secretary.process_input
│   ├── llm.complete [model=gpt-4o]
│   ├── memory.search [scope=LONG_TERM]
│   └── knowledge.query [top_k=5]
├── secretary.process_input_stream
│   ├── llm.stream [model=gpt-4o]
│   └── memory.store [scope=SHORT_TERM]
├── meeting.start_session
│   ├── llm.complete [role=moderator]
│   └── eventbus.publish [type=MeetingStarted]
├── decision.submit
│   ├── llm.complete [role=arbiter]
│   ├── eventbus.publish [type=DecisionSubmitted]
│   └── decision.check_authorization
│       └── llm.complete [role=arbiter]
├── office.submit_task
│   ├── office.check_permission
│   │   └── llm.complete [role=executor]
│   ├── workflow.execute
│   │   ├── llm.complete [node=step_1]
│   │   └── llm.complete [node=step_2]
│   └── eventbus.publish [type=TaskSubmitted]
├── strategy.decode
│   ├── llm.complete [role=strategist]
│   └── strategy.validate_blueprint
│       └── llm.complete [role=strategist]
└── summary.start_review
    ├── llm.complete [role=analyst]
    └── eventbus.publish [type=ReviewStarted]
```

### 6.4 Span 属性约定

| Span 名称 | 关键属性 |
|-----------|---------|
| `llm.complete` | `llm.model`, `llm.tokens.prompt`, `llm.tokens.completion`, `llm.tokens.total` |
| `llm.stream` | `llm.model`, `llm.tokens.prompt`, `llm.tokens.completion`, `llm.chunks.count` |
| `eventbus.publish` | `event.type`, `event.source_room`, `event.target_room` |
| `memory.search` | `memory.scope`, `memory.limit`, `memory.results.count` |
| `memory.store` | `memory.scope`, `memory.content.length` |
| `knowledge.query` | `knowledge.top_k`, `knowledge.results.count` |
| `room.{room}.{operation}` | `room.name`, `room.operation` |
| `workflow.execute` | `workflow.id`, `workflow.nodes.count`, `workflow.status` |
| `db.{operation}` | `db.store`, `db.operation` |

### 6.5 与 Metrics/Logs 的关联

- **Logs ↔ Traces**: `TraceInjectingFilter` 自动将 `trace_id`/`span_id` 注入日志 record
- **Metrics ↔ Traces**: Prometheus Exemplar 记录 trace_id（Prometheus 2.x 支持），实现 Metrics → Traces 跳转
- **三者关联**: 通过时间戳 + trace_id 对齐，实现 Logs ↔ Metrics ↔ Traces 全链路关联

## 7. 安全加固

### 7.1 API Key 加密存储

新增 `src/cabinet/core/security.py`：

```python
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
        import json
        with open(config_path) as f:
            config = json.load(f)
        vault = config.setdefault("vault", {})
        vault[name] = self.encrypt(value)
        with open(config_path, "w") as f:
            json.dump(config, f, indent=2)

    def retrieve_key(self, config_path: str, name: str) -> str | None:
        import json
        with open(config_path) as f:
            config = json.load(f)
        encrypted = config.get("vault", {}).get(name)
        if encrypted is None:
            return None
        return self.decrypt(encrypted)
```

**集成方式**：

- `cabinet init` 时生成 master_key 保存到 `{data_dir}/.master_key`（权限 600）
- `cabinet config set-api-key <key>` 命令加密存储 API Key 到 `cabinet.json` 的 `vault` 段
- `_init_runtime()` 启动时从 vault 解密 API Key，设置到环境变量
- 环境变量 `OPENAI_API_KEY` 仍作为 fallback（优先使用 vault）

### 7.2 输入校验强化

在 `src/cabinet/api/models.py` 中添加约束：

```python
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    captain_id: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")

class EmployeeCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    role: str = Field(..., min_length=1, max_length=256)
    personality: str = Field("", max_length=2000)

class SkillRegisterRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    description: str = Field(..., min_length=1, max_length=500)
```

**全局输入限制 middleware**：

```python
@app.middleware("http")
async def input_sanitization_middleware(request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and int(content_length) > 1_000_000:
        return JSONResponse(status_code=413, content={"error": "Payload too large"})
    return await call_next(request)
```

### 7.3 审计日志

新增 `src/cabinet/core/audit.py`：

```python
from __future__ import annotations

import aiosqlite
import json
from datetime import datetime, timezone
from pydantic import BaseModel
from opentelemetry import trace


class AuditEvent(BaseModel):
    timestamp: datetime
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
            (event.timestamp.isoformat(), event.action, event.actor,
             event.resource_type, event.resource_id, event.detail,
             event.ip_address, trace_id),
        )
        await self._db.commit()

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
```

**审计点**：

| 操作 | action | 触发位置 |
|------|--------|---------|
| API Key 轮换 | `api_key.rotate` | KeyVault.store_key |
| 决策审批 | `decision.approve` | DecisionRoomService.approve |
| 决策拒绝 | `decision.reject` | DecisionRoomService.reject |
| 员工创建 | `employee.create` | API route |
| 员工删除 | `employee.delete` | API route |
| 技能注册 | `skill.register` | API route |
| 配置变更 | `config.update` | CLI/API |
| 登录尝试 | `auth.login` | deps.py get_current_user |

### 7.4 CLI 命令扩展

在 `main.py` 中新增：

```python
@app.command()
def set_api_key(
    key: str = typer.Argument(..., help="API key to store"),
    data_dir: str = typer.Option("data", "--data-dir"),
):
    """Encrypt and store an API key in the vault."""
    from cabinet.core.security import KeyVault
    master_key_path = os.path.join(data_dir, ".master_key")
    config_path = os.path.join(data_dir, "cabinet.json")
    vault = KeyVault(master_key_path)
    vault.store_key(config_path, "openai_api_key", key)
    console.print("[green]API key stored securely in vault.[/green]")
```

## 8. 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新建 | `src/cabinet/core/observability.py` | 可观测性核心（Metrics + Tracing + Logging） |
| 新建 | `src/cabinet/core/security.py` | KeyVault 加密存储 |
| 新建 | `src/cabinet/core/audit.py` | 审计日志 |
| 新建 | `src/cabinet/api/routes/health.py` | Health Check 端点 |
| 修改 | `src/cabinet/core/logging.py` | 删除，功能合并到 observability.py |
| 修改 | `src/cabinet/cli/config.py` | 添加 ObservabilitySettings + vault_enabled |
| 修改 | `src/cabinet/cli/main.py` | serve 命令集成可观测性 + set-api-key 命令 |
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

## 9. 测试策略

### 9.1 单元测试

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/unit/core/test_observability.py` | ObservabilityConfig, setup_logging, setup_tracing, JsonFormatter, TraceInjectingFilter, 所有 Counter/Histogram 注册 |
| `tests/unit/core/test_security.py` | KeyVault 加密/解密/存储/检索, master_key 生成 |
| `tests/unit/core/test_audit.py` | AuditStore 初始化/日志写入/关闭, trace_id 注入 |
| `tests/unit/api/test_health.py` | /health, /ready 端点, 各子系统 mock 检查 |

### 9.2 集成测试

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/integration/test_observability.py` | 端到端 Metrics 采集 + Tracing Span 传播 + 日志 trace_id 关联 |

### 9.3 测试原则

- 所有 Metrics 测试使用独立的 `Registry` 实例，避免全局状态污染
- Tracing 测试使用 `InMemorySpanExporter`，验证 Span 属性
- Health Check 测试 mock 各子系统，验证降级逻辑
- 安全测试验证加密/解密往返正确性
- 审计测试验证 trace_id 自动注入
