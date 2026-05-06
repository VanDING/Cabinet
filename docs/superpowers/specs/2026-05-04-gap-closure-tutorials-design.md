# 遗留收尾与示例教程设计

> 日期: 2026-05-04
> 状态: 已批准
> 方案: 分层递进（遗留收尾 → 端到端演示 → API 示例 → 交互式教程）

## 1. 目标

在可观测性与安全加固实施（75% 完成度）的基础上：

1. **遗留差距收尾** — 修复 P0/P1/P2 遗留项，确保可观测性与安全加固真正完整
2. **端到端工作流演示** — 创建一键运行的演示脚本，展示 Captain 输入 → 六室流转 → 输出结果
3. **API 使用示例** — 覆盖所有端点的 curl 命令集合，可复制粘贴
4. **交互式教程** — 逐步引导新用户体验 Cabinet 核心价值

## 2. 遗留差距收尾

### 2.1 审计日志持久化

新建 `src/cabinet/core/audit.py`，实现 SQLite 持久化 AuditStore：

```python
class AuditEvent(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
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

    async def query(self, action: str = "", actor: str = "", limit: int = 100) -> list[AuditEvent]:
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
            f"SELECT * FROM audit_log{where} ORDER BY id DESC LIMIT ?",
            params,
        )
        rows = await cursor.fetchall()
        return [self._row_to_event(row) for row in rows]

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
```

**集成**：在 `runtime.py` 中用 `AuditStore` 替换内存版 `AuditLogger`。当 `db_path` 存在时使用 `AuditStore`，否则保留 `security.py` 中的 `AuditLogger` 作为 fallback。

### 2.2 Pydantic 输入校验

在 `src/cabinet/api/models.py` 中添加 Field 约束：

```python
from pydantic import BaseModel, Field

class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=10000)
    captain_id: str = Field("captain", min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")

class EmployeeCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    role: str = Field(..., min_length=1, max_length=256)
    personality: str = Field("", max_length=2000)
    kind: str = "ai"
```

### 2.3 CLI 集成

**`set-api-key` 命令**：

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
        console.print("[red]Error:[/red] Cabinet not initialized.")
        raise typer.Exit(code=1)
    from cabinet.core.security import KeyVault
    vault = KeyVault(key_file=master_key_path)
    encrypted = vault.encrypt(key)
    from cabinet.cli.config import load_config, save_config
    cfg = load_config(config_path)
    cfg.api_keys[provider] = f"vault:{encrypted}"
    save_config(cfg, config_path)
    console.print(f"[green]API key for '{provider}' stored securely in vault.[/green]")
```

**Vault 解密集成**：在 `_init_runtime` 中，优先从 vault 解密 API Key：

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

**Prometheus HTTP Server**：在 serve 命令中启动：

```python
if config.observability.enabled:
    from prometheus_client import start_http_server
    start_http_server(config.observability.prometheus_port)
```

### 2.4 Metrics 补全

**sqlite_store.py**：在 `append` 方法中添加 `DB_OPERATION_LATENCY` 计时

**sqlite_room_store.py**：在 `flush` 方法中添加 `DB_OPERATION_LATENCY` 计时

**local_kb.py**：在 `query` 方法中添加 `VECTOR_OPERATION_LATENCY` 计时

**observability.py**：注册 `WORKFLOW_EXECUTION` Histogram

### 2.5 其他补全

- `deps.py`：在 `get_current_user` 中记录 `auth.login` 审计事件
- `app.py`：在 middleware 中调用 `sanitize_input` 对请求体做基础检查
- `docker-compose.yml`：添加 9090 端口映射和 OTLP 环境变量

## 3. 端到端工作流演示

### 3.1 演示脚本

新建 `examples/e2e_workflow.py`：

```python
"""
Cabinet 端到端工作流演示

运行方式：
  python examples/e2e_workflow.py --data-dir data
  python examples/e2e_workflow.py --data-dir data --live  # 使用真实 LLM

前置条件：
  - cabinet init 已执行
  - --live 模式需要 API Key 已配置
"""
```

**工作流步骤**：

1. 初始化 Runtime（使用 StubAgentFactory 或 LLMAgentFactory）
2. Secretary 问候 Captain
3. Captain 提交战略提案
4. Meeting Room 协商（多视角推理 → 交叉验证 → 收敛）
5. Strategy Room 解码（提案 → 行动蓝图）
6. Decision Room 裁决（提交决策 → 审批）
7. Office Room 执行（提交任务 → 工作流执行）
8. Summary Room 学习（审查 → 生成洞察）
9. 展示可观测性数据（Health Check + Metrics）
10. 清理并停止 Runtime

**关键设计**：
- 默认使用 `StubAgentFactory`（无需 API Key 即可运行）
- `--live` 参数切换到 `LLMAgentFactory`
- 每步使用 `rich.console.Console` 美化输出
- 包含可观测性展示（Health Check 结果 + Prometheus URL）

### 3.2 演示配置

新建 `examples/e2e_config.json`：预配置的演示用组织信息。

## 4. API 使用示例

新建 `examples/api_examples.sh`：

**覆盖端点**：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 存活探针 |
| `/ready` | GET | 就绪探针 |
| `/api/chat` | POST | REST 聊天 |
| `/api/chat/ws` | WebSocket | 流式聊天 |
| `/api/employees/` | GET/POST | 员工列表/创建 |
| `/api/skills/` | GET | 技能列表 |
| `/api/knowledge/index` | POST | 知识库索引 |
| `/api/knowledge/query` | POST | 知识库查询 |
| `/api/rooms/meeting` | POST | 发起协商 |
| `/api/rooms/decision` | POST | 提交决策 |
| `/api/rooms/office/task` | POST | 提交任务 |
| `/api/rooms/strategy` | POST | 解码战略 |
| `/api/rooms/summary/review` | POST | 发起审查 |
| `/api/config/` | GET | 配置查询 |
| `:9090/metrics` | GET | Prometheus 指标 |

**关键设计**：
- 每个端点一组 curl 命令，可独立复制粘贴
- 使用 `jq` 格式化 JSON 输出（可选依赖）
- 支持 Bearer Token 认证（通过环境变量 `CABINET_TOKEN`）
- 包含 Health Check 和 Prometheus Metrics 查询

## 5. 交互式教程

新建 `examples/tutorial.py`：

```python
"""
Cabinet 交互式教程

运行方式：
  python examples/tutorial.py --data-dir data
  python examples/tutorial.py --data-dir data --live  # 使用真实 LLM

本教程将引导你体验 Cabinet 的核心功能：
  Step 1: 初始化与问候
  Step 2: 与 Secretary 对话
  Step 3: 发起 Meeting 协商
  Step 4: 提交 Decision 决策
  Step 5: 执行 Office 任务
  Step 6: 查看可观测性数据
"""
```

**教程步骤**：

| Step | 标题 | 交互方式 | 学习目标 |
|------|------|---------|---------|
| 1 | 初始化与问候 | 自动 | 理解 Runtime 生命周期 |
| 2 | 与 Secretary 对话 | 用户输入 | 体验人机交互窗口 |
| 3 | 发起 Meeting 协商 | 自动 | 理解多视角推理 |
| 4 | 提交 Decision 决策 | 选择题 | 体验裁决流程 |
| 5 | 执行 Office 任务 | 自动 | 理解自动化执行 |
| 6 | 查看可观测性数据 | 自动 | 体验 Health Check + Metrics |

**关键设计**：
- 使用 `rich` 库美化输出（项目已有依赖）
- 每步有"按 Enter 继续"暂停点
- Step 2 支持用户自由输入，其他步骤自动演示
- 使用 `StubAgentFactory` 默认运行，`--live` 切换真实 LLM
- 包含进度条和步骤计数器

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 新建 | `src/cabinet/core/audit.py` | SQLite 持久化审计日志 |
| 新建 | `tests/unit/core/test_audit.py` | 审计日志测试 |
| 新建 | `examples/e2e_workflow.py` | 端到端工作流演示 |
| 新建 | `examples/e2e_config.json` | 演示用预配置 |
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

## 7. 测试策略

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/unit/core/test_audit.py` | AuditStore 初始化/日志写入/查询/关闭/trace_id 注入 |
| 现有测试 | 确保所有遗留修复不破坏现有功能 |
| 手动验证 | 运行 `examples/e2e_workflow.py` 和 `examples/tutorial.py` |
