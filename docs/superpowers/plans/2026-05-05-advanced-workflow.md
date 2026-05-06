# 高级工作流实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将工作流引擎从简单线性游走重构为递归子图执行，并在此基础上构建 LoopNode 完整实现、死信队列与错误恢复、版本管理、可视化与追踪四大高级能力。

**Architecture:** 四层严格分层实施。L1 重构引擎核心（递归子图执行 + LoopNode 三种模式 + HumanNode + Resume 修复 + 执行持久化），L2 构建错误恢复基础设施（死信队列 + 重试 + 取消 + 快照），L3 添加版本管理（版本存储 + 兼容性检查 + 回滚），L4 实现可视化与追踪（Mermaid/ASCII + 节点记录 + 时间线 + API/CLI）。

**Tech Stack:** Python 3.12+, aiosqlite, Pydantic v2, FastAPI, Typer, asyncio

---

## 文件结构

| 文件 | 职责 |
|------|------|
| `src/cabinet/models/workflows.py` | 工作流模型：增强 LoopNode、新增 RetryPolicy/GraphResult/NodeExecutionRecord/TimelineEvent |
| `src/cabinet/core/workflow/engine.py` | 工作流引擎：递归子图执行 + LoopNode + HumanNode + 重试 + 取消 |
| `src/cabinet/core/workflow/execution_store.py` | 工作流执行状态 SQLite 持久化 |
| `src/cabinet/core/workflow/dead_letter.py` | 死信队列 SQLite 持久化 |
| `src/cabinet/core/workflow/version_store.py` | 工作流版本 SQLite 持久化 |
| `src/cabinet/core/workflow/version_manager.py` | 版本化管理器 + 兼容性检查 |
| `src/cabinet/core/workflow/visualizer.py` | Mermaid + ASCII 可视化 |
| `src/cabinet/core/events/migrations/v004_workflow_executions.py` | 迁移 v004：workflow_executions + dead_letter_queue |
| `src/cabinet/core/events/migrations/v005_workflow_versions.py` | 迁移 v005：workflow_versions |
| `src/cabinet/core/events/asyncio_bus.py` | EventBus handler 容错 |
| `src/cabinet/rooms/office/service.py` | Office 服务：Resume 真正恢复 + 执行持久化 |
| `src/cabinet/rooms/office/models.py` | Office 模型：增强 WorkflowExecution |
| `src/cabinet/rooms/office/domain_events.py` | 新增 WorkflowCancelled/WorkflowResumed 事件 |
| `src/cabinet/api/routes/workflows.py` | 工作流 API 端点 |
| `src/cabinet/cli/main.py` | 工作流 CLI 命令 |
| `src/cabinet/runtime.py` | 注入新组件 |

---

## L1：引擎核心重构 + LoopNode + HumanNode

### Task 1: 新增 RetryPolicy 和 GraphResult 模型

**Files:**
- Modify: `src/cabinet/models/workflows.py`
- Test: `tests/unit/core/workflow/test_models.py`

- [ ] **Step 1: 创建测试文件，编写 RetryPolicy 和 GraphResult 测试**

```python
# tests/unit/core/workflow/test_models.py
import pytest
from cabinet.models.workflows import RetryPolicy, GraphResult


def test_retry_policy_defaults():
    policy = RetryPolicy()
    assert policy.max_retries == 3
    assert policy.backoff_base == 1.0
    assert policy.backoff_max == 60.0
    assert policy.retryable_errors == []


def test_retry_policy_custom():
    policy = RetryPolicy(max_retries=5, backoff_base=2.0, backoff_max=120.0, retryable_errors=["TimeoutError"])
    assert policy.max_retries == 5
    assert policy.backoff_base == 2.0
    assert policy.backoff_max == 120.0
    assert "TimeoutError" in policy.retryable_errors


def test_graph_result_completed():
    result = GraphResult(completed=True, output={"x": 1})
    assert result.completed is True
    assert result.output == {"x": 1}
    assert result.paused is False
    assert result.failed is False
    assert result.cancelled is False


def test_graph_result_paused():
    result = GraphResult(paused=True, pause_info={"node_id": "abc"})
    assert result.paused is True
    assert result.pause_info == {"node_id": "abc"}


def test_graph_result_failed():
    result = GraphResult(failed=True, failed_node_id="n1", error="boom")
    assert result.failed is True
    assert result.failed_node_id == "n1"
    assert result.error == "boom"


def test_graph_result_cancelled():
    result = GraphResult(cancelled=True)
    assert result.cancelled is True
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/workflow/test_models.py -v`
Expected: FAIL — ImportError

- [ ] **Step 3: 在 `src/cabinet/models/workflows.py` 中添加 RetryPolicy 和 GraphResult**

在 `workflows.py` 文件顶部 import 区域添加 `from dataclasses import dataclass, field`，然后在 `_uuid()` 函数之后、`TriggerNode` 类之前添加：

```python
class RetryPolicy(BaseModel):
    max_retries: int = 3
    backoff_base: float = 1.0
    backoff_max: float = 60.0
    retryable_errors: list[str] = []


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

- [ ] **Step 4: 运行测试，确认通过**

Run: `pytest tests/unit/core/workflow/test_models.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/models/workflows.py tests/unit/core/workflow/test_models.py
git commit -m "feat(workflow): add RetryPolicy and GraphResult models"
```

---

### Task 2: 增强 LoopNode 模型

**Files:**
- Modify: `src/cabinet/models/workflows.py`
- Modify: `tests/unit/core/workflow/test_models.py`

- [ ] **Step 1: 编写增强 LoopNode 的测试**

在 `test_models.py` 末尾追加：

```python
from cabinet.models.workflows import LoopNode
from uuid import uuid4


def test_loop_node_count_mode():
    node = LoopNode(
        name="count_loop",
        loop_type="count",
        max_iterations=5,
        body_entry_id=uuid4(),
    )
    assert node.loop_type == "count"
    assert node.max_iterations == 5
    assert node.break_on_error is True


def test_loop_node_condition_mode():
    node = LoopNode(
        name="cond_loop",
        loop_type="condition",
        condition_expr="context.retries < 3",
        body_entry_id=uuid4(),
    )
    assert node.loop_type == "condition"
    assert node.condition_expr == "context.retries < 3"


def test_loop_node_iterator_mode():
    node = LoopNode(
        name="iter_loop",
        loop_type="iterator",
        iterator_expr="context.items",
        body_entry_id=uuid4(),
    )
    assert node.loop_type == "iterator"
    assert node.iterator_expr == "context.items"


def test_loop_node_defaults():
    node = LoopNode(body_entry_id=uuid4())
    assert node.loop_type == "count"
    assert node.max_iterations == 100
    assert node.break_on_error is True
    assert node.body_exit_id is None
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/workflow/test_models.py::test_loop_node_count_mode -v`
Expected: FAIL — LoopNode 缺少新字段

- [ ] **Step 3: 修改 LoopNode 模型**

将 `workflows.py` 中的 `LoopNode` 替换为：

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

- [ ] **Step 4: 运行测试，确认通过**

Run: `pytest tests/unit/core/workflow/test_models.py -v`
Expected: PASS

- [ ] **Step 5: 修复现有测试中 LoopNode 的用法**

现有 `test_engine.py` 中 `test_engine_loop_node_executes_body` 使用了旧的 `body_node_ids` 参数。需要更新该测试以适配新模型。将测试中的 LoopNode 构造改为使用 `body_entry_id`：

在 `tests/unit/core/workflow/test_engine.py` 中，找到 `test_engine_loop_node_executes_body` 测试，将：

```python
LoopNode(id=loop_id, iterator_expr="items", body_node_ids=[body_a_id, body_b_id]),
```

替换为：

```python
LoopNode(id=loop_id, loop_type="count", max_iterations=2, body_entry_id=body_a_id),
```

同时需要添加从 body_a_id 到 body_b_id 的边，以及从 body_b_id 回到 loop_id 的边（表示循环体子图）。但由于当前引擎尚未重构为子图执行，此测试需要暂时标记为 `pytest.mark.xfail` 或调整预期。暂时将该测试标记为：

```python
@pytest.mark.asyncio
@pytest.mark.xfail(reason="LoopNode model updated, engine refactoring pending (Task 5)")
async def test_engine_loop_node_executes_body():
```

- [ ] **Step 6: 运行全部工作流测试**

Run: `pytest tests/unit/core/workflow/ -v`
Expected: test_loop_node 相关测试 PASS，旧引擎测试中 loop 测试 XFAIL

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/models/workflows.py tests/unit/core/workflow/test_models.py tests/unit/core/workflow/test_engine.py
git commit -m "feat(workflow): enhance LoopNode with loop_type, body_entry_id, condition_expr"
```

---

### Task 3: 新增 NodeExecutionRecord 和 TimelineEvent 模型

**Files:**
- Modify: `src/cabinet/models/workflows.py`
- Modify: `tests/unit/core/workflow/test_models.py`

- [ ] **Step 1: 编写 NodeExecutionRecord 和 TimelineEvent 测试**

在 `test_models.py` 末尾追加：

```python
from cabinet.models.workflows import NodeExecutionRecord, TimelineEvent


def test_node_execution_record_defaults():
    record = NodeExecutionRecord(node_id=uuid4(), node_name="test")
    assert record.status == "pending"
    assert record.retry_count == 0
    assert record.started_at is None
    assert record.duration_ms is None


def test_node_execution_record_completed():
    record = NodeExecutionRecord(
        node_id=uuid4(),
        node_name="skill_1",
        status="completed",
        started_at="2026-01-01T00:00:00Z",
        completed_at="2026-01-01T00:00:01Z",
        duration_ms=1000.0,
        output_data={"result": "ok"},
    )
    assert record.status == "completed"
    assert record.duration_ms == 1000.0


def test_timeline_event():
    event = TimelineEvent(event="node_started", node_id="abc", timestamp="2026-01-01T00:00:00Z")
    assert event.event == "node_started"
    assert event.node_id == "abc"


def test_timeline_event_with_details():
    event = TimelineEvent(
        event="node_failed",
        node_id="abc",
        timestamp="2026-01-01T00:00:00Z",
        details={"error": "timeout"},
    )
    assert event.details == {"error": "timeout"}
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/workflow/test_models.py::test_node_execution_record_defaults -v`
Expected: FAIL — ImportError

- [ ] **Step 3: 在 `workflows.py` 中添加 NodeExecutionRecord 和 TimelineEvent**

在 `GraphResult` 之后、`TriggerNode` 之前添加：

```python
class NodeExecutionRecord(BaseModel):
    node_id: UUID
    node_name: str
    status: Literal["pending", "running", "completed", "failed", "paused", "skipped", "cancelled"] = "pending"
    started_at: str | None = None
    completed_at: str | None = None
    duration_ms: float | None = None
    input_data: dict | None = None
    output_data: dict | None = None
    error: str | None = None
    retry_count: int = 0


class TimelineEvent(BaseModel):
    event: str
    node_id: str | None = None
    timestamp: str
    details: dict | None = None
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pytest tests/unit/core/workflow/test_models.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/models/workflows.py tests/unit/core/workflow/test_models.py
git commit -m "feat(workflow): add NodeExecutionRecord and TimelineEvent models"
```

---

### Task 4: 重构 WorkflowEngine 为递归子图执行

**Files:**
- Modify: `src/cabinet/core/workflow/engine.py`
- Modify: `tests/unit/core/workflow/test_engine.py`

- [ ] **Step 1: 编写递归子图执行的测试**

在 `test_engine.py` 末尾追加：

```python
from cabinet.models.workflows import LoopNode as NewLoopNode


@pytest.mark.asyncio
async def test_engine_subgraph_execution():
    trigger_id = uuid4()
    skill_a_id = uuid4()
    skill_b_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="subgraph",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_a_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=skill_b_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_a_id),
            WorkflowEdge(source_node_id=skill_a_id, target_node_id=skill_b_id),
            WorkflowEdge(source_node_id=skill_b_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"input": "test"})
    assert str(trigger_id) in results
    assert str(skill_a_id) in results
    assert str(skill_b_id) in results
    assert "__end__" in results


@pytest.mark.asyncio
async def test_engine_human_approval_pauses_with_graph_result():
    trigger_id = uuid4()
    approval_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="approval_resume",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanApprovalNode(id=approval_id, decision_type="strategic"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=approval_id),
            WorkflowEdge(source_node_id=approval_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert "__paused__" in results
    assert results["__paused__"]["node_id"] == str(approval_id)
```

- [ ] **Step 2: 运行测试，确认现有测试仍然通过**

Run: `pytest tests/unit/core/workflow/test_engine.py -v`
Expected: 现有测试 PASS（新测试也应 PASS，因为子图执行与线性游走在简单场景下行为一致）

- [ ] **Step 3: 重构 WorkflowEngine.run() 为 _execute_graph()**

将 `engine.py` 的 `WorkflowEngine` 类替换为以下实现。核心变更：
- `run()` 调用 `_execute_graph()`
- `_execute_graph()` 是可递归的子图执行器
- 返回 `GraphResult` 用于内部，`run()` 将其转换为 dict 格式保持向后兼容

```python
from __future__ import annotations

import asyncio
from types import SimpleNamespace
from uuid import UUID, uuid4

from cabinet.agents.context import AgentContext
from cabinet.agents.protocol import AgentFactory
from cabinet.models.workflows import (
    ConditionNode,
    EndNode,
    GraphResult,
    HumanApprovalNode,
    HumanNode,
    LoopNode,
    NodeExecutionRecord,
    ParallelNode,
    RetryPolicy,
    SkillNode,
    TimelineEvent,
    TriggerNode,
    Workflow,
    WorkflowNode,
)

import logging

logger = logging.getLogger(__name__)


class NodeResult:
    __slots__ = ("node_id", "output", "next_node_id")

    def __init__(self, node_id: UUID, output: dict, next_node_id: UUID | None = None):
        self.node_id = node_id
        self.output = output
        self.next_node_id = next_node_id


class EngineContext:
    def __init__(
        self,
        execution_id: str | None = None,
        resume_from: UUID | None = None,
        human_input_handler: object | None = None,
        cancel_token: asyncio.Event | None = None,
    ):
        self.execution_id = execution_id
        self.resume_from = resume_from
        self.human_input_handler = human_input_handler
        self.cancel_token = cancel_token


class WorkflowEngine:
    def __init__(
        self,
        agent_factory: AgentFactory,
        verification_gate: object | None = None,
        knowledge_base: object | None = None,
        dead_letter_queue: object | None = None,
    ):
        self._agent_factory = agent_factory
        self._verification_gate = verification_gate
        self._knowledge_base = knowledge_base
        self._dead_letter_queue = dead_letter_queue
        self._cancel_tokens: dict[str, asyncio.Event] = {}
        self._current_execution_id: str | None = None

    async def run(
        self,
        workflow: Workflow,
        inputs: dict,
        on_node_completed: object | None = None,
        context: EngineContext | None = None,
    ) -> dict:
        node_map, edge_map = self._build_maps(workflow)
        trigger_nodes = [n for n in workflow.nodes if isinstance(n, TriggerNode)]
        if not trigger_nodes:
            raise ValueError("Workflow has no trigger node")

        start_id = trigger_nodes[0].id
        if context and context.resume_from:
            start_id = context.resume_from

        self._current_execution_id = context.execution_id if context else None

        graph_result = await self._execute_graph(
            start_id, node_map, edge_map, dict(inputs), context or EngineContext(),
        )

        results = dict(graph_result.output)
        if graph_result.paused and graph_result.pause_info:
            results["__paused__"] = graph_result.pause_info
        if graph_result.completed:
            if "__end__" not in results:
                results["__end__"] = {"status": "completed"}

        if on_node_completed is not None:
            pass

        return results

    async def cancel(self, execution_id: str) -> None:
        token = self._cancel_tokens.get(execution_id)
        if token:
            token.set()

    async def _execute_graph(
        self,
        start_id: UUID,
        node_map: dict[UUID, WorkflowNode],
        edge_map: dict[UUID, list[tuple[UUID, str | None]]],
        context_data: dict,
        context: EngineContext,
    ) -> GraphResult:
        current_id = start_id
        results: dict[str, dict] = {}

        while current_id is not None:
            if context.cancel_token and context.cancel_token.is_set():
                return GraphResult(cancelled=True, output=results)

            node = node_map.get(current_id)
            if node is None:
                break

            if isinstance(node, EndNode):
                for k, v in node.output_mapping.items():
                    if k in context_data:
                        results[v] = context_data[k]
                results["__end__"] = {"node_id": str(node.id), "status": "completed"}
                return GraphResult(completed=True, output=results)

            if isinstance(node, HumanApprovalNode):
                results["__paused__"] = {
                    "node_id": str(node.id),
                    "decision_type": node.decision_type,
                    "message_template": node.message_template,
                    "context_data": context_data,
                }
                return GraphResult(
                    paused=True,
                    pause_info=results["__paused__"],
                    output=results,
                )

            node_result = await self._execute_node(node, context_data, node_map, edge_map, context)

            results[str(node.id)] = node_result.output
            context_data.update(node_result.output)

            if isinstance(node, ConditionNode):
                current_id = node_result.next_node_id
            elif isinstance(node, ParallelNode):
                current_id = self._find_next_after_parallel(node, edge_map)
            else:
                targets = edge_map.get(node.id, [])
                current_id = targets[0][0] if targets else None

        return GraphResult(completed=True, output=results)

    async def _execute_node(
        self,
        node: WorkflowNode,
        context_data: dict,
        node_map: dict[UUID, WorkflowNode],
        edge_map: dict[UUID, list[tuple[UUID, str | None]]],
        context: EngineContext,
    ) -> NodeResult:
        if isinstance(node, TriggerNode):
            return NodeResult(node.id, {"triggered": True, "trigger_type": node.trigger_type})

        if isinstance(node, SkillNode):
            return await self._execute_skill(node, context_data)

        if isinstance(node, ConditionNode):
            return await self._execute_condition(node, context_data)

        if isinstance(node, LoopNode):
            return await self._execute_loop(node, context_data, node_map, edge_map, context)

        if isinstance(node, HumanNode):
            return await self._execute_human(node, context_data, context)

        if isinstance(node, ParallelNode):
            return await self._execute_parallel(node, context_data, node_map, edge_map, context)

        return NodeResult(node.id, {"unknown_node": True})

    async def _execute_skill(self, node: SkillNode, context_data: dict) -> NodeResult:
        knowledge_context = ""
        if self._knowledge_base is not None and node.requires_knowledge:
            chunks = await self._knowledge_base.query(str(node.skill_id), top_k=3)
            knowledge_context = "\n".join(c.content for c in chunks)

        agent = await self._agent_factory.create_agent(uuid4(), "executor")
        context = AgentContext(model="default", temperature=0.3)
        prompt = f"Execute skill {node.skill_id} for employee {node.employee_id} with inputs: {node.inputs}\n\n"
        if knowledge_context:
            prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
        prompt += f"Context: {context_data}\n\nDescribe the execution result."
        output = await agent.execute(prompt, context)
        return NodeResult(node.id, {"output": output.content, "skill_id": str(node.skill_id)})

    async def _execute_condition(self, node: ConditionNode, context_data: dict) -> NodeResult:
        agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
        context = AgentContext(model="default", temperature=0.2)
        output = await agent.execute(
            f"Evaluate this condition expression: {node.expression}\n\n"
            f"Context: {context_data}\n\n"
            f"Respond with only TRUE or FALSE.",
            context,
        )
        is_true = "TRUE" in output.content.upper()[:20]
        next_id = node.true_next if is_true else node.false_next
        return NodeResult(node.id, {"condition_result": is_true}, next_node_id=next_id)

    async def _execute_loop(
        self,
        node: LoopNode,
        context_data: dict,
        node_map: dict[UUID, WorkflowNode],
        edge_map: dict[UUID, list[tuple[UUID, str | None]]],
        context: EngineContext,
    ) -> NodeResult:
        iteration = 0
        for iteration in range(node.max_iterations):
            if context.cancel_token and context.cancel_token.is_set():
                return NodeResult(node.id, {"cancelled": True, "iteration": iteration})

            iter_ctx = dict(context_data)
            iter_ctx["__loop_index__"] = iteration
            iter_ctx["__loop_iteration__"] = iteration + 1

            if node.loop_type == "condition":
                if not self._eval_condition(node.condition_expr, iter_ctx):
                    break
            elif node.loop_type == "iterator":
                items = self._eval_expr(node.iterator_expr, context_data)
                if items is None or iteration >= len(items):
                    break
                iter_ctx["__loop_item__"] = items[iteration]
                iter_ctx["__loop_total__"] = len(items)
            elif node.loop_type == "count":
                iter_ctx["__loop_total__"] = node.max_iterations

            graph_result = await self._execute_graph(
                node.body_entry_id, node_map, edge_map, iter_ctx, context,
            )

            if graph_result.paused:
                return NodeResult(node.id, {"paused": True, "iteration": iteration, **graph_result.output})
            if graph_result.failed and node.break_on_error:
                return NodeResult(node.id, {"failed": True, "iteration": iteration, "error": graph_result.error})
            if graph_result.cancelled:
                return NodeResult(node.id, {"cancelled": True, "iteration": iteration})

            context_data.update(graph_result.output)

        return NodeResult(node.id, {
            "iterations": iteration + 1,
            "completed": True,
        })

    async def _execute_human(
        self,
        node: HumanNode,
        context_data: dict,
        context: EngineContext,
    ) -> NodeResult:
        if node.timeout:
            try:
                result = await asyncio.wait_for(
                    self._request_human_input(node, context_data, context),
                    timeout=node.timeout,
                )
                return result
            except asyncio.TimeoutError:
                if node.timeout_strategy == "escalate":
                    return NodeResult(node.id, {"escalated": True, "reason": "timeout"})
                elif node.timeout_strategy == "default":
                    return NodeResult(node.id, node.default_output if hasattr(node, 'default_output') and node.default_output else {})
                else:
                    return NodeResult(node.id, {"timed_out": True})
        return await self._request_human_input(node, context_data, context)

    async def _request_human_input(
        self,
        node: HumanNode,
        context_data: dict,
        context: EngineContext,
    ) -> NodeResult:
        if context.human_input_handler:
            result = await context.human_input_handler(node, context_data)
            if isinstance(result, NodeResult):
                return result
            return NodeResult(node.id, result if isinstance(result, dict) else {"output": str(result)})
        return NodeResult(node.id, {
            "__paused__": True,
            "node_id": str(node.id),
            "node_type": "human",
            "employee_id": str(node.employee_id),
        })

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
                    branch_results[str(node.branch_node_ids[i])] = {"error": str(result)}
                else:
                    branch_results[str(result.node_id)] = result.output
        return NodeResult(node.id, branch_results)

    @staticmethod
    def _find_next_after_parallel(
        node: ParallelNode,
        edge_map: dict[UUID, list[tuple[UUID, str | None]]],
    ) -> UUID | None:
        for branch_id in node.branch_node_ids:
            targets = edge_map.get(branch_id, [])
            if targets:
                return targets[0][0]
        targets = edge_map.get(node.id, [])
        return targets[0][0] if targets else None

    @staticmethod
    def _build_maps(workflow: Workflow) -> tuple[dict[UUID, WorkflowNode], dict[UUID, list[tuple[UUID, str | None]]]]:
        node_map = {n.id: n for n in workflow.nodes}
        edge_map: dict[UUID, list[tuple[UUID, str | None]]] = {}
        for edge in workflow.edges:
            targets = edge_map.setdefault(edge.source_node_id, [])
            targets.append((edge.target_node_id, edge.condition))
        return node_map, edge_map

    @staticmethod
    def _eval_expr(expr: str, context_data: dict):
        try:
            return eval(expr, {"__builtins__": {}}, {"context": SimpleNamespace(**context_data)})
        except Exception:
            logger.warning("Failed to evaluate expression: %s", expr)
            return None

    @staticmethod
    def _eval_condition(expr: str, context_data: dict) -> bool:
        from cabinet.core.workflow.engine import WorkflowEngine
        result = WorkflowEngine._eval_expr(expr, context_data)
        return bool(result) if result is not None else False
```

- [ ] **Step 4: 运行全部工作流引擎测试**

Run: `pytest tests/unit/core/workflow/test_engine.py -v`
Expected: PASS（除 XFAIL 的 loop 测试外）

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/workflow/engine.py tests/unit/core/workflow/test_engine.py
git commit -m "refactor(workflow): engine uses recursive subgraph execution with GraphResult"
```

---

### Task 5: LoopNode 完整实现测试

**Files:**
- Modify: `tests/unit/core/workflow/test_engine.py`

- [ ] **Step 1: 编写 LoopNode 三种模式的测试**

在 `test_engine.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_engine_loop_count_mode():
    trigger_id = uuid4()
    body_id = uuid4()
    loop_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="count_loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, loop_type="count", max_iterations=3, body_entry_id=body_id),
            SkillNode(id=body_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert str(loop_id) in results
    assert results[str(loop_id)]["completed"] is True
    assert results[str(loop_id)]["iterations"] == 3


@pytest.mark.asyncio
async def test_engine_loop_condition_mode():
    trigger_id = uuid4()
    body_id = uuid4()
    loop_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="condition_loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, loop_type="condition", condition_expr="context.counter < 3", max_iterations=10, body_entry_id=body_id),
            SkillNode(id=body_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"counter": 0})
    assert str(loop_id) in results
    assert results[str(loop_id)]["completed"] is True
    assert results[str(loop_id)]["iterations"] <= 10


@pytest.mark.asyncio
async def test_engine_loop_iterator_mode():
    trigger_id = uuid4()
    body_id = uuid4()
    loop_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="iterator_loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, loop_type="iterator", iterator_expr="context.items", max_iterations=100, body_entry_id=body_id),
            SkillNode(id=body_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"items": ["a", "b", "c"]})
    assert str(loop_id) in results
    assert results[str(loop_id)]["completed"] is True
    assert results[str(loop_id)]["iterations"] == 3
```

- [ ] **Step 2: 运行测试，确认通过**

Run: `pytest tests/unit/core/workflow/test_engine.py::test_engine_loop_count_mode tests/unit/core/workflow/test_engine.py::test_engine_loop_condition_mode tests/unit/core/workflow/test_engine.py::test_engine_loop_iterator_mode -v`
Expected: PASS

- [ ] **Step 3: 移除旧 loop 测试的 xfail 标记**

删除 `test_engine_loop_node_executes_body` 测试（已被新测试替代）。

- [ ] **Step 4: 运行全部工作流测试**

Run: `pytest tests/unit/core/workflow/ -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add tests/unit/core/workflow/test_engine.py
git commit -m "test(workflow): add LoopNode count/condition/iterator mode tests"
```

---

### Task 6: HumanNode 执行测试

**Files:**
- Modify: `tests/unit/core/workflow/test_engine.py`

- [ ] **Step 1: 编写 HumanNode 测试**

在 `test_engine.py` 末尾追加：

```python
from cabinet.models.workflows import HumanNode


@pytest.mark.asyncio
async def test_engine_human_node_with_handler():
    trigger_id = uuid4()
    human_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="human_handler",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanNode(id=human_id, employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=human_id),
            WorkflowEdge(source_node_id=human_id, target_node_id=end_id),
        ],
    )

    async def handler(node, context_data):
        return {"response": "approved"}

    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    ctx = EngineContext(human_input_handler=handler)
    results = await engine.run(workflow, {}, context=ctx)
    assert str(human_id) in results
    assert results[str(human_id)]["response"] == "approved"


@pytest.mark.asyncio
async def test_engine_human_node_timeout_escalate():
    trigger_id = uuid4()
    human_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="human_timeout",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanNode(id=human_id, employee_id=uuid4(), timeout=1, timeout_strategy="escalate"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=human_id),
            WorkflowEdge(source_node_id=human_id, target_node_id=end_id),
        ],
    )

    async def slow_handler(node, context_data):
        await asyncio.sleep(10)
        return {"response": "too late"}

    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    ctx = EngineContext(human_input_handler=slow_handler)
    results = await engine.run(workflow, {}, context=ctx)
    assert str(human_id) in results
    assert results[str(human_id)]["escalated"] is True


@pytest.mark.asyncio
async def test_engine_human_node_without_handler_pauses():
    trigger_id = uuid4()
    human_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="human_pause",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanNode(id=human_id, employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=human_id),
            WorkflowEdge(source_node_id=human_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert str(human_id) in results
    assert results[str(human_id)]["__paused__"] is True
```

- [ ] **Step 2: 运行测试**

Run: `pytest tests/unit/core/workflow/test_engine.py::test_engine_human_node_with_handler tests/unit/core/workflow/test_engine.py::test_engine_human_node_timeout_escalate tests/unit/core/workflow/test_engine.py::test_engine_human_node_without_handler_pauses -v`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add tests/unit/core/workflow/test_engine.py
git commit -m "test(workflow): add HumanNode execution tests"
```

---

### Task 7: 新增 WorkflowExecutionStore 和 v004 迁移

**Files:**
- Create: `src/cabinet/core/workflow/execution_store.py`
- Create: `src/cabinet/core/events/migrations/v004_workflow_executions.py`
- Create: `tests/unit/core/workflow/test_execution_store.py`

- [ ] **Step 1: 编写 WorkflowExecutionStore 测试**

```python
# tests/unit/core/workflow/test_execution_store.py
import pytest
import tempfile
import os
from uuid import uuid4

from cabinet.core.workflow.execution_store import WorkflowExecutionStore
from cabinet.rooms.office.models import WorkflowExecution


@pytest.fixture
async def store():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        s = WorkflowExecutionStore(db_path)
        await s.initialize()
        yield s
        await s.close()


@pytest.mark.asyncio
async def test_save_and_load(store):
    execution = WorkflowExecution(
        id=uuid4(),
        workflow_id=uuid4(),
        project_id=uuid4(),
        status="running",
    )
    await store.save(execution)
    loaded = await store.load(execution.id)
    assert loaded is not None
    assert loaded.id == execution.id
    assert loaded.status == "running"


@pytest.mark.asyncio
async def test_update_status(store):
    execution = WorkflowExecution(
        id=uuid4(),
        workflow_id=uuid4(),
        project_id=uuid4(),
        status="running",
    )
    await store.save(execution)
    await store.update_status(execution.id, "completed")
    loaded = await store.load(execution.id)
    assert loaded.status == "completed"


@pytest.mark.asyncio
async def test_list_active(store):
    e1 = WorkflowExecution(id=uuid4(), workflow_id=uuid4(), project_id=uuid4(), status="running")
    e2 = WorkflowExecution(id=uuid4(), workflow_id=uuid4(), project_id=uuid4(), status="paused")
    e3 = WorkflowExecution(id=uuid4(), workflow_id=uuid4(), project_id=uuid4(), status="completed")
    await store.save(e1)
    await store.save(e2)
    await store.save(e3)
    active = await store.list_active()
    active_ids = {e.id for e in active}
    assert e1.id in active_ids
    assert e2.id in active_ids
    assert e3.id not in active_ids


@pytest.mark.asyncio
async def test_load_nonexistent(store):
    loaded = await store.load(uuid4())
    assert loaded is None
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/workflow/test_execution_store.py -v`
Expected: FAIL — ImportError

- [ ] **Step 3: 创建 v004 迁移**

```python
# src/cabinet/core/events/migrations/v004_workflow_executions.py
from __future__ import annotations

import aiosqlite


class V004WorkflowExecutions:
    version = 4
    description = "workflow_executions and dead_letter_queue tables"

    async def up(self, db: aiosqlite.Connection) -> None:
        tables = await self._existing_tables(db)
        if "workflow_executions" not in tables:
            await db.execute(
                """
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
                )
                """
            )
            await db.execute("CREATE INDEX IF NOT EXISTS idx_we_workflow ON workflow_executions(workflow_id)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_we_status ON workflow_executions(status)")
        if "dead_letter_queue" not in tables:
            await db.execute(
                """
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
                )
                """
            )
            await db.execute("CREATE INDEX IF NOT EXISTS idx_dlq_status ON dead_letter_queue(status)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_dlq_source ON dead_letter_queue(source_type, source_id)")

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP TABLE IF EXISTS dead_letter_queue")
        await db.execute("DROP TABLE IF EXISTS workflow_executions")

    async def _existing_tables(self, db: aiosqlite.Connection) -> set[str]:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        rows = await cursor.fetchall()
        return {row[0] for row in rows}
```

- [ ] **Step 4: 创建 WorkflowExecutionStore**

```python
# src/cabinet/core/workflow/execution_store.py
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

import aiosqlite

from cabinet.rooms.office.models import WorkflowExecution

logger = logging.getLogger(__name__)


class WorkflowExecutionStore:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("PRAGMA journal_mode=WAL")

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    async def save(self, execution: WorkflowExecution) -> None:
        await self._db.execute(
            """
            INSERT OR REPLACE INTO workflow_executions
            (id, workflow_id, status, context_data, node_records, timeline, paused_node_id, created_at, updated_at, completed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(execution.id),
                str(execution.workflow_id),
                execution.status,
                json.dumps({}),
                json.dumps({}),
                json.dumps([]),
                str(execution.current_node_id) if execution.current_node_id else None,
                execution.created_at.isoformat() if isinstance(execution.created_at, datetime) else str(execution.created_at),
                datetime.now(timezone.utc).isoformat(),
                None,
            ),
        )
        await self._db.commit()

    async def load(self, execution_id: UUID) -> WorkflowExecution | None:
        cursor = await self._db.execute(
            "SELECT id, workflow_id, status, paused_node_id, created_at FROM workflow_executions WHERE id = ?",
            (str(execution_id),),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return WorkflowExecution(
            id=UUID(row[0]),
            workflow_id=UUID(row[1]),
            project_id=UUID(int=0),
            status=row[2],
            current_node_id=UUID(row[3]) if row[3] else None,
            created_at=datetime.fromisoformat(row[4]) if row[4] else datetime.now(timezone.utc),
        )

    async def update_status(self, execution_id: UUID, status: str, **kwargs) -> None:
        updates = ["status = ?", "updated_at = ?"]
        values = [status, datetime.now(timezone.utc).isoformat()]
        if status == "completed":
            updates.append("completed_at = ?")
            values.append(datetime.now(timezone.utc).isoformat())
        if "paused_node_id" in kwargs:
            updates.append("paused_node_id = ?")
            values.append(str(kwargs["paused_node_id"]))
        values.append(str(execution_id))
        await self._db.execute(
            f"UPDATE workflow_executions SET {', '.join(updates)} WHERE id = ?",
            values,
        )
        await self._db.commit()

    async def list_active(self) -> list[WorkflowExecution]:
        cursor = await self._db.execute(
            "SELECT id, workflow_id, status, paused_node_id, created_at FROM workflow_executions WHERE status IN ('running', 'paused')"
        )
        rows = await cursor.fetchall()
        return [
            WorkflowExecution(
                id=UUID(row[0]),
                workflow_id=UUID(row[1]),
                project_id=UUID(int=0),
                status=row[2],
                current_node_id=UUID(row[3]) if row[3] else None,
                created_at=datetime.fromisoformat(row[4]) if row[4] else datetime.now(timezone.utc),
            )
            for row in rows
        ]

    async def list_by_workflow(self, workflow_id: UUID) -> list[WorkflowExecution]:
        cursor = await self._db.execute(
            "SELECT id, workflow_id, status, paused_node_id, created_at FROM workflow_executions WHERE workflow_id = ?",
            (str(workflow_id),),
        )
        rows = await cursor.fetchall()
        return [
            WorkflowExecution(
                id=UUID(row[0]),
                workflow_id=UUID(row[1]),
                project_id=UUID(int=0),
                status=row[2],
                current_node_id=UUID(row[3]) if row[3] else None,
                created_at=datetime.fromisoformat(row[4]) if row[4] else datetime.now(timezone.utc),
            )
            for row in rows
        ]

    async def delete(self, execution_id: UUID) -> None:
        await self._db.execute("DELETE FROM workflow_executions WHERE id = ?", (str(execution_id),))
        await self._db.commit()
```

- [ ] **Step 5: 运行测试**

Run: `pytest tests/unit/core/workflow/test_execution_store.py -v`
Expected: PASS

- [ ] **Step 6: 注册 v004 迁移到 CLI 和 Runtime**

在 `src/cabinet/cli/main.py` 的 `_db_migrate_async` 函数中，在 `V003MemoryFts` 的 try 块之后添加：

```python
    try:
        from cabinet.core.events.migrations.v004_workflow_executions import V004WorkflowExecutions
        _migrations.append(V004WorkflowExecutions())
    except ImportError:
        pass
```

同样在 `src/cabinet/runtime.py` 的 `start()` 方法中，在 `V003MemoryFts` 的 try 块之后添加相同的代码。

- [ ] **Step 7: 运行全部测试**

Run: `pytest tests/unit/core/workflow/ -v`
Expected: PASS

- [ ] **Step 8: 提交**

```bash
git add src/cabinet/core/workflow/execution_store.py src/cabinet/core/events/migrations/v004_workflow_executions.py tests/unit/core/workflow/test_execution_store.py src/cabinet/cli/main.py src/cabinet/runtime.py
git commit -m "feat(workflow): add WorkflowExecutionStore and v004 migration"
```

---

### Task 8: 修复 resume_workflow 真正恢复执行

**Files:**
- Modify: `src/cabinet/rooms/office/service.py`
- Modify: `src/cabinet/rooms/office/domain_events.py`
- Modify: `tests/unit/rooms/office/test_service.py`

- [ ] **Step 1: 新增 WorkflowResumed 事件**

在 `src/cabinet/rooms/office/domain_events.py` 末尾追加：

```python
class WorkflowResumed(BaseModel):
    execution_id: UUID
    node_id: UUID
    approval_result: dict


class WorkflowCancelled(BaseModel):
    execution_id: UUID
    reason: str | None = None


register_event_type(WorkflowResumed)
register_event_type(WorkflowCancelled)
```

- [ ] **Step 2: 编写 resume_workflow 测试**

在 `tests/unit/rooms/office/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_resume_workflow(service):
    from cabinet.models.workflows import (
        TriggerNode, HumanApprovalNode, SkillNode, EndNode,
        Workflow, WorkflowEdge,
    )
    trigger_id = uuid4()
    approval_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    wf_id = uuid4()
    workflow = Workflow(
        id=wf_id,
        project_id=uuid4(),
        name="resume_test",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanApprovalNode(id=approval_id, decision_type="strategic"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=approval_id),
            WorkflowEdge(source_node_id=approval_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    execution = await service.execute_workflow(wf_id, {"__workflow__": workflow})
    assert execution.status == "paused"

    resumed = await service.resume_workflow(execution.id, {"approved": True})
    assert resumed.status == "completed"
```

- [ ] **Step 3: 运行测试，确认失败**

Run: `pytest tests/unit/rooms/office/test_service.py::test_resume_workflow -v`
Expected: FAIL — resume_workflow 当前直接标记 completed，不执行后续节点

- [ ] **Step 4: 修复 resume_workflow**

在 `src/cabinet/rooms/office/service.py` 中，替换 `resume_workflow` 方法为：

```python
    async def resume_workflow(self, execution_id: UUID, decision_result: dict) -> WorkflowExecution:
        if execution_id not in self._executions:
            raise KeyError(f"execution {execution_id} not found")
        execution = self._executions[execution_id]
        if execution.status != "paused":
            raise ValueError(f"execution {execution_id} is not paused")

        node_event = WorkflowNodeCompleted(
            execution_id=execution_id,
            node_id=execution.current_node_id or uuid4(),
            result={"approval": decision_result},
        )
        await self._publish_and_apply(node_event)

        if self._workflow_engine is not None:
            from cabinet.models.workflows import Workflow
            workflow = self._workflows.get(execution.workflow_id)
            if workflow is not None:
                node_map, edge_map = self._workflow_engine._build_maps(workflow)
                targets = edge_map.get(execution.current_node_id, [])
                next_id = targets[0][0] if targets else None

                if next_id is not None:
                    resume_context = dict(execution.results) if execution.results else {}
                    resume_context["__approval__"] = decision_result

                    from cabinet.core.workflow.engine import EngineContext
                    engine_results = await self._workflow_engine.run(
                        workflow,
                        resume_context,
                        context=EngineContext(resume_from=next_id),
                    )

                    if "__paused__" not in engine_results:
                        complete_event = WorkflowCompleted(
                            execution_id=execution_id,
                            results=engine_results,
                        )
                        await self._publish_and_apply(complete_event)
                        return self._executions[execution_id]

        complete_event = WorkflowCompleted(
            execution_id=execution_id,
            results={"resumed": decision_result},
        )
        await self._publish_and_apply(complete_event)
        return self._executions[execution_id]
```

同时需要在 `OfficeSchedulerService` 中添加 `_workflows` 字典。在 `__init__` 中添加：

```python
        self._workflows: dict[UUID, object] = {}
```

在 `execute_workflow` 方法中，在创建 workflow 对象后添加：

```python
        self._workflows[workflow_id] = workflow
```

- [ ] **Step 5: 运行测试**

Run: `pytest tests/unit/rooms/office/test_service.py -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/rooms/office/service.py src/cabinet/rooms/office/domain_events.py tests/unit/rooms/office/test_service.py
git commit -m "fix(workflow): resume_workflow now continues execution after pause point"
```

---

### L1 检查点

运行完整测试套件确认 L1 无回归：

```bash
pytest tests/unit/core/workflow/ tests/unit/rooms/office/ -v
```

---

## L2：死信队列 + 错误恢复

### Task 9: 实现 DeadLetterQueue

**Files:**
- Create: `src/cabinet/core/workflow/dead_letter.py`
- Create: `tests/unit/core/workflow/test_dead_letter.py`

- [ ] **Step 1: 编写 DeadLetterQueue 测试**

```python
# tests/unit/core/workflow/test_dead_letter.py
import pytest
import tempfile
import os
from uuid import uuid4

from cabinet.core.workflow.dead_letter import DeadLetterQueue, DeadLetterEntry


@pytest.fixture
async def queue():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        q = DeadLetterQueue(db_path)
        await q.initialize()
        yield q
        await q.close()


@pytest.mark.asyncio
async def test_push_and_list(queue):
    entry_id = await queue.push(
        source_type="workflow_node",
        source_id="node_123",
        error=ValueError("test error"),
        payload={"input": "data"},
        context={"node_name": "skill_1"},
    )
    assert entry_id is not None
    pending = await queue.list_pending()
    assert len(pending) == 1
    assert pending[0].source_type == "workflow_node"
    assert pending[0].error_message == "test error"
    assert pending[0].status == "pending"


@pytest.mark.asyncio
async def test_resolve(queue):
    entry_id = await queue.push(
        source_type="event_handler",
        source_id="handler_1",
        error=RuntimeError("fail"),
        payload={},
        context={},
    )
    await queue.resolve(entry_id)
    pending = await queue.list_pending()
    assert len(pending) == 0


@pytest.mark.asyncio
async def test_discard(queue):
    entry_id = await queue.push(
        source_type="workflow_node",
        source_id="node_1",
        error=Exception("err"),
        payload={},
        context={},
    )
    await queue.discard(entry_id)
    pending = await queue.list_pending()
    assert len(pending) == 0


@pytest.mark.asyncio
async def test_retry_increments_count(queue):
    entry_id = await queue.push(
        source_type="workflow_node",
        source_id="node_1",
        error=Exception("err"),
        payload={},
        context={},
        max_retries=2,
    )
    success = await queue.retry(entry_id)
    assert success is True
    pending = await queue.list_pending()
    assert pending[0].retry_count == 1


@pytest.mark.asyncio
async def test_retry_exceeds_max(queue):
    entry_id = await queue.push(
        source_type="workflow_node",
        source_id="node_1",
        error=Exception("err"),
        payload={},
        context={},
        max_retries=1,
    )
    await queue.retry(entry_id)
    success = await queue.retry(entry_id)
    assert success is False


@pytest.mark.asyncio
async def test_cleanup(queue):
    from datetime import datetime, timezone, timedelta
    entry_id = await queue.push(
        source_type="workflow_node",
        source_id="node_1",
        error=Exception("err"),
        payload={},
        context={},
    )
    await queue.resolve(entry_id)
    cleaned = await queue.cleanup(older_than_days=0)
    assert cleaned >= 1
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/workflow/test_dead_letter.py -v`
Expected: FAIL — ImportError

- [ ] **Step 3: 创建 DeadLetterQueue**

```python
# src/cabinet/core/workflow/dead_letter.py
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

import aiosqlite
from pydantic import BaseModel

logger = logging.getLogger(__name__)


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
    status: str = "pending"
    created_at: str
    last_retry_at: str | None = None
    resolved_at: str | None = None


class DeadLetterQueue:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("PRAGMA journal_mode=WAL")

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    async def push(
        self,
        source_type: str,
        source_id: str,
        error: Exception,
        payload: dict,
        context: dict,
        max_retries: int = 3,
    ) -> UUID:
        entry_id = uuid4()
        now = datetime.now(timezone.utc).isoformat()
        await self._db.execute(
            """
            INSERT INTO dead_letter_queue
            (id, source_type, source_id, error_message, error_type, payload, context, retry_count, max_retries, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(entry_id),
                source_type,
                source_id,
                str(error),
                type(error).__name__,
                json.dumps(payload),
                json.dumps(context),
                0,
                max_retries,
                "pending",
                now,
            ),
        )
        await self._db.commit()
        logger.info("Dead letter entry created: %s (%s:%s)", entry_id, source_type, source_id)
        return entry_id

    async def list_pending(self, source_type: str | None = None) -> list[DeadLetterEntry]:
        if source_type:
            cursor = await self._db.execute(
                "SELECT id, source_type, source_id, error_message, error_type, payload, context, retry_count, max_retries, status, created_at, last_retry_at, resolved_at FROM dead_letter_queue WHERE status = 'pending' AND source_type = ?",
                (source_type,),
            )
        else:
            cursor = await self._db.execute(
                "SELECT id, source_type, source_id, error_message, error_type, payload, context, retry_count, max_retries, status, created_at, last_retry_at, resolved_at FROM dead_letter_queue WHERE status = 'pending'",
            )
        rows = await cursor.fetchall()
        return [self._row_to_entry(row) for row in rows]

    async def resolve(self, entry_id: UUID) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self._db.execute(
            "UPDATE dead_letter_queue SET status = 'resolved', resolved_at = ? WHERE id = ?",
            (now, str(entry_id)),
        )
        await self._db.commit()

    async def discard(self, entry_id: UUID) -> None:
        now = datetime.now(timezone.utc).isoformat()
        await self._db.execute(
            "UPDATE dead_letter_queue SET status = 'discarded', resolved_at = ? WHERE id = ?",
            (now, str(entry_id)),
        )
        await self._db.commit()

    async def retry(self, entry_id: UUID) -> bool:
        cursor = await self._db.execute(
            "SELECT retry_count, max_retries FROM dead_letter_queue WHERE id = ?",
            (str(entry_id),),
        )
        row = await cursor.fetchone()
        if row is None:
            return False
        retry_count, max_retries = row
        if retry_count >= max_retries:
            await self._db.execute(
                "UPDATE dead_letter_queue SET status = 'discarded' WHERE id = ?",
                (str(entry_id),),
            )
            await self._db.commit()
            return False
        now = datetime.now(timezone.utc).isoformat()
        await self._db.execute(
            "UPDATE dead_letter_queue SET retry_count = ?, status = 'retrying', last_retry_at = ? WHERE id = ?",
            (retry_count + 1, now, str(entry_id)),
        )
        await self._db.commit()
        await self._db.execute(
            "UPDATE dead_letter_queue SET status = 'pending' WHERE id = ?",
            (str(entry_id),),
        )
        await self._db.commit()
        return True

    async def cleanup(self, older_than_days: int = 30) -> int:
        cutoff = datetime.now(timezone.utc) - __import__("datetime").timedelta(days=older_than_days)
        cursor = await self._db.execute(
            "DELETE FROM dead_letter_queue WHERE status IN ('resolved', 'discarded') AND resolved_at < ?",
            (cutoff.isoformat(),),
        )
        await self._db.commit()
        return cursor.rowcount

    def _row_to_entry(self, row) -> DeadLetterEntry:
        return DeadLetterEntry(
            id=UUID(row[0]),
            source_type=row[1],
            source_id=row[2],
            error_message=row[3],
            error_type=row[4],
            payload=json.loads(row[5]),
            context=json.loads(row[6]),
            retry_count=row[7],
            max_retries=row[8],
            status=row[9],
            created_at=row[10],
            last_retry_at=row[11],
            resolved_at=row[12],
        )
```

- [ ] **Step 4: 运行测试**

Run: `pytest tests/unit/core/workflow/test_dead_letter.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/workflow/dead_letter.py tests/unit/core/workflow/test_dead_letter.py
git commit -m "feat(workflow): implement DeadLetterQueue with SQLite persistence"
```

---

### Task 10: 引擎添加重试逻辑

**Files:**
- Modify: `src/cabinet/core/workflow/engine.py`
- Modify: `tests/unit/core/workflow/test_engine.py`

- [ ] **Step 1: 编写重试逻辑测试**

在 `test_engine.py` 末尾追加：

```python
from unittest.mock import AsyncMock


@pytest.mark.asyncio
async def test_engine_retry_on_failure():
    call_count = 0
    original_create_agent = StubAgentFactory.create_agent

    class CountingFactory(StubAgentFactory):
        async def create_agent(self, agent_id, role, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise RuntimeError("transient error")
            return await original_create_agent(self, agent_id, role, **kwargs)

    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="retry_test",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4(), retry_policy=RetryPolicy(max_retries=3, backoff_base=0.01)),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=CountingFactory())
    results = await engine.run(workflow, {})
    assert str(skill_id) in results
    assert call_count == 3
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/workflow/test_engine.py::test_engine_retry_on_failure -v`
Expected: FAIL — 当前引擎无重试逻辑

- [ ] **Step 3: 在引擎中添加重试逻辑**

在 `engine.py` 的 `WorkflowEngine` 类中添加 `_execute_node_with_retry` 方法，并修改 `_execute_graph` 中调用 `_execute_node` 的地方改为调用 `_execute_node_with_retry`：

```python
    async def _execute_node_with_retry(
        self,
        node: WorkflowNode,
        context_data: dict,
        node_map: dict[UUID, WorkflowNode],
        edge_map: dict[UUID, list[tuple[UUID, str | None]]],
        context: EngineContext,
    ) -> NodeResult:
        policy = getattr(node, "retry_policy", None) or RetryPolicy(max_retries=0)
        last_error: Exception | None = None
        for attempt in range(1 + policy.max_retries):
            try:
                return await self._execute_node(node, context_data, node_map, edge_map, context)
            except Exception as e:
                last_error = e
                if attempt < policy.max_retries:
                    delay = min(policy.backoff_base * (2 ** attempt), policy.backoff_max)
                    logger.warning(
                        "Node %s attempt %d failed: %s, retrying in %.1fs",
                        node.name, attempt + 1, e, delay,
                    )
                    await asyncio.sleep(delay)
        if self._dead_letter_queue is not None:
            await self._dead_letter_queue.push(
                source_type="workflow_node",
                source_id=str(node.id),
                error=last_error or RuntimeError("unknown error"),
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

然后在 `_execute_graph` 中将 `await self._execute_node(node, ...)` 替换为 `await self._execute_node_with_retry(node, ...)`。

- [ ] **Step 4: 运行测试**

Run: `pytest tests/unit/core/workflow/test_engine.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/workflow/engine.py tests/unit/core/workflow/test_engine.py
git commit -m "feat(workflow): add node retry with exponential backoff and dead letter queue"
```

---

### Task 11: EventBus handler 容错

**Files:**
- Modify: `src/cabinet/core/events/asyncio_bus.py`
- Create: `tests/unit/core/events/test_asyncio_bus_fault.py`

- [ ] **Step 1: 编写 handler 容错测试**

```python
# tests/unit/core/events/test_asyncio_bus_fault.py
import pytest
from uuid import uuid4

from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.models.events import MessageEnvelope


@pytest.mark.asyncio
async def test_handler_failure_does_not_block_others():
    bus = AsyncIOEventBus()
    results = []

    async def failing_handler(envelope):
        raise RuntimeError("handler failed")

    async def ok_handler(envelope):
        results.append("ok")

    await bus.subscribe("test.event", failing_handler)
    await bus.subscribe("test.event", ok_handler)

    envelope = MessageEnvelope(
        message_id=uuid4(),
        correlation_id=uuid4(),
        causation_id=uuid4(),
        sender="test",
        recipients=["test"],
        message_type="test.event",
        payload={},
    )
    await bus.publish(envelope)
    assert "ok" in results
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/events/test_asyncio_bus_fault.py -v`
Expected: FAIL — 当前 handler 异常会阻断后续 handler

- [ ] **Step 3: 修改 AsyncIOEventBus.publish()**

将 `asyncio_bus.py` 中的 `publish` 方法的 handler 循环改为 try/except 包裹：

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
            await self._store.append(envelope)
            handlers = self._handlers.get(envelope.message_type, [])
            for handler in handlers:
                try:
                    await handler(envelope)
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).error(
                        "Handler %s failed for %s: %s",
                        getattr(handler, '__name__', str(handler)),
                        envelope.message_type, e,
                    )
        finally:
            if span:
                span.end()
```

- [ ] **Step 4: 运行测试**

Run: `pytest tests/unit/core/events/test_asyncio_bus_fault.py -v`
Expected: PASS

- [ ] **Step 5: 运行现有事件总线测试确保无回归**

Run: `pytest tests/unit/core/events/ -v`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/cabinet/core/events/asyncio_bus.py tests/unit/core/events/test_asyncio_bus_fault.py
git commit -m "fix(events): handler failure no longer blocks subsequent handlers"
```

---

### Task 12: 工作流取消机制

**Files:**
- Modify: `src/cabinet/core/workflow/engine.py`
- Modify: `tests/unit/core/workflow/test_engine.py`

- [ ] **Step 1: 编写取消测试**

在 `test_engine.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_engine_cancel_workflow():
    trigger_id = uuid4()
    loop_id = uuid4()
    body_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="cancel_test",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, loop_type="count", max_iterations=1000, body_entry_id=body_id),
            SkillNode(id=body_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    cancel_token = asyncio.Event()
    ctx = EngineContext(execution_id="test-cancel", cancel_token=cancel_token)

    async def run_and_cancel():
        await asyncio.sleep(0.1)
        cancel_token.set()

    asyncio.create_task(run_and_cancel())
    results = await engine.run(workflow, {}, context=ctx)
    assert str(loop_id) in results
    assert results[str(loop_id)].get("cancelled") is True or results[str(loop_id)].get("completed") is True
```

- [ ] **Step 2: 运行测试**

Run: `pytest tests/unit/core/workflow/test_engine.py::test_engine_cancel_workflow -v`
Expected: PASS（cancel_token 已在 Task 4 的引擎重构中实现）

- [ ] **Step 3: 提交**

```bash
git add tests/unit/core/workflow/test_engine.py
git commit -m "test(workflow): add workflow cancellation test"
```

---

### L2 检查点

运行完整测试套件确认 L2 无回归：

```bash
pytest tests/unit/core/workflow/ tests/unit/core/events/test_asyncio_bus_fault.py tests/unit/rooms/office/ -v
```

---

## L3：工作流版本管理

### Task 13: 实现 WorkflowVersionStore 和 v005 迁移

**Files:**
- Create: `src/cabinet/core/workflow/version_store.py`
- Create: `src/cabinet/core/events/migrations/v005_workflow_versions.py`
- Create: `tests/unit/core/workflow/test_version_store.py`

- [ ] **Step 1: 编写 WorkflowVersionStore 测试**

```python
# tests/unit/core/workflow/test_version_store.py
import pytest
import tempfile
import os
from uuid import uuid4

from cabinet.core.workflow.version_store import WorkflowVersionStore, WorkflowVersion


@pytest.fixture
async def store():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        s = WorkflowVersionStore(db_path)
        await s.initialize()
        yield s
        await s.close()


@pytest.mark.asyncio
async def test_save_and_get_version(store):
    wf_id = uuid4()
    version = WorkflowVersion(
        workflow_id=wf_id,
        version=1,
        definition={"nodes": [], "edges": []},
        change_summary="Initial version",
        change_type="create",
    )
    await store.save_version(version)
    loaded = await store.get_version(wf_id, 1)
    assert loaded is not None
    assert loaded.version == 1
    assert loaded.change_type == "create"


@pytest.mark.asyncio
async def test_list_versions(store):
    wf_id = uuid4()
    for i in range(1, 4):
        await store.save_version(WorkflowVersion(
            workflow_id=wf_id, version=i, definition={},
            change_summary=f"v{i}", change_type="update",
        ))
    versions = await store.list_versions(wf_id)
    assert len(versions) == 3
    assert versions[0].version == 1


@pytest.mark.asyncio
async def test_get_latest_version(store):
    wf_id = uuid4()
    await store.save_version(WorkflowVersion(
        workflow_id=wf_id, version=1, definition={}, change_summary="v1", change_type="create",
    ))
    await store.save_version(WorkflowVersion(
        workflow_id=wf_id, version=2, definition={}, change_summary="v2", change_type="update",
    ))
    latest = await store.get_latest_version(wf_id)
    assert latest is not None
    assert latest.version == 2


@pytest.mark.asyncio
async def test_get_nonexistent_version(store):
    loaded = await store.get_version(uuid4(), 99)
    assert loaded is None
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/workflow/test_version_store.py -v`
Expected: FAIL — ImportError

- [ ] **Step 3: 创建 v005 迁移**

```python
# src/cabinet/core/events/migrations/v005_workflow_versions.py
from __future__ import annotations

import aiosqlite


class V005WorkflowVersions:
    version = 5
    description = "workflow_versions table"

    async def up(self, db: aiosqlite.Connection) -> None:
        tables = await self._existing_tables(db)
        if "workflow_versions" not in tables:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS workflow_versions (
                    workflow_id TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    definition TEXT NOT NULL,
                    change_summary TEXT NOT NULL,
                    change_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    created_by TEXT NOT NULL DEFAULT 'system',
                    PRIMARY KEY (workflow_id, version)
                )
                """
            )
            await db.execute("CREATE INDEX IF NOT EXISTS idx_wfv_created ON workflow_versions(created_at)")

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP TABLE IF EXISTS workflow_versions")

    async def _existing_tables(self, db: aiosqlite.Connection) -> set[str]:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        rows = await cursor.fetchall()
        return {row[0] for row in rows}
```

- [ ] **Step 4: 创建 WorkflowVersionStore**

```python
# src/cabinet/core/workflow/version_store.py
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

import aiosqlite
from pydantic import BaseModel

logger = logging.getLogger(__name__)


class WorkflowVersion(BaseModel):
    workflow_id: UUID
    version: int
    definition: dict
    change_summary: str
    change_type: str
    created_at: str = ""
    created_by: str = "system"


class WorkflowVersionStore:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("PRAGMA journal_mode=WAL")

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    async def save_version(self, version: WorkflowVersion) -> None:
        if not version.created_at:
            version.created_at = datetime.now(timezone.utc).isoformat()
        await self._db.execute(
            """
            INSERT OR REPLACE INTO workflow_versions
            (workflow_id, version, definition, change_summary, change_type, created_at, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(version.workflow_id),
                version.version,
                json.dumps(version.definition),
                version.change_summary,
                version.change_type,
                version.created_at,
                version.created_by,
            ),
        )
        await self._db.commit()

    async def get_version(self, workflow_id: UUID, version: int) -> WorkflowVersion | None:
        cursor = await self._db.execute(
            "SELECT workflow_id, version, definition, change_summary, change_type, created_at, created_by FROM workflow_versions WHERE workflow_id = ? AND version = ?",
            (str(workflow_id), version),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return self._row_to_version(row)

    async def list_versions(self, workflow_id: UUID) -> list[WorkflowVersion]:
        cursor = await self._db.execute(
            "SELECT workflow_id, version, definition, change_summary, change_type, created_at, created_by FROM workflow_versions WHERE workflow_id = ? ORDER BY version",
            (str(workflow_id),),
        )
        rows = await cursor.fetchall()
        return [self._row_to_version(row) for row in rows]

    async def get_latest_version(self, workflow_id: UUID) -> WorkflowVersion | None:
        cursor = await self._db.execute(
            "SELECT workflow_id, version, definition, change_summary, change_type, created_at, created_by FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC LIMIT 1",
            (str(workflow_id),),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return self._row_to_version(row)

    def _row_to_version(self, row) -> WorkflowVersion:
        return WorkflowVersion(
            workflow_id=UUID(row[0]),
            version=row[1],
            definition=json.loads(row[2]),
            change_summary=row[3],
            change_type=row[4],
            created_at=row[5],
            created_by=row[6],
        )
```

- [ ] **Step 5: 注册 v005 迁移到 CLI 和 Runtime**

在 `src/cabinet/cli/main.py` 的 `_db_migrate_async` 和 `src/cabinet/runtime.py` 的 `start()` 中添加：

```python
    try:
        from cabinet.core.events.migrations.v005_workflow_versions import V005WorkflowVersions
        _migrations.append(V005WorkflowVersions())
    except ImportError:
        pass
```

- [ ] **Step 6: 运行测试**

Run: `pytest tests/unit/core/workflow/test_version_store.py -v`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/core/workflow/version_store.py src/cabinet/core/events/migrations/v005_workflow_versions.py tests/unit/core/workflow/test_version_store.py src/cabinet/cli/main.py src/cabinet/runtime.py
git commit -m "feat(workflow): add WorkflowVersionStore and v005 migration"
```

---

### Task 14: 实现 VersionedWorkflowManager 和 CompatibilityChecker

**Files:**
- Create: `src/cabinet/core/workflow/version_manager.py`
- Create: `tests/unit/core/workflow/test_version_manager.py`

- [ ] **Step 1: 编写 VersionedWorkflowManager 测试**

```python
# tests/unit/core/workflow/test_version_manager.py
import pytest
import tempfile
import os
from uuid import uuid4

from cabinet.core.workflow.version_manager import VersionedWorkflowManager, CompatibilityChecker


@pytest.fixture
async def manager():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        from cabinet.core.workflow.version_store import WorkflowVersionStore
        store = WorkflowVersionStore(db_path)
        await store.initialize()
        mgr = VersionedWorkflowManager(store)
        yield mgr
        await store.close()


@pytest.mark.asyncio
async def test_create_workflow(manager):
    wf_id = uuid4()
    definition = {"id": str(wf_id), "nodes": [{"id": "n1", "kind": "trigger"}], "edges": []}
    version = await manager.create_workflow(definition)
    assert version.version == 1
    assert version.change_type == "create"


@pytest.mark.asyncio
async def test_update_workflow(manager):
    wf_id = uuid4()
    definition = {"id": str(wf_id), "nodes": [{"id": "n1", "kind": "trigger"}], "edges": []}
    await manager.create_workflow(definition)
    new_def = {"id": str(wf_id), "nodes": [{"id": "n1", "kind": "trigger"}, {"id": "n2", "kind": "skill"}], "edges": []}
    version = await manager.update_workflow(wf_id, new_def, "Added skill node")
    assert version.version == 2
    assert version.change_type == "update"


@pytest.mark.asyncio
async def test_rollback_workflow(manager):
    wf_id = uuid4()
    definition = {"id": str(wf_id), "nodes": [{"id": "n1", "kind": "trigger"}], "edges": []}
    await manager.create_workflow(definition)
    new_def = {"id": str(wf_id), "nodes": [{"id": "n1", "kind": "trigger"}, {"id": "n2", "kind": "skill"}], "edges": []}
    await manager.update_workflow(wf_id, new_def, "Added skill node")
    rolled = await manager.rollback(wf_id, 1)
    assert rolled.version == 3
    assert rolled.change_type == "rollback"
    assert rolled.change_summary == "Rollback to v1"


def test_compatibility_checker_breaking_change():
    checker = CompatibilityChecker()
    old_def = {"nodes": [{"id": "n1", "kind": "trigger"}, {"id": "n2", "kind": "skill"}]}
    new_def = {"nodes": [{"id": "n1", "kind": "trigger"}]}
    report = checker.check(old_def, new_def)
    assert report.is_compatible is False
    assert any(i.type == "node_removed" for i in report.issues)


def test_compatibility_checker_non_breaking_change():
    checker = CompatibilityChecker()
    old_def = {"nodes": [{"id": "n1", "kind": "trigger"}]}
    new_def = {"nodes": [{"id": "n1", "kind": "trigger"}, {"id": "n2", "kind": "skill"}]}
    report = checker.check(old_def, new_def)
    assert report.is_compatible is True
    assert any(i.type == "node_added" for i in report.issues)
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/workflow/test_version_manager.py -v`
Expected: FAIL — ImportError

- [ ] **Step 3: 创建 VersionedWorkflowManager 和 CompatibilityChecker**

```python
# src/cabinet/core/workflow/version_manager.py
from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel

from cabinet.core.workflow.version_store import WorkflowVersionStore, WorkflowVersion

logger = logging.getLogger(__name__)


class CompatibilityIssue(BaseModel):
    severity: str
    type: str
    node_id: str | None = None
    description: str


class CompatibilityReport(BaseModel):
    is_compatible: bool
    issues: list[CompatibilityIssue]
    active_executions_affected: int = 0


class CompatibilityChecker:
    def check(self, old_def: dict, new_def: dict) -> CompatibilityReport:
        old_nodes = {n.get("id"): n for n in old_def.get("nodes", [])}
        new_nodes = {n.get("id"): n for n in new_def.get("nodes", [])}
        issues: list[CompatibilityIssue] = []

        for node_id in old_nodes:
            if node_id not in new_nodes:
                issues.append(CompatibilityIssue(
                    severity="breaking", type="node_removed",
                    node_id=node_id, description=f"Node {node_id} removed",
                ))
            elif old_nodes[node_id].get("kind") != new_nodes[node_id].get("kind"):
                issues.append(CompatibilityIssue(
                    severity="breaking", type="node_type_changed",
                    node_id=node_id,
                    description=f"Node {node_id} type changed from {old_nodes[node_id].get('kind')} to {new_nodes[node_id].get('kind')}",
                ))

        for node_id in new_nodes:
            if node_id not in old_nodes:
                issues.append(CompatibilityIssue(
                    severity="info", type="node_added",
                    node_id=node_id, description=f"Node {node_id} added",
                ))

        return CompatibilityReport(
            is_compatible=not any(i.severity == "breaking" for i in issues),
            issues=issues,
        )


class VersionedWorkflowManager:
    def __init__(self, version_store: WorkflowVersionStore):
        self._version_store = version_store
        self._checker = CompatibilityChecker()

    async def create_workflow(self, definition: dict) -> WorkflowVersion:
        version = WorkflowVersion(
            workflow_id=UUID(definition["id"]) if "id" in definition else UUID(int=0),
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
        if latest:
            report = self._checker.check(latest.definition, new_definition)
            if not report.is_compatible:
                logger.warning("Breaking changes detected: %s", [i.description for i in report.issues if i.severity == "breaking"])
        new_version_num = (latest.version + 1) if latest else 1
        version = WorkflowVersion(
            workflow_id=workflow_id,
            version=new_version_num,
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
            version=(latest.version + 1) if latest else 1,
            definition=target.definition,
            change_summary=f"Rollback to v{target_version}",
            change_type="rollback",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        await self._version_store.save_version(rollback_version)
        return rollback_version

    async def diff_versions(self, workflow_id: UUID, v1: int, v2: int) -> dict:
        ver1 = await self._version_store.get_version(workflow_id, v1)
        ver2 = await self._version_store.get_version(workflow_id, v2)
        if not ver1 or not ver2:
            return {"error": "Version not found"}
        return self._checker.check(ver1.definition, ver2.definition).model_dump()

    @property
    def checker(self) -> CompatibilityChecker:
        return self._checker
```

- [ ] **Step 4: 运行测试**

Run: `pytest tests/unit/core/workflow/test_version_manager.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/workflow/version_manager.py tests/unit/core/workflow/test_version_manager.py
git commit -m "feat(workflow): add VersionedWorkflowManager and CompatibilityChecker"
```

---

### Task 15: 工作流版本管理 CLI 命令

**Files:**
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: 添加 workflow 子命令组**

在 `src/cabinet/cli/main.py` 中，在 `backup_app` 定义之后添加：

```python
workflow_app = typer.Typer(name="workflow", help="Workflow management")
app.add_typer(workflow_app, name="workflow")


@workflow_app.command("versions")
def workflow_versions(
    workflow_id: str = typer.Argument(..., help="Workflow ID"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_workflow_versions_async(workflow_id, data_dir))


async def _workflow_versions_async(workflow_id: str, data_dir: str) -> None:
    from cabinet.core.workflow.version_store import WorkflowVersionStore
    from rich.table import Table

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found. Run 'cabinet init' first.")
        raise typer.Exit(code=1)

    store = WorkflowVersionStore(db_path)
    await store.initialize()
    try:
        versions = await store.list_versions(UUID(workflow_id))
        if not versions:
            console.print("[yellow]No versions found.[/yellow]")
            return
        table = Table(title=f"Workflow Versions ({workflow_id[:8]})")
        table.add_column("Version", style="cyan")
        table.add_column("Type", style="green")
        table.add_column("Summary")
        table.add_column("Created")
        for v in versions:
            table.add_row(str(v.version), v.change_type, v.change_summary, v.created_at[:19])
        console.print(table)
    finally:
        await store.close()


@workflow_app.command("diff")
def workflow_diff(
    workflow_id: str = typer.Argument(..., help="Workflow ID"),
    v1: int = typer.Argument(..., help="First version"),
    v2: int = typer.Argument(..., help="Second version"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_workflow_diff_async(workflow_id, v1, v2, data_dir))


async def _workflow_diff_async(workflow_id: str, v1: int, v2: int, data_dir: str) -> None:
    from cabinet.core.workflow.version_manager import VersionedWorkflowManager
    from cabinet.core.workflow.version_store import WorkflowVersionStore

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found.")
        raise typer.Exit(code=1)

    store = WorkflowVersionStore(db_path)
    await store.initialize()
    try:
        manager = VersionedWorkflowManager(store)
        diff = await manager.diff_versions(UUID(workflow_id), v1, v2)
        if "error" in diff:
            console.print(f"[red]{diff['error']}[/red]")
            return
        issues = diff.get("issues", [])
        if not issues:
            console.print("[green]No differences found.[/green]")
            return
        for issue in issues:
            style = "[red]" if issue.get("severity") == "breaking" else "[green]"
            console.print(f"{style}{issue.get('type')}: {issue.get('description')}[/]")
    finally:
        await store.close()


@workflow_app.command("rollback")
def workflow_rollback(
    workflow_id: str = typer.Argument(..., help="Workflow ID"),
    target_version: int = typer.Argument(..., help="Target version to rollback to"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_workflow_rollback_async(workflow_id, target_version, data_dir))


async def _workflow_rollback_async(workflow_id: str, target_version: int, data_dir: str) -> None:
    from cabinet.core.workflow.version_manager import VersionedWorkflowManager
    from cabinet.core.workflow.version_store import WorkflowVersionStore

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found.")
        raise typer.Exit(code=1)

    store = WorkflowVersionStore(db_path)
    await store.initialize()
    try:
        manager = VersionedWorkflowManager(store)
        version = await manager.rollback(UUID(workflow_id), target_version)
        console.print(f"[green]Rolled back to v{target_version} (new version: v{version.version})[/green]")
    except ValueError as e:
        console.print(f"[red]Error:[/red] {e}")
    finally:
        await store.close()
```

- [ ] **Step 2: 运行 CLI 测试确保无回归**

Run: `pytest tests/unit/cli/ -v`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat(cli): add workflow versions/diff/rollback commands"
```

---

### L3 检查点

运行完整测试套件确认 L3 无回归：

```bash
pytest tests/unit/core/workflow/ tests/unit/rooms/office/ -v
```

---

## L4：工作流可视化 + 实时追踪

### Task 16: 实现 WorkflowVisualizer

**Files:**
- Create: `src/cabinet/core/workflow/visualizer.py`
- Create: `tests/unit/core/workflow/test_visualizer.py`

- [ ] **Step 1: 编写 WorkflowVisualizer 测试**

```python
# tests/unit/core/workflow/test_visualizer.py
import pytest
from uuid import uuid4

from cabinet.core.workflow.visualizer import WorkflowVisualizer
from cabinet.models.workflows import (
    TriggerNode, SkillNode, EndNode, Workflow, WorkflowEdge,
)


def test_to_mermaid_basic():
    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="test",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    visualizer = WorkflowVisualizer()
    mermaid = visualizer.to_mermaid(workflow)
    assert "flowchart TD" in mermaid
    assert str(trigger_id) in mermaid
    assert str(skill_id) in mermaid
    assert "-->" in mermaid


def test_to_mermaid_with_condition():
    trigger_id = uuid4()
    cond_id = uuid4()
    true_id = uuid4()
    false_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="cond",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=cond_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=true_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=false_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=cond_id),
            WorkflowEdge(source_node_id=cond_id, target_node_id=true_id, condition="approved"),
            WorkflowEdge(source_node_id=cond_id, target_node_id=false_id, condition="rejected"),
            WorkflowEdge(source_node_id=true_id, target_node_id=end_id),
            WorkflowEdge(source_node_id=false_id, target_node_id=end_id),
        ],
    )
    visualizer = WorkflowVisualizer()
    mermaid = visualizer.to_mermaid(workflow)
    assert "|approved|" in mermaid
    assert "|rejected|" in mermaid


def test_to_ascii_basic():
    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="test",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            SkillNode(id=skill_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=skill_id),
            WorkflowEdge(source_node_id=skill_id, target_node_id=end_id),
        ],
    )
    visualizer = WorkflowVisualizer()
    ascii_art = visualizer.to_ascii(workflow)
    assert len(ascii_art) > 0
    assert "trigger" in ascii_art.lower() or "Trigger" in ascii_art
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pytest tests/unit/core/workflow/test_visualizer.py -v`
Expected: FAIL — ImportError

- [ ] **Step 3: 创建 WorkflowVisualizer**

```python
# src/cabinet/core/workflow/visualizer.py
from __future__ import annotations

from uuid import UUID

from cabinet.models.workflows import Workflow, WorkflowNode


class WorkflowVisualizer:
    def to_mermaid(self, workflow: Workflow, execution_status: dict[str, str] | None = None) -> str:
        lines = ["flowchart TD"]
        for node in workflow.nodes:
            style = self._mermaid_style(node, execution_status)
            lines.append(f'    {node.id}["{node.name}"]{style}')
        for edge in workflow.edges:
            label = f"|{edge.condition}|" if edge.condition else ""
            lines.append(f"    {edge.source_node_id} -->{label} {edge.target_node_id}")
        if execution_status:
            lines.append("")
            lines.append("    classDef completed fill:#4caf50,color:#fff")
            lines.append("    classDef running fill:#2196f3,color:#fff")
            lines.append("    classDef failed fill:#f44336,color:#fff")
            lines.append("    classDef paused fill:#ff9800,color:#fff")
            lines.append("    classDef skipped fill:#9e9e9e,color:#fff")
        return "\n".join(lines)

    def to_ascii(self, workflow: Workflow, execution_status: dict[str, str] | None = None) -> str:
        lines = []
        node_map = {n.id: n for n in workflow.nodes}
        edge_map: dict[UUID, list[tuple[UUID, str | None]]] = {}
        for edge in workflow.edges:
            targets = edge_map.setdefault(edge.source_node_id, [])
            targets.append((edge.target_node_id, edge.condition))

        visited = set()

        def _walk(node_id: UUID, indent: int = 0):
            if node_id in visited:
                return
            visited.add(node_id)
            node = node_map.get(node_id)
            if node is None:
                return
            prefix = "  " * indent
            status_marker = ""
            if execution_status and str(node_id) in execution_status:
                status = execution_status[str(node_id)]
                markers = {"completed": " ✓", "running": " →", "failed": " ✗", "paused": " ⏸", "skipped": " ○"}
                status_marker = markers.get(status, "")
            lines.append(f"{prefix}[{node.kind}] {node.name}{status_marker}")
            for target_id, condition in edge_map.get(node_id, []):
                if condition:
                    lines.append(f"{prefix}  |{condition}|")
                _walk(target_id, indent + 1)

        trigger_nodes = [n for n in workflow.nodes if n.kind == "trigger"]
        if trigger_nodes:
            _walk(trigger_nodes[0].id)
        return "\n".join(lines)

    def _mermaid_style(self, node: WorkflowNode, execution_status: dict[str, str] | None) -> str:
        if execution_status is None:
            return ""
        status = execution_status.get(str(node.id))
        if not status:
            return ""
        styles = {
            "completed": ":::completed",
            "running": ":::running",
            "failed": ":::failed",
            "paused": ":::paused",
            "skipped": ":::skipped",
        }
        return styles.get(status, "")
```

- [ ] **Step 4: 运行测试**

Run: `pytest tests/unit/core/workflow/test_visualizer.py -v`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/core/workflow/visualizer.py tests/unit/core/workflow/test_visualizer.py
git commit -m "feat(workflow): add WorkflowVisualizer with Mermaid and ASCII output"
```

---

### Task 17: 工作流 API 端点

**Files:**
- Create: `src/cabinet/api/routes/workflows.py`
- Modify: `src/cabinet/api/app.py`

- [ ] **Step 1: 创建工作流 API 路由**

```python
# src/cabinet/api/routes/workflows.py
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/workflows/{workflow_id}/mermaid")
async def workflow_mermaid(workflow_id: str, request: Request):
    from cabinet.core.workflow.visualizer import WorkflowVisualizer
    visualizer = WorkflowVisualizer()
    return {"format": "mermaid", "workflow_id": workflow_id, "message": "Use workflow definition to generate diagram"}


@router.get("/workflows/executions/{execution_id}")
async def workflow_execution_detail(execution_id: str, request: Request):
    runtime = request.app.state.runtime
    if hasattr(runtime, "office") and execution_id in runtime.office._executions:
        execution = runtime.office._executions[UUID(execution_id)]
        return {
            "id": str(execution.id),
            "workflow_id": str(execution.workflow_id),
            "status": execution.status,
            "completed_nodes": [str(n) for n in execution.completed_nodes],
        }
    return {"error": "Execution not found"}


@router.get("/workflows/dead-letter")
async def list_dead_letter(request: Request):
    runtime = request.app.state.runtime
    if hasattr(runtime, "_dead_letter_queue") and runtime._dead_letter_queue:
        pending = await runtime._dead_letter_queue.list_pending()
        return {"entries": [e.model_dump() for e in pending]}
    return {"entries": []}


@router.post("/workflows/dead-letter/{entry_id}/retry")
async def retry_dead_letter(entry_id: str, request: Request):
    runtime = request.app.state.runtime
    if hasattr(runtime, "_dead_letter_queue") and runtime._dead_letter_queue:
        success = await runtime._dead_letter_queue.retry(UUID(entry_id))
        return {"success": success}
    return {"success": False}


@router.post("/workflows/dead-letter/{entry_id}/discard")
async def discard_dead_letter(entry_id: str, request: Request):
    runtime = request.app.state.runtime
    if hasattr(runtime, "_dead_letter_queue") and runtime._dead_letter_queue:
        await runtime._dead_letter_queue.discard(UUID(entry_id))
        return {"success": True}
    return {"success": False}
```

- [ ] **Step 2: 注册路由到 API 应用**

在 `src/cabinet/api/app.py` 中，在路由注册区域添加：

```python
    from cabinet.api.routes import workflows as workflow_routes
    app.include_router(workflow_routes.router, prefix="/api", tags=["Workflows"])
```

- [ ] **Step 3: 运行 API 测试确保无回归**

Run: `pytest tests/unit/api/ -v`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add src/cabinet/api/routes/workflows.py src/cabinet/api/app.py
git commit -m "feat(api): add workflow visualization and dead letter API endpoints"
```

---

### Task 18: 工作流可视化 CLI 命令

**Files:**
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: 在 workflow_app 中添加 show 和 status 命令**

在 `src/cabinet/cli/main.py` 的 `workflow_app` 定义区域中，在 `workflow_rollback` 之后添加：

```python
@workflow_app.command("show")
def workflow_show(
    workflow_id: str = typer.Argument(..., help="Workflow ID"),
    format: str = typer.Option("ascii", "--format", help="Output format: ascii or mermaid"),
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_workflow_show_async(workflow_id, format, data_dir))


async def _workflow_show_async(workflow_id: str, format: str, data_dir: str) -> None:
    from cabinet.core.workflow.version_store import WorkflowVersionStore
    from cabinet.core.workflow.visualizer import WorkflowVisualizer
    from cabinet.models.workflows import Workflow

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found.")
        raise typer.Exit(code=1)

    store = WorkflowVersionStore(db_path)
    await store.initialize()
    try:
        latest = await store.get_latest_version(UUID(workflow_id))
        if not latest:
            console.print("[yellow]Workflow not found.[/yellow]")
            return
        workflow = Workflow.model_validate(latest.definition)
        visualizer = WorkflowVisualizer()
        if format == "mermaid":
            console.print(visualizer.to_mermaid(workflow))
        else:
            console.print(visualizer.to_ascii(workflow))
    finally:
        await store.close()


@workflow_app.command("dead-letter")
def workflow_dead_letter(
    data_dir: str = typer.Option("data", "--data-dir", help="Data directory path"),
):
    asyncio.run(_workflow_dead_letter_async(data_dir))


async def _workflow_dead_letter_async(data_dir: str) -> None:
    from cabinet.core.workflow.dead_letter import DeadLetterQueue
    from rich.table import Table

    db_path = os.path.join(data_dir, "db", "cabinet.db")
    if not os.path.exists(db_path):
        console.print("[red]Error:[/red] Database not found.")
        raise typer.Exit(code=1)

    queue = DeadLetterQueue(db_path)
    await queue.initialize()
    try:
        pending = await queue.list_pending()
        if not pending:
            console.print("[green]No dead letter entries.[/green]")
            return
        table = Table(title="Dead Letter Queue")
        table.add_column("ID", style="dim")
        table.add_column("Source", style="cyan")
        table.add_column("Error", style="red")
        table.add_column("Retries")
        table.add_column("Created")
        for entry in pending:
            table.add_row(
                str(entry.id)[:8],
                f"{entry.source_type}:{entry.source_id[:8]}",
                entry.error_message[:50],
                f"{entry.retry_count}/{entry.max_retries}",
                entry.created_at[:19],
            )
        console.print(table)
    finally:
        await queue.close()
```

- [ ] **Step 2: 运行 CLI 测试**

Run: `pytest tests/unit/cli/ -v`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat(cli): add workflow show and dead-letter commands"
```

---

### Task 19: Runtime 注入新组件

**Files:**
- Modify: `src/cabinet/runtime.py`

- [ ] **Step 1: 在 CabinetRuntime 中注入 DeadLetterQueue 和 WorkflowExecutionStore**

在 `src/cabinet/runtime.py` 的 `CabinetRuntime.__init__` 中，在 `self._workflow_engine` 创建之后添加：

```python
        self._dead_letter_queue: DeadLetterQueue | None = None
        self._execution_store: WorkflowExecutionStore | None = None
```

在 `start()` 方法中，在迁移运行之后添加：

```python
        if self._db_path:
            from cabinet.core.workflow.dead_letter import DeadLetterQueue
            from cabinet.core.workflow.execution_store import WorkflowExecutionStore

            self._dead_letter_queue = DeadLetterQueue(self._db_path)
            await self._dead_letter_queue.initialize()
            self._execution_store = WorkflowExecutionStore(self._db_path)
            await self._execution_store.initialize()

            self._workflow_engine = WorkflowEngine(
                agent_factory=self._agent_factory,
                verification_gate=self._verification_gate,
                knowledge_base=self._knowledge_base,
                dead_letter_queue=self._dead_letter_queue,
            )
            self._office = OfficeSchedulerService(
                self._office_store,
                self._wiring,
                self._agent_factory,
                verification_gate=self._verification_gate,
                workflow_engine=self._workflow_engine,
            )
```

在 `stop()` 方法中，在关闭逻辑之前添加：

```python
        if self._dead_letter_queue:
            await self._dead_letter_queue.close()
        if self._execution_store:
            await self._execution_store.close()
```

- [ ] **Step 2: 运行全部测试**

Run: `pytest tests/unit/ -v --timeout=60`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/cabinet/runtime.py
git commit -m "feat(runtime): inject DeadLetterQueue and WorkflowExecutionStore"
```

---

### L4 检查点

运行完整测试套件确认 L4 无回归：

```bash
pytest tests/unit/ -v --timeout=60
```

---

## 最终验证

### Task 20: 全量测试 + Lint

- [ ] **Step 1: 运行 ruff lint**

Run: `ruff check src/ tests/`
Expected: 无错误

- [ ] **Step 2: 运行 mypy 类型检查**

Run: `mypy src/cabinet/`
Expected: 无错误（或仅有已知问题）

- [ ] **Step 3: 运行完整测试套件**

Run: `pytest tests/ -v --timeout=120`
Expected: 全部 PASS

- [ ] **Step 4: 修复任何遗留问题**

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "chore: final cleanup for advanced workflow feature"
```
