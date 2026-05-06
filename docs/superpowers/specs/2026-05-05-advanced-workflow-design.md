# 高级工作流 — 设计规格

> 日期：2026-05-05
> 状态：已确认
> 方案：引擎优先重构（方案 A）

## 概述

当前工作流引擎存在根本性缺陷：LoopNode 是伪循环、resume 不真正恢复、无错误恢复机制、无状态持久化、无版本管理、无可视化。本次迭代采用严格分层策略，从引擎核心重构开始，逐层构建高级工作流能力。

### 四层依赖关系

```
L1 引擎核心重构 + LoopNode + HumanNode
  ↓
L2 死信队列 + 错误恢复
  ↓
L3 工作流版本管理
  ↓
L4 工作流可视化 + 实时追踪
```

---

## L1 引擎核心重构 + LoopNode + HumanNode

### 1.1 引擎核心重构

当前引擎采用简单线性游走，不支持子图执行。重构为递归子图执行模式。

**核心变更**：

- `_execute_graph(start_id, node_map, edge_map, context_data, context) -> GraphResult`：可递归调用的子图执行器
- LoopNode/ParallelNode 通过递归调用 `_execute_graph` 执行子图
- 返回 `GraphResult` 而非裸 dict，携带 completed/paused/failed/cancelled 状态

```python
@dataclass
class GraphResult:
    completed: bool = False
    paused: bool = False
    failed: bool = False
    cancelled: bool = False
    output: dict = field(default_factory=dict)
    pause_info: dict | None = None
    failed_node_id: str | None = None
    error: str | None = None
```

**引擎入口**：

```python
class WorkflowEngine:
    async def run(self, workflow, inputs, context=None) -> WorkflowResult:
        node_map, edge_map = self._build_maps(workflow)
        trigger = self._find_trigger(node_map)
        return await self._execute_graph(trigger.id, node_map, edge_map, inputs, context)
```

### 1.2 LoopNode 完整实现

**模型增强**：

```python
class LoopNode(BaseModel):
    id: UUID = Field(default_factory=_uuid)
    kind: Literal["loop"] = "loop"
    name: str = "loop"
    loop_type: Literal["count", "condition", "iterator"] = "count"
    max_iterations: int = 100
    iterator_expr: str = ""
    condition_expr: str = ""
    body_entry_id: UUID
    body_exit_id: UUID | None = None
    break_on_error: bool = True
    retry_policy: RetryPolicy | None = None
```

**三种循环模式**：

| 模式 | 说明 | 示例 |
|------|------|------|
| `count` | 固定次数循环 | `max_iterations=5` |
| `condition` | 条件循环，每次迭代前评估 | `condition_expr="context.retries < 3"` |
| `iterator` | 遍历列表，绑定循环变量 | `iterator_expr="context.items"` |

**循环变量**：

- `__loop_index__`：当前索引（从 0 开始）
- `__loop_iteration__`：当前迭代数（从 1 开始）
- `__loop_item__`：iterator 模式下的当前元素
- `__loop_total__`：总迭代数（count 模式）

**执行逻辑**：

```python
async def _execute_loop(self, node, context_data, node_map, edge_map, context):
    iteration = 0
    for iteration in range(node.max_iterations):
        iter_ctx = dict(context_data)
        iter_ctx["__loop_index__"] = iteration
        iter_ctx["__loop_iteration__"] = iteration + 1

        if node.loop_type == "condition":
            if not self._eval_condition(node.condition_expr, iter_ctx):
                break
        elif node.loop_type == "iterator":
            items = self._eval_expr(node.iterator_expr, context_data)
            if iteration >= len(items):
                break
            iter_ctx["__loop_item__"] = items[iteration]
            iter_ctx["__loop_total__"] = len(items)
        elif node.loop_type == "count":
            iter_ctx["__loop_total__"] = node.max_iterations

        result = await self._execute_graph(node.body_entry_id, node_map, edge_map, iter_ctx, context)

        if result.paused:
            return NodeResult(node.id, {"paused": True, "iteration": iteration, **result.output})
        if result.failed and node.break_on_error:
            return NodeResult(node.id, {"failed": True, "iteration": iteration, "error": result.error})
        if result.cancelled:
            return NodeResult(node.id, {"cancelled": True, "iteration": iteration})

        context_data.update(result.output)

    return NodeResult(node.id, {
        "iterations": iteration + 1,
        "completed": True,
    })
```

**表达式求值**：

使用受限的 Python 表达式求值，仅允许访问 context_data 中的变量：

```python
def _eval_expr(self, expr: str, context_data: dict):
    try:
        return eval(expr, {"__builtins__": {}}, {"context": SimpleNamespace(**context_data)})
    except Exception:
        logger.warning("Failed to evaluate expression: %s", expr)
        return None

def _eval_condition(self, expr: str, context_data: dict) -> bool:
    result = self._eval_expr(expr, context_data)
    return bool(result) if result is not None else False
```

### 1.3 HumanNode 实现

模型已有定义（含 `timeout`、`timeout_strategy`、`default_output`），补充引擎执行逻辑：

```python
async def _execute_human(self, node, context_data, node_map, edge_map, context):
    if node.timeout:
        try:
            result = await asyncio.wait_for(
                self._request_human_input(node, context_data, context),
                timeout=node.timeout,
            )
        except asyncio.TimeoutError:
            if node.timeout_strategy == "escalate":
                return NodeResult(node.id, {"escalated": True, "reason": "timeout"})
            elif node.timeout_strategy == "default":
                return NodeResult(node.id, node.default_output or {})
            else:
                return NodeResult(node.id, {"timed_out": True})
    return await self._request_human_input(node, context_data, context)

async def _request_human_input(self, node, context_data, context):
    if context and context.human_input_handler:
        return await context.human_input_handler(node, context_data)
    return GraphResult(paused=True, pause_info={
        "node_id": str(node.id),
        "node_type": "human",
        "employee_id": node.employee_id,
        "input_protocol": node.input_protocol,
        "context_data": context_data,
    })
```

### 1.4 Resume 真正恢复

修复 `resume_workflow`，使其从暂停点继续执行后续节点：

```python
async def resume_workflow(self, execution_id, decision_result):
    execution = self._executions[execution_id]
    workflow = self._workflows[execution.workflow_id]
    node_map, edge_map = self._build_maps(workflow)

    # 找到暂停节点的下一个节点
    paused_node_id = execution.paused_node_id
    next_id = self._find_next_after_node(paused_node_id, edge_map)

    if next_id is None:
        # 暂停节点是最后一个节点，直接完成
        await self._publish_and_apply(WorkflowCompleted(...))
        return self._executions[execution_id]

    # 从暂停点的下一个节点继续执行
    resume_context = dict(execution.context_data)
    resume_context["__approval__"] = decision_result

    engine_result = await self._engine.run(
        workflow=workflow,
        inputs=resume_context,
        context=EngineContext(resume_from=next_id),
    )

    # 处理结果...
```

### 1.5 工作流状态持久化

将 WorkflowExecution 从纯内存改为 SQLite 持久化：

```python
class WorkflowExecutionStore:
    async def save(self, execution: WorkflowExecution) -> None: ...
    async def load(self, execution_id: UUID) -> WorkflowExecution | None: ...
    async def update_status(self, execution_id: UUID, status: str, **kwargs) -> None: ...
    async def list_active(self) -> list[WorkflowExecution]: ...
    async def list_by_workflow(self, workflow_id: UUID) -> list[WorkflowExecution]: ...
    async def delete(self, execution_id: UUID) -> None: ...
```

**SQLite Schema**（新迁移 v004）：

```sql
CREATE TABLE IF NOT EXISTS workflow_executions (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    context_data TEXT NOT NULL DEFAULT '{}',
    node_records TEXT NOT NULL DEFAULT '{}',
    timeline TEXT NOT NULL DEFAULT '[]',
    paused_node_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX idx_we_workflow ON workflow_executions(workflow_id);
CREATE INDEX idx_we_status ON workflow_executions(status);
```

---

## L2 死信队列 + 错误恢复

### 2.1 节点执行重试机制

```python
class RetryPolicy(BaseModel):
    max_retries: int = 3
    backoff_base: float = 1.0
    backoff_max: float = 60.0
    retryable_errors: list[str] = []
```

**引擎执行逻辑**：

```python
async def _execute_node_with_retry(self, node, context_data, node_map, edge_map, context):
    policy = node.retry_policy or RetryPolicy(max_retries=0)
    last_error = None
    for attempt in range(1 + policy.max_retries):
        try:
            return await self._execute_node(node, context_data, node_map, edge_map, context)
        except Exception as e:
            last_error = e
            if attempt < policy.max_retries:
                delay = min(policy.backoff_base * (2 ** attempt), policy.backoff_max)
                logger.warning("Node %s attempt %d failed: %s, retrying in %.1fs",
                               node.name, attempt + 1, e, delay)
                await asyncio.sleep(delay)
    await self._dead_letter_queue.push(
        source_type="workflow_node",
        source_id=str(node.id),
        error=last_error,
        payload=context_data,
        context={"node_name": node.name, "node_kind": node.kind},
        max_retries=policy.max_retries,
    )
    return NodeResult(node.id, {
        "failed": True,
        "error": str(last_error),
        "attempts": 1 + policy.max_retries,
    })
```

### 2.2 死信队列

```python
class DeadLetterEntry(BaseModel):
    id: UUID
    source_type: str
    source_id: str
    error_message: str
    error_type: str
    payload: dict
    context: dict
    retry_count: int = 0
    max_retries: int
    status: Literal["pending", "retrying", "resolved", "discarded"] = "pending"
    created_at: str
    last_retry_at: str | None = None
    resolved_at: str | None = None

class DeadLetterQueue:
    async def push(self, source_type, source_id, error, payload, context, max_retries=3) -> UUID: ...
    async def pop(self, entry_id: UUID) -> DeadLetterEntry | None: ...
    async def retry(self, entry_id: UUID) -> bool: ...
    async def resolve(self, entry_id: UUID) -> None: ...
    async def discard(self, entry_id: UUID) -> None: ...
    async def list_pending(self, source_type: str | None = None) -> list[DeadLetterEntry]: ...
    async def cleanup(self, older_than_days: int = 30) -> int: ...
```

**SQLite Schema**（迁移 v004，与 workflow_executions 同版本）：

```sql
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    error_message TEXT NOT NULL,
    error_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    context TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL,
    last_retry_at TEXT,
    resolved_at TEXT
);
CREATE INDEX idx_dlq_status ON dead_letter_queue(status);
CREATE INDEX idx_dlq_source ON dead_letter_queue(source_type, source_id);
```

### 2.3 EventBus Handler 容错

修复 AsyncIOEventBus，handler 异常不阻断后续 handler，失败消息进入死信队列：

```python
class AsyncIOEventBus:
    async def publish(self, message):
        await self._store.append(message)
        for handler in self._handlers.get(message.__class__, []):
            try:
                await handler(message)
            except Exception as e:
                logger.error("Handler %s failed for %s: %s",
                             handler.__name__, type(message).__name__, e)
                await self._dead_letter_queue.push(
                    source_type="event_handler",
                    source_id=f"{type(message).__name__}.{handler.__name__}",
                    error=e,
                    payload=message.model_dump() if hasattr(message, 'model_dump') else {},
                    context={},
                )
```

### 2.4 工作流取消机制

```python
class WorkflowEngine:
    def __init__(self):
        self._cancel_tokens: dict[str, asyncio.Event] = {}

    async def cancel(self, execution_id: str) -> None:
        token = self._cancel_tokens.get(execution_id)
        if token:
            token.set()

    async def _execute_graph(self, start_id, node_map, edge_map, context_data, context):
        cancel_token = self._cancel_tokens.get(context.execution_id) if context else None
        while current_id is not None:
            if cancel_token and cancel_token.is_set():
                return GraphResult(cancelled=True)
            ...
```

### 2.5 工作流执行快照

```python
class WorkflowSnapshot(BaseModel):
    execution_id: UUID
    workflow_id: UUID
    current_node_id: UUID
    context_data: dict
    completed_nodes: list[str]
    status: str
    created_at: str

class WorkflowExecutionStore:
    async def save_snapshot(self, snapshot: WorkflowSnapshot) -> None: ...
    async def load_latest_snapshot(self, execution_id: UUID) -> WorkflowSnapshot | None: ...
    async def restore_from_snapshot(self, execution_id: UUID) -> WorkflowExecution: ...
```

---

## L3 工作流版本管理

### 3.1 版本模型

```python
class WorkflowVersion(BaseModel):
    workflow_id: UUID
    version: int
    definition: dict
    change_summary: str
    change_type: Literal["create", "update", "rollback"]
    created_at: str
    created_by: str = "system"
```

**SQLite Schema**（新迁移 v005）：

```sql
CREATE TABLE IF NOT EXISTS workflow_versions (
    workflow_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    definition TEXT NOT NULL,
    change_summary TEXT NOT NULL,
    change_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT 'system',
    PRIMARY KEY (workflow_id, version)
);
CREATE INDEX idx_wfv_created ON workflow_versions(created_at);
```

### 3.2 版本化工作流管理器

```python
class VersionedWorkflowManager:
    def __init__(self, version_store: WorkflowVersionStore, execution_store: WorkflowExecutionStore):
        self._version_store = version_store
        self._execution_store = execution_store

    async def create_workflow(self, definition: dict) -> WorkflowVersion:
        version = WorkflowVersion(
            workflow_id=definition["id"],
            version=1,
            definition=definition,
            change_summary="Initial version",
            change_type="create",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        await self._version_store.save_version(version)
        return version

    async def update_workflow(self, workflow_id: UUID, new_definition: dict, summary: str) -> WorkflowVersion:
        latest = await self._version_store.get_latest_version(workflow_id)
        new_version = (latest.version + 1) if latest else 1
        version = WorkflowVersion(
            workflow_id=workflow_id,
            version=new_version,
            definition=new_definition,
            change_summary=summary,
            change_type="update",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        await self._version_store.save_version(version)
        return version

    async def rollback(self, workflow_id: UUID, target_version: int) -> WorkflowVersion:
        target = await self._version_store.get_version(workflow_id, target_version)
        if not target:
            raise ValueError(f"Version {target_version} not found")
        latest = await self._version_store.get_latest_version(workflow_id)
        rollback_version = WorkflowVersion(
            workflow_id=workflow_id,
            version=latest.version + 1,
            definition=target.definition,
            change_summary=f"Rollback to v{target_version}",
            change_type="rollback",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        await self._version_store.save_version(rollback_version)
        return rollback_version
```

### 3.3 兼容性检查

```python
class CompatibilityIssue(BaseModel):
    severity: Literal["breaking", "warning", "info"]
    type: str
    node_id: str | None = None
    description: str

class CompatibilityReport(BaseModel):
    is_compatible: bool
    issues: list[CompatibilityIssue]
    active_executions_affected: int

class CompatibilityChecker:
    async def check(self, old_def: dict, new_def: dict) -> CompatibilityReport:
        old_nodes = {n["id"]: n for n in old_def.get("nodes", [])}
        new_nodes = {n["id"]: n for n in new_def.get("nodes", [])}
        issues = []

        for node_id in old_nodes:
            if node_id not in new_nodes:
                issues.append(CompatibilityIssue(
                    severity="breaking", type="node_removed",
                    node_id=node_id, description=f"Node {node_id} removed"
                ))
            elif old_nodes[node_id]["kind"] != new_nodes[node_id]["kind"]:
                issues.append(CompatibilityIssue(
                    severity="breaking", type="node_type_changed",
                    node_id=node_id,
                    description=f"Node {node_id} type changed from {old_nodes[node_id]['kind']} to {new_nodes[node_id]['kind']}"
                ))

        for node_id in new_nodes:
            if node_id not in old_nodes:
                issues.append(CompatibilityIssue(
                    severity="info", type="node_added",
                    node_id=node_id, description=f"Node {node_id} added"
                ))

        return CompatibilityReport(
            is_compatible=not any(i.severity == "breaking" for i in issues),
            issues=issues,
            active_executions_affected=await self._count_affected_executions(old_def, new_def),
        )
```

### 3.4 CLI 命令

```bash
cabinet workflow versions <workflow_id>            # 列出所有版本
cabinet workflow diff <workflow_id> <v1> <v2>      # 比较两个版本
cabinet workflow rollback <workflow_id> <version>  # 回滚到指定版本
```

---

## L4 工作流可视化 + 实时追踪

### 4.1 DAG 可视化

双格式输出：Mermaid（API/Web）+ ASCII（CLI 终端）。

```python
class WorkflowVisualizer:
    def __init__(self, execution_store: WorkflowExecutionStore):
        self._execution_store = execution_store

    def to_mermaid(self, workflow: Workflow, execution: WorkflowExecution | None = None) -> str:
        lines = ["flowchart TD"]
        for node in workflow.nodes:
            style = self._node_style(node, execution)
            lines.append(f'    {node.id}["{node.name}"]{style}')
        for edge in workflow.edges:
            label = f"|{edge.condition}|" if edge.condition else ""
            lines.append(f"    {edge.source_id} -->{label} {edge.target_id}")
        if execution:
            lines.extend([
                "",
                "    classDef completed fill:#4caf50,color:#fff",
                "    classDef running fill:#2196f3,color:#fff",
                "    classDef failed fill:#f44336,color:#fff",
                "    classDef paused fill:#ff9800,color:#fff",
                "    classDef skipped fill:#9e9e9e,color:#fff",
            ])
        return "\n".join(lines)

    def to_ascii(self, workflow: Workflow, execution: WorkflowExecution | None = None) -> str: ...

    def _node_style(self, node, execution) -> str:
        if execution is None:
            return ""
        status = execution.node_records.get(str(node.id))
        if not status:
            return ""
        styles = {
            "completed": ":::completed",
            "running": ":::running",
            "failed": ":::failed",
            "paused": ":::paused",
            "skipped": ":::skipped",
        }
        return styles.get(status.status, "")
```

### 4.2 执行状态追踪

增强 WorkflowExecution 模型，支持细粒度节点状态：

```python
class NodeExecutionRecord(BaseModel):
    node_id: UUID
    node_name: str
    status: Literal["pending", "running", "completed", "failed", "paused", "skipped", "cancelled"]
    started_at: str | None = None
    completed_at: str | None = None
    duration_ms: float | None = None
    input_data: dict | None = None
    output_data: dict | None = None
    error: str | None = None
    retry_count: int = 0
```

引擎在 `_execute_node_with_retry` 中自动记录节点执行状态。

### 4.3 执行时间线

```python
class TimelineEvent(BaseModel):
    event: str
    node_id: str | None = None
    timestamp: str
    details: dict | None = None
```

事件类型：`workflow_started`、`node_started`、`node_completed`、`node_failed`、`workflow_paused`、`workflow_resumed`、`workflow_completed`、`workflow_cancelled`。

### 4.4 API 端点

```python
GET  /api/workflows/{workflow_id}/mermaid              # Mermaid 流程图
GET  /api/workflows/{workflow_id}/ascii                # ASCII 流程图
GET  /api/workflows/executions/{execution_id}          # 执行详情
GET  /api/workflows/executions/{execution_id}/timeline # 执行时间线
GET  /api/workflows/executions/{execution_id}/mermaid  # 叠加执行状态的流程图
GET  /api/workflows/dead-letter                        # 列出死信
POST /api/workflows/dead-letter/{id}/retry             # 重试
POST /api/workflows/dead-letter/{id}/discard           # 丢弃
```

### 4.5 CLI 命令

```bash
cabinet workflow show <workflow_id>                    # ASCII 可视化
cabinet workflow show <workflow_id> --mermaid          # Mermaid 输出
cabinet workflow status <execution_id>                 # 执行状态
cabinet workflow timeline <execution_id>               # 执行时间线
cabinet workflow dead-letter                           # 列出死信
cabinet workflow dead-letter retry <id>                # 重试死信项
```

---

## 迁移计划

| 版本 | 内容 |
|------|------|
| v004 | `workflow_executions` 表 + `dead_letter_queue` 表 |
| v005 | `workflow_versions` 表 |

## 文件变更概览

| 文件 | 变更类型 | 说明 |
|------|----------|------|
| `src/cabinet/core/workflow/engine.py` | 重构 | 递归子图执行 + LoopNode + HumanNode + 重试 + 取消 |
| `src/cabinet/models/workflows.py` | 修改 | LoopNode 增强 + RetryPolicy + NodeExecutionRecord + TimelineEvent |
| `src/cabinet/core/workflow/visualizer.py` | 新增 | Mermaid + ASCII 可视化 |
| `src/cabinet/core/workflow/dead_letter.py` | 新增 | 死信队列 |
| `src/cabinet/core/workflow/execution_store.py` | 新增 | 执行状态持久化 |
| `src/cabinet/core/workflow/version_store.py` | 新增 | 版本存储 |
| `src/cabinet/core/workflow/version_manager.py` | 新增 | 版本化管理器 + 兼容性检查 |
| `src/cabinet/core/events/asyncio_bus.py` | 修改 | Handler 容错 |
| `src/cabinet/core/events/migrations/v004.py` | 新增 | workflow_executions + dead_letter_queue |
| `src/cabinet/core/events/migrations/v005.py` | 新增 | workflow_versions |
| `src/cabinet/rooms/office/service.py` | 修改 | Resume 真正恢复 + 执行持久化 |
| `src/cabinet/api/routes/workflows.py` | 新增 | 工作流 API 端点 |
| `src/cabinet/cli/main.py` | 修改 | 工作流 CLI 命令 |
| `src/cabinet/runtime.py` | 修改 | 注入新组件 |
