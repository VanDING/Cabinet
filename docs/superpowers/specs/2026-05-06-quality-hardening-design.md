# Quality Hardening & Production Readiness Design

## Overview

Cabinet v0.1.0 核心功能已完整，但存在测试盲区、健壮性缺陷、性能瓶颈和运维不足。本设计采用**自底向上四阶段流水线**策略，对全模块进行轻量加固，使框架从 Alpha 走向生产可用。

**策略：** 测试补全 → 健壮性加固 → 性能优化 → 运维友好

**范围：** 全模块轻量加固 — 覆盖所有模块，每个模块只做最必要的加固

---

## Current State Assessment

### Test Coverage

| 指标 | 值 |
|------|-----|
| 测试文件 | 112 个 |
| 测试函数 | 782 个 |
| CI 覆盖率门槛 | 60% |
| 集成测试占比 | 3.6%（4 个文件） |

**关键盲区：**
- `api/routes/agents.py` — 0 测试
- `api/routes/workflows.py` — 0 测试
- `agents/context.py` — 0 测试
- 87 个 fixture 全部散落在各测试文件中，重复严重
- 无 pytest markers

### Robustness Issues

| 级别 | 数量 | 典型问题 |
|------|------|---------|
| P0 | 3 | SQLite 连接泄漏、流式 LLM 错误指标误报、runtime 半初始化状态 |
| P1 | 4 | SQLite 10+ 并发连接、事件总线串行处理、6 个 Room LLM 调用无异常保护、备份任务未取消 |
| P2 | 5 | 事件持久化与分发耦合、eval() 安全隐患、工作流无全局超时、日志缺异常堆栈、health_check 假检查 |
| P3 | 4 | 配置验证不足、LLM 无缓存、日志级别不一致、缺请求级上下文 |

### Performance Bottlenecks

- SQLite 11 个组件各自 `aiosqlite.connect()` 同一数据库，高并发 `database is locked`
- 每次写操作立即 commit，无批量写入
- ChromaDB 两个独立 PersistentClient 实例无法共享缓存
- LLM 调用无结果缓存
- 事件总线 handler 串行执行

### Operations Gaps

- API 服务器无信号处理
- runtime.stop() 资源清理不完整
- 启动时不验证外部依赖可用性
- 配置校验不足
- 健康检查端点是假检查

---

## T1: Test Completion

### Goal

消除测试盲区，完善测试基础设施，将 CI 覆盖率门槛从 60% 提升到 75%。

### T1.1 API Route Test Coverage (P0)

**api/routes/agents.py** — 新建 `tests/unit/api/test_agents_routes.py`：

覆盖端点：
- `GET /api/agents/pool-status` — 返回 agent 池状态
- `POST /api/agents/discover` — 按角色/技能发现 agent
- `POST /api/agents/compose-team` — 自动组建团队
- `POST /api/agents/handoff` — agent 间任务移交

测试场景：正常请求、无效参数、runtime 未初始化、空结果

**api/routes/workflows.py** — 新建 `tests/unit/api/test_workflows_routes.py`：

覆盖端点：
- `POST /api/workflows/execute` — 执行工作流
- `POST /api/workflows/resume` — 恢复暂停的工作流
- `POST /api/workflows/cancel` — 取消工作流
- `GET /api/workflows/list-versions` — 列出工作流版本
- `GET /api/workflows/visualize` — 可视化工作流

测试场景：正常请求、无效 workflow_id、空版本列表、Mermaid/JSON 格式

**agents/context.py** — 新建 `tests/unit/agents/test_context.py`：

覆盖模型：AgentContext、AgentOutput、SkillContext、SkillOutput
测试场景：字段默认值、必填字段缺失、类型验证、序列化/反序列化

### T1.2 Shared Fixture Extraction (P1)

当前 87 个 fixture 全部散落在各测试文件中。提取到分层 conftest：

```
tests/
├── conftest.py              # 全局：litellm mock + 临时目录 + 共享数据库 fixture
├── unit/
│   ├── api/conftest.py      # API 共享：client, app, mock_runtime
│   ├── core/conftest.py     # Core 共享：event_bus, db_conn, tmp_db
│   ├── rooms/conftest.py    # Room 共享：room service fixtures
│   └── agents/conftest.py   # Agent 共享：mock_agent, mock_factory
└── integration/conftest.py  # 集成测试共享
```

提取原则：
- 被同一目录下 3+ 个测试文件使用的 fixture 提取到对应 conftest
- 被跨目录使用的 fixture 提取到根 conftest
- 保留仅被 1-2 个文件使用的 fixture 在原位

### T1.3 Pytest Markers (P1)

在 `pyproject.toml` 中定义：

```toml
[tool.pytest.ini_options]
markers = [
    "unit: 快速单元测试",
    "integration: 需要数据库/文件的集成测试",
    "slow: 耗时超过 1 秒的测试",
]
```

CI 中分离运行：
- `pytest -m "unit" --tb=short` — 快速反馈
- `pytest -m "integration"` — 完整验证
- `pytest` — 全部运行

### T1.4 CI Coverage Threshold (P1)

60% → 75%，分两步：
1. 补测试到 75%+ 覆盖率
2. 修改 `.github/workflows/ci.yml` 中 `--cov-fail-under=75`

### T1.5 CrewAI Adapter Mock Tests (P2)

为 `crewai_adapter/team.py` 和 `crewai_adapter/skill.py` 补充基于 mock 的适配器层测试，验证输入转换和错误处理逻辑。

### T1 Acceptance Criteria

- API 路由测试盲区消除（agents + workflows + context）
- 共享 fixture 提取完成，重复 fixture 数量减少 50%+
- pytest markers 定义并在 CI 中使用
- CI 覆盖率门槛 ≥ 75%

---

## T2: Robustness Hardening

### Goal

修复所有 P0/P1 缺陷，确保核心流程不再崩溃，系统具备优雅关停能力。

### T2.1 P0 Fixes

**SQLite Connection Leak (DeadLetterQueue)**

`src/cabinet/core/workflow/dead_letter_queue.py`:
- 添加 `async def close(self)` 方法，关闭 `_db_conn`
- `runtime.py` 的 `stop()` 中添加 `await self._dlq.close()`

**Stream LLM Error Metrics Misreporting**

`src/cabinet/core/gateway/litellm_adapter.py` `stream()` 方法:
- 添加 `try/except` 包裹流式迭代
- 异常时设置 `status = "error"`
- `finally` 块中根据 status 记录指标
- 防护 `chunk.choices` 为空列表的 `IndexError`

**Runtime Half-Initialized State**

`src/cabinet/runtime.py` `start()` 方法:
- 添加 `_rollback_init()` 方法，清理已初始化的组件
- `start()` 中每个初始化步骤包裹 try/except
- 失败时调用 `_rollback_init()` 回滚到一致状态

### T2.2 P1 Fixes

**Room Service LLM Exception Protection**

6 个 Room Service 的 `agent.execute()` 调用添加 try/except：

| Room | 方法 | 降级策略 |
|------|------|---------|
| Secretary | greet() | 返回默认问候语 |
| Secretary | process_input() | 返回错误提示 |
| Meeting | add_perspective() | 跳过该视角，继续流程 |
| Strategy | decode() | 返回原始提案作为蓝图 |
| Decision | submit() | 发布事件但标记为 "unenriched" |
| Summary | generate_insights() | 返回空洞察列表 |

每个 Room 添加 `ErrorOccurred` 领域事件，LLM 失败时发布。

**Event Bus Concurrent Processing**

`src/cabinet/core/events/asyncio_bus.py` `publish()` 方法:
- handler 调用从 `for h in handlers: await h()` 改为 `asyncio.gather(*[h() for h in handlers], return_exceptions=True)`
- 单个 handler 失败不影响其他 handler
- 为每个 handler 添加超时（默认 30 秒）

**Backup Task Not Cancelled in stop()**

`src/cabinet/runtime.py` `stop()` 方法:
- 添加 `self._backup_task.cancel()`
- 添加 `try: await self._backup_task except asyncio.CancelledError: pass`

**Event Persistence/Distribution Decoupling**

`src/cabinet/core/events/asyncio_bus.py` `publish()` 方法:
- 先分发事件给 handler
- 再异步持久化（`asyncio.create_task(self._store.append(envelope))`）
- 持久化失败记录 warning 但不阻断分发

### T2.3 Graceful Shutdown Enhancement

**API Server Signal Handling**

`src/cabinet/cli/main.py` `serve` 命令:
- 注册 SIGINT/SIGTERM handler
- 收到信号时调用 `await runtime.stop()`
- 设置 `shutdown_timeout = 30` 秒，超时强制退出

**runtime.stop() Complete Resource Cleanup**

按序关闭：
1. 取消备份任务
2. 关闭 DLQ 连接
3. 关闭 agent pool（添加 `AgentPool.close()` 方法）
4. flush audit buffer
5. 关闭 audit store
6. 关闭所有 DB 连接
7. 取消所有 pending tasks

**AuditStore Close Timing Fix**

`src/cabinet/core/audit.py` `close()` 方法:
- 先 flush buffer（确保数据写入）
- 再 cancel flush_task
- 处理 CancelledError 不丢失数据

### T2.4 Workflow Robustness

**_execute_condition() Exception Protection**

添加 try/except，异常时走 fallback 分支（默认为 True，允许工作流继续）。

**_execute_parallel() Error Handling**

将失败任务推入 DLQ 并标记工作流状态为 `partial_failure`。

**Workflow Global Timeout**

`run()` 方法添加 `asyncio.timeout()` 参数，默认 30 分钟。超时后取消所有进行中的节点。

**_eval_expr() Security**

替换 `eval()` 为安全的表达式求值器：
- 使用 `ast` 模块解析表达式
- 白名单允许的运算符：比较、逻辑、算术
- 禁止属性访问、函数调用、import

### T2 Acceptance Criteria

- 所有 P0/P1 缺陷修复并有对应测试
- `runtime.stop()` 能完整清理所有资源
- API 服务器收到 SIGTERM 后优雅关停
- 工作流有全局超时保护
- Room Service LLM 调用失败不再导致崩溃
- `_eval_expr()` 不再使用 `eval()`

---

## T3: Performance Optimization

### Goal

解决 SQLite 并发瓶颈、写入效率低下、事件总线串行处理等性能问题。

### T3.1 SQLite Connection Pooling

引入 `SharedConnectionManager`，所有组件共享同一个 aiosqlite 连接：

```python
class SharedConnectionManager:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        self._write_lock = asyncio.Lock()

    async def initialize(self) -> None:
        self._conn = await aiosqlite.connect(self._db_path)
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA synchronous=NORMAL")

    async def execute_write(self, sql: str, params: tuple = ()) -> None:
        async with self._write_lock:
            await self._conn.execute(sql, params)
            await self._conn.commit()

    async def execute_read(self, sql: str, params: tuple = ()) -> list:
        return await self._conn.execute_fetchall(sql, params)

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
```

迁移方案：
- `SqliteEventStore` — 接收 `SharedConnectionManager`，移除内部 `_db`
- `SqliteRoomEventStore` — 同上
- `SQLiteMemoryStore` — 同上
- `AuditStore` — 同上（保留内部缓冲逻辑）
- `DeadLetterQueue` — 同上
- `MigrationRunner` — 保持独立连接（仅在启动时使用）

`runtime.py` 中创建 `SharedConnectionManager` 实例，传递给所有组件。

### T3.2 Batch Write Optimization

| 组件 | 当前 | 优化后 |
|------|------|--------|
| SqliteRoomEventStore.flush() | 逐条 INSERT + commit | `executemany()` + 单次 commit |
| SqliteEventStore.append() | 每次事件 commit | 缓冲区 + 定期 flush（类似 AuditStore 模式） |
| SQLiteMemoryStore.store() | 每次写入 commit | 缓冲区 + 批量写入 |

### T3.3 Event Bus Handler Timeout

T2 中已将 handler 改为 `asyncio.gather()` 并发执行。此处补充：
- 为每个 handler 添加 `asyncio.wait_for(handler(envelope), timeout=30)` 超时保护
- 超时的 handler 记录 warning 并跳过

### T3.4 LLM Result Cache (Optional)

为 `LiteLLMRouterGateway` 添加可选的内存缓存层：

```python
class LiteLLMRouterGateway:
    def __init__(self, ..., enable_cache: bool = False, cache_ttl: int = 300):
        self._cache: dict[str, tuple[float, str]] = {}
        self._cache_ttl = cache_ttl
        self._enable_cache = enable_cache
```

- 缓存 key = `hash(model + json.dumps(messages) + str(temperature))`
- 默认关闭（`enable_cache=False`），用户可通过配置开启
- TTL 默认 5 分钟
- `add_model()`/`remove_model()` 时清空缓存

### T3.5 ChromaDB Connection Reuse

将 `ChromaDBKnowledgeBase` 和 `ChromaDBMemoryStore` 改为接收共享的 `chromadb.PersistentClient` 实例：
- `runtime.py` 中创建 `PersistentClient`
- 传递给 KnowledgeBase 和 MemoryStore

### T3 Acceptance Criteria

- SQLite 连接数从 10+ 降至 1（共享连接管理器）
- RoomEventStore.flush() 使用 executemany 批量写入
- 事件总线 handler 并发执行 + 30 秒超时保护
- LLM 缓存可选开启
- ChromaDB 共享客户端实例

---

## T4: Operations Friendliness

### Goal

让系统在生产环境中可观测、可诊断、可配置校验。

### T4.1 Startup Dependency Check

添加 `preflight_check()` 方法到 `CabinetRuntime`：

```python
async def preflight_check(self) -> dict[str, str]:
    checks = {}
    checks["llm"] = await self._check_llm_reachable()
    checks["chromadb"] = await self._check_chromadb_writable()
    checks["mcp"] = await self._check_mcp_servers()
    checks["api_keys"] = self._check_api_keys_valid()
    return checks
```

- `_check_llm_reachable()` — 发送一个最小化 LLM 请求验证可达性
- `_check_chromadb_writable()` — 尝试写入/删除一条测试记录
- `_check_mcp_servers()` — 尝试连接配置的 MCP 服务器
- `_check_api_keys_valid()` — 验证已配置的 API key 非空且格式正确

集成点：
- `cabinet serve` 启动时自动运行，检查失败输出 WARNING 但不阻止启动
- `cabinet status --preflight` 手动触发检查

### T4.2 Configuration Validation Enhancement

**CabinetConfig Field Constraints:**

```python
class CabinetConfig(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    captain_id: str = Field(..., pattern=r"^[a-f0-9-]{36}$")
    default_project: str = Field(..., pattern=r"^[a-f0-9-]{36}$")
    mcp_servers: list[MCPServerConfig] = Field(default_factory=list)
    cors_origins: list[str] = Field(default=["http://localhost:8000"])
```

**MCPServerConfig Model:**

```python
class MCPServerConfig(BaseModel):
    name: str = Field(..., min_length=1)
    transport: Literal["stdio", "sse"] = "stdio"
    command: str = Field(..., min_length=1)
    args: list[str] = Field(default_factory=list)
    env: dict[str, str] = Field(default_factory=dict)
```

**load_config() Friendly Error:**

捕获 `FileNotFoundError` 和 `ValidationError`，输出友好提示。

### T4.3 Health Check Enhancement

| 端点 | 当前 | 增强后 |
|------|------|--------|
| `/health` | 始终返回 OK | 检查进程存活 + 事件循环未阻塞 |
| `/ready` | 检查 runtime 存在 | 额外检查：SQLite 可读、ChromaDB 可查询、LLM gateway 已配置模型 |

`_check_gateway()` 改为实际验证模型列表非空。

### T4.4 Structured Logging Enhancement

| 问题 | 修复方案 |
|------|---------|
| 大部分 error/warning 日志缺异常堆栈 | 统一使用 `logger.exception()` 或添加 `exc_info=True` |
| 日志级别不一致 | 修正：LLM 调用成功 → DEBUG，DLQ 入队 → WARNING，tool 执行失败 → ERROR |
| 缺少请求级上下文 | CLI 模式下生成 `request_id`（UUID），通过 `TraceInjectingFilter` 扩展注入每条日志 |
| decision/service.py 静默吞异常 | 移除 `except: pass`，改为 `logger.exception()` |

### T4.5 Migration Assistance

- `cabinet db migrate --dry-run` — 预览将要执行的 SQL
- 迁移前自动备份
- 迁移失败自动回滚到备份

### T4 Acceptance Criteria

- `cabinet serve` 启动时运行 preflight check 并输出检查结果
- `cabinet status --preflight` 可手动触发检查
- 配置校验失败有友好错误提示
- `/ready` 端点实际验证后端依赖可用性
- 所有 error 日志包含异常堆栈
- CLI 模式下日志包含 request_id
- `cabinet db migrate --dry-run` 可预览迁移 SQL

---

## Cross-Phase Dependencies

```
T1 (Tests) ──→ T2 (Robustness) ──→ T3 (Performance) ──→ T4 (Ops)
   │                │                    │                   │
   │                │                    │                   │
   ▼                ▼                    ▼                   ▼
 测试盲区消除    P0/P1 修复完成     连接池化完成        preflight 可用
 fixture 提取    优雅关停可用       批量写入完成        健康检查增强
 markers 定义    LLM 异常保护       缓存可选开启        日志结构化
 CI 75%         eval() 替换        handler 超时         配置校验增强
```

每个阶段的验收标准必须全部满足后才能进入下一阶段。

---

## Risk Assessment

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| SharedConnectionManager 迁移范围大 | 可能引入新 bug | 逐步迁移，每个组件单独迁移+测试 |
| 事件总线改为并发可能改变行为顺序 | handler 副作用顺序变化 | 文档说明行为变更，handler 应无序依赖 |
| LLM preflight check 增加启动延迟 | 启动变慢 | 异步执行，超时 5 秒，失败不阻塞 |
| 缓存可能导致过期结果 | 用户看到旧数据 | TTL 限制 + 模型变更时清空 |
| eval() 替换可能破坏现有工作流 | 条件表达式不兼容 | 白名单覆盖常用运算符，提供迁移指南 |
