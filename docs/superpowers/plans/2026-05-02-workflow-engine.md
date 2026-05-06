# WorkflowEngine 核心引擎 + DecisionRoom 联动实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 WorkflowEngine，按拓扑排序遍历 Workflow 节点，替换 Office 的伪执行逻辑，并实现 HumanApprovalNode 与 DecisionRoom 的联动。

**Architecture:** 新增 `core/workflow/engine.py` 中的 WorkflowEngine 类，接收 Workflow 模型按拓扑遍历节点，分派到对应执行器。OfficeSchedulerService 注入 WorkflowEngine，execute_workflow() 委托给引擎，新增 resume_workflow() 支持暂停恢复。HumanApprovalNode 遇到时暂停执行，返回 paused 状态，外部通过 resume_workflow() 恢复。

**Tech Stack:** Python 3.12+, Pydantic v2, asyncio, pytest + pytest-asyncio

---

### Task 1: WorkflowEngine 核心实现 — TriggerNode + SkillNode + EndNode

**Files:**
- Create: `src/cabinet/core/workflow/__init__.py`
- Create: `src/cabinet/core/workflow/engine.py`
- Create: `tests/unit/core/workflow/__init__.py`
- Create: `tests/unit/core/workflow/test_engine.py`

- [ ] **Step 1: 创建包结构**

创建 `src/cabinet/core/workflow/__init__.py`（空文件）和 `tests/unit/core/workflow/__init__.py`（空文件）。

- [ ] **Step 2: 写失败测试 — 简单线性工作流 Trigger→Skill→End**

在 `tests/unit/core/workflow/test_engine.py` 中写入：

```python
import pytest
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.workflow.engine import WorkflowEngine
from cabinet.models.workflows import (
    EndNode,
    SkillNode,
    TriggerNode,
    Workflow,
    WorkflowEdge,
)


@pytest.mark.asyncio
async def test_engine_runs_linear_workflow():
    trigger_id = uuid4()
    skill_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="linear",
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
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"input": "test"})
    assert str(trigger_id) in results
    assert results[str(trigger_id)]["triggered"] is True
    assert str(skill_id) in results
    assert "output" in results[str(skill_id)]
    assert "__end__" in results
```

- [ ] **Step 3: 运行测试确认失败**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py::test_engine_runs_linear_workflow -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.core.workflow'`

- [ ] **Step 4: 实现 WorkflowEngine**

创建 `src/cabinet/core/workflow/engine.py`：

```python
from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

from cabinet.agents.context import AgentContext
from cabinet.agents.protocol import AgentFactory
from cabinet.models.workflows import (
    ConditionNode,
    EndNode,
    HumanApprovalNode,
    LoopNode,
    ParallelNode,
    SkillNode,
    TriggerNode,
    Workflow,
    WorkflowNode,
)


class NodeResult:
    __slots__ = ("node_id", "output", "next_node_id")

    def __init__(self, node_id: UUID, output: dict, next_node_id: UUID | None = None):
        self.node_id = node_id
        self.output = output
        self.next_node_id = next_node_id


class WorkflowEngine:
    def __init__(
        self,
        agent_factory: AgentFactory,
        verification_gate: object | None = None,
    ):
        self._agent_factory = agent_factory
        self._verification_gate = verification_gate

    async def run(
        self,
        workflow: Workflow,
        inputs: dict,
        on_node_completed: object | None = None,
    ) -> dict:
        node_map = {n.id: n for n in workflow.nodes}
        edge_map: dict[UUID, list[tuple[UUID, str | None]]] = {}
        for edge in workflow.edges:
            targets = edge_map.setdefault(edge.source_node_id, [])
            targets.append((edge.target_node_id, edge.condition))

        trigger_nodes = [n for n in workflow.nodes if isinstance(n, TriggerNode)]
        if not trigger_nodes:
            raise ValueError("Workflow has no trigger node")
        current_id = trigger_nodes[0].id

        context_data = dict(inputs)
        results: dict[str, dict] = {}

        while current_id is not None:
            node = node_map.get(current_id)
            if node is None:
                break

            if isinstance(node, EndNode):
                for k, v in node.output_mapping.items():
                    if k in context_data:
                        results[v] = context_data[k]
                results["__end__"] = {"node_id": str(node.id), "status": "completed"}
                break

            if isinstance(node, HumanApprovalNode):
                results["__paused__"] = {
                    "node_id": str(node.id),
                    "decision_type": node.decision_type,
                    "message_template": node.message_template,
                    "context_data": context_data,
                }
                break

            node_result = await self._execute_node(node, context_data, node_map, edge_map)

            if on_node_completed is not None:
                await on_node_completed(node.id, node_result.output)

            if self._verification_gate is not None:
                gate_result = await self._verification_gate.check(
                    node.id,
                    {"output": str(node_result.output), "criteria": ["completeness", "accuracy"]},
                )
                if not gate_result.passed:
                    results[f"__gate_{node.id}__"] = {
                        "passed": gate_result.passed,
                        "reason": gate_result.reason,
                    }

            results[str(node.id)] = node_result.output
            context_data.update(node_result.output)

            if isinstance(node, ConditionNode):
                current_id = node_result.next_node_id
            elif isinstance(node, ParallelNode):
                current_id = self._find_next_after_parallel(node, edge_map)
            else:
                targets = edge_map.get(node.id, [])
                current_id = targets[0][0] if targets else None

        return results

    async def _execute_node(
        self,
        node: WorkflowNode,
        context_data: dict,
        node_map: dict[UUID, WorkflowNode],
        edge_map: dict[UUID, list[tuple[UUID, str | None]]],
    ) -> NodeResult:
        if isinstance(node, TriggerNode):
            return NodeResult(node.id, {"triggered": True, "trigger_type": node.trigger_type})

        if isinstance(node, SkillNode):
            agent = await self._agent_factory.create_agent(uuid4(), "executor")
            context = AgentContext(model="default", temperature=0.3)
            output = await agent.execute(
                f"Execute skill {node.skill_id} for employee {node.employee_id} with inputs: {node.inputs}\n\n"
                f"Context: {context_data}\n\n"
                f"Describe the execution result.",
                context,
            )
            return NodeResult(node.id, {"output": output.content, "skill_id": str(node.skill_id)})

        if isinstance(node, ConditionNode):
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

        if isinstance(node, LoopNode):
            return NodeResult(node.id, {
                "loop_iterator": node.iterator_expr,
                "body_node_ids": [str(nid) for nid in node.body_node_ids],
                "note": "loop skeleton - iteration not executed",
            })

        if isinstance(node, ParallelNode):
            branch_results = {}
            tasks = []
            for branch_id in node.branch_node_ids:
                branch_node = node_map.get(branch_id)
                if branch_node is not None:
                    tasks.append(self._execute_node(branch_node, context_data, node_map, edge_map))
            if tasks:
                completed = await asyncio.gather(*tasks, return_exceptions=True)
                for i, result in enumerate(completed):
                    if isinstance(result, Exception):
                        branch_results[str(node.branch_node_ids[i])] = {"error": str(result)}
                    else:
                        branch_results[str(result.node_id)] = result.output
            return NodeResult(node.id, branch_results)

        return NodeResult(node.id, {"unknown_node": True})

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
```

- [ ] **Step 5: 运行测试确认通过**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py::test_engine_runs_linear_workflow -v`
Expected: PASS

- [ ] **Step 6: 写测试 — ConditionNode 分支**

在 `tests/unit/core/workflow/test_engine.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_engine_condition_node_branches():
    trigger_id = uuid4()
    cond_id = uuid4()
    true_id = uuid4()
    false_id = uuid4()
    end_true_id = uuid4()
    end_false_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="conditional",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            ConditionNode(id=cond_id, expression="x > 0", true_next=true_id, false_next=false_id),
            SkillNode(id=true_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=false_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_true_id),
            EndNode(id=end_false_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=cond_id),
            WorkflowEdge(source_node_id=true_id, target_node_id=end_true_id),
            WorkflowEdge(source_node_id=false_id, target_node_id=end_false_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"x": 1})
    assert str(cond_id) in results
    assert "condition_result" in results[str(cond_id)]
```

- [ ] **Step 7: 运行测试确认通过**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py::test_engine_condition_node_branches -v`
Expected: PASS

- [ ] **Step 8: 写测试 — ParallelNode 并行执行**

在 `tests/unit/core/workflow/test_engine.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_engine_parallel_node():
    trigger_id = uuid4()
    branch_a_id = uuid4()
    branch_b_id = uuid4()
    parallel_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="parallel",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            ParallelNode(id=parallel_id, branch_node_ids=[branch_a_id, branch_b_id]),
            SkillNode(id=branch_a_id, skill_id=uuid4(), employee_id=uuid4()),
            SkillNode(id=branch_b_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=parallel_id),
            WorkflowEdge(source_node_id=branch_a_id, target_node_id=end_id),
            WorkflowEdge(source_node_id=branch_b_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert str(parallel_id) in results
    assert str(branch_a_id) in results[str(parallel_id)]
    assert str(branch_b_id) in results[str(parallel_id)]
```

- [ ] **Step 9: 运行测试确认通过**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py::test_engine_parallel_node -v`
Expected: PASS

- [ ] **Step 10: 写测试 — HumanApprovalNode 暂停执行**

在 `tests/unit/core/workflow/test_engine.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_engine_human_approval_node_pauses():
    trigger_id = uuid4()
    approval_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="approval",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanApprovalNode(id=approval_id, decision_type="strategic", message_template="Approve?"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=approval_id),
            WorkflowEdge(source_node_id=approval_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {})
    assert "__paused__" in results
    assert results["__paused__"]["decision_type"] == "strategic"
    assert "__end__" not in results
```

- [ ] **Step 11: 运行测试确认通过**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py::test_engine_human_approval_node_pauses -v`
Expected: PASS

- [ ] **Step 12: 写测试 — LoopNode 骨架**

在 `tests/unit/core/workflow/test_engine.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_engine_loop_node_skeleton():
    trigger_id = uuid4()
    loop_id = uuid4()
    body_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="loop",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            LoopNode(id=loop_id, iterator_expr="items", body_node_ids=[body_id]),
            SkillNode(id=body_id, skill_id=uuid4(), employee_id=uuid4()),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=loop_id),
            WorkflowEdge(source_node_id=loop_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    results = await engine.run(workflow, {"items": [1, 2, 3]})
    assert str(loop_id) in results
    assert results[str(loop_id)]["loop_iterator"] == "items"
    assert "note" in results[str(loop_id)]
```

- [ ] **Step 13: 运行测试确认通过**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py::test_engine_loop_node_skeleton -v`
Expected: PASS

- [ ] **Step 14: 写测试 — 无 TriggerNode 时报错**

在 `tests/unit/core/workflow/test_engine.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_engine_no_trigger_node_raises():
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="no_trigger",
        kind="composite_skill",
        nodes=[EndNode(id=end_id)],
        edges=[],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    with pytest.raises(ValueError, match="no trigger node"):
        await engine.run(workflow, {})
```

- [ ] **Step 15: 运行测试确认通过**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py::test_engine_no_trigger_node_raises -v`
Expected: PASS

- [ ] **Step 16: 写测试 — on_node_completed 回调**

在 `tests/unit/core/workflow/test_engine.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_engine_calls_on_node_completed():
    from uuid import UUID

    trigger_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="callback",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=end_id),
        ],
    )

    completed_nodes: list[tuple[UUID, dict]] = []

    async def on_completed(node_id: UUID, result: dict):
        completed_nodes.append((node_id, result))

    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    await engine.run(workflow, {}, on_node_completed=on_completed)
    assert len(completed_nodes) == 1
    assert completed_nodes[0][0] == trigger_id
    assert completed_nodes[0][1]["triggered"] is True
```

- [ ] **Step 17: 运行全部 WorkflowEngine 测试**

Run: `python -m pytest tests/unit/core/workflow/test_engine.py -v`
Expected: ALL PASS (7 tests)

- [ ] **Step 18: 提交**

```bash
git add src/cabinet/core/workflow/ tests/unit/core/workflow/
git commit -m "feat: add WorkflowEngine with Trigger/Skill/Condition/Parallel/Loop/HumanApproval/End node support"
```

---

### Task 2: 新增 WorkflowPaused 领域事件 + Office 注入 WorkflowEngine

**Files:**
- Modify: `src/cabinet/rooms/office/domain_events.py`
- Modify: `src/cabinet/rooms/office/service.py`
- Test: `tests/unit/rooms/office/test_service.py`

- [ ] **Step 1: 写失败测试 — execute_workflow 有 WorkflowEngine 时委托给它**

在 `tests/unit/rooms/office/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_execute_workflow_with_engine(publisher):
    from cabinet.core.workflow.engine import WorkflowEngine
    from cabinet.models.workflows import (
        EndNode,
        SkillNode,
        TriggerNode,
        Workflow,
        WorkflowEdge,
    )

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
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), workflow_engine=engine)
    execution = await service.execute_workflow(workflow.id, {"__workflow__": workflow})
    assert execution.status == "completed"
    assert len(execution.completed_nodes) >= 1
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/rooms/office/test_service.py::test_execute_workflow_with_engine -v`
Expected: FAIL — `OfficeSchedulerService.__init__() got an unexpected keyword argument 'workflow_engine'`

- [ ] **Step 3: 新增 WorkflowPaused 事件**

在 `src/cabinet/rooms/office/domain_events.py` 末尾追加：

```python


class WorkflowPaused(BaseModel):
    execution_id: UUID
    node_id: UUID
    decision_id: UUID
    reason: str
```

注意：需要在文件顶部确认已有 `from uuid import UUID` 导入。当前文件已有此导入。

- [ ] **Step 4: 修改 OfficeSchedulerService 构造函数**

替换 `src/cabinet/rooms/office/service.py` 中的构造函数（第 30-42 行）：

```python
class OfficeSchedulerService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        verification_gate: object | None = None,
        workflow_engine: object | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._verification_gate = verification_gate
        self._workflow_engine = workflow_engine
        self._tasks: dict[UUID, Task] = {}
        self._executions: dict[UUID, WorkflowExecution] = {}
```

同时更新 import，在 domain_events 导入中增加 `WorkflowPaused`：

```python
from cabinet.rooms.office.domain_events import (
    TaskCancelled,
    TaskFailed,
    TaskStatusChanged,
    TaskSubmitted,
    WorkflowCompleted,
    WorkflowNodeCompleted,
    WorkflowPaused,
    WorkflowStarted,
)
```

- [ ] **Step 5: 修改 _apply_event 增加 WorkflowPaused 处理**

在 `src/cabinet/rooms/office/service.py` 的 `_apply_event` 方法中，在 `WorkflowCompleted` 处理之后（第 132 行 `return cross_room` 之前）追加：

```python
        elif isinstance(event, WorkflowPaused):
            if event.execution_id in self._executions:
                self._executions[event.execution_id] = self._executions[event.execution_id].model_copy(
                    update={"status": "paused", "current_node_id": event.node_id},
                )
```

- [ ] **Step 6: 修改 execute_workflow 方法**

替换 `src/cabinet/rooms/office/service.py` 中的 `execute_workflow` 方法（第 170-216 行）：

```python
    async def execute_workflow(self, workflow_id: UUID, inputs: dict) -> WorkflowExecution:
        execution_id = uuid4()
        project_id = inputs.get("project_id", uuid4()) if isinstance(inputs.get("project_id"), UUID) else uuid4()
        event = WorkflowStarted(
            execution_id=execution_id,
            workflow_id=workflow_id,
            project_id=project_id,
        )
        await self._publish_and_apply(event)

        if self._workflow_engine is not None:
            from cabinet.models.workflows import (
                EndNode,
                SkillNode,
                TriggerNode,
                Workflow,
                WorkflowEdge,
            )

            workflow = inputs.get("__workflow__")
            if workflow is None:
                trigger_id = uuid4()
                skill_id = uuid4()
                end_id = uuid4()
                workflow = Workflow(
                    id=workflow_id,
                    project_id=project_id,
                    name="auto-generated",
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

            async def on_node_completed(node_id: UUID, result: dict):
                node_event = WorkflowNodeCompleted(
                    execution_id=execution_id,
                    node_id=node_id,
                    result=result,
                )
                await self._publish_and_apply(node_event)

                if self._verification_gate is not None:
                    gate_result = await self._verification_gate.check(
                        node_id,
                        {"output": str(result), "criteria": ["completeness", "accuracy"]},
                    )
                    if not gate_result.passed:
                        self._executions[execution_id] = self._executions[execution_id].model_copy(
                            update={
                                "gate_results": {
                                    **self._executions[execution_id].gate_results,
                                    str(node_id): gate_result,
                                },
                            },
                        )

            engine_results = await self._workflow_engine.run(workflow, inputs, on_node_completed)

            if "__paused__" in engine_results:
                paused = engine_results["__paused__"]
                decision_id = uuid4()
                pause_event = WorkflowPaused(
                    execution_id=execution_id,
                    node_id=UUID(paused["node_id"]),
                    decision_id=decision_id,
                    reason=paused.get("message_template", "Human approval required"),
                )
                await self._publish_and_apply(pause_event)
                return self._executions[execution_id]

            complete_event = WorkflowCompleted(
                execution_id=execution_id,
                results=engine_results,
            )
            await self._publish_and_apply(complete_event)
            return self._executions[execution_id]

        agent = await self._agent_factory.create_agent(uuid4(), "executor")
        context = AgentContext(model="default", temperature=0.3)
        output = await agent.execute(
            f"Execute workflow {workflow_id} with inputs: {inputs}\n\n"
            f"Describe the execution plan and first step results.",
            context,
        )

        node_id = uuid4()
        node_event = WorkflowNodeCompleted(
            execution_id=execution_id,
            node_id=node_id,
            result={"output": output.content},
        )
        await self._publish_and_apply(node_event)

        if self._verification_gate is not None:
            gate_result = await self._verification_gate.check(
                node_id,
                {"output": output.content, "criteria": ["completeness", "accuracy"]},
            )
            if not gate_result.passed:
                self._executions[execution_id] = self._executions[execution_id].model_copy(
                    update={
                        "gate_results": {
                            **self._executions[execution_id].gate_results,
                            str(node_id): gate_result,
                        },
                    },
                )

        complete_event = WorkflowCompleted(
            execution_id=execution_id,
            results={"default": {"output": output.content}},
        )
        await self._publish_and_apply(complete_event)
        return self._executions[execution_id]
```

- [ ] **Step 7: 运行测试确认通过**

Run: `python -m pytest tests/unit/rooms/office/test_service.py -v`
Expected: ALL PASS

- [ ] **Step 8: 提交**

```bash
git add src/cabinet/rooms/office/ tests/unit/rooms/office/test_service.py
git commit -m "feat(office): inject WorkflowEngine, add WorkflowPaused event, delegate execute_workflow"
```

---

### Task 3: 新增 resume_workflow 方法

**Files:**
- Modify: `src/cabinet/rooms/office/service.py`
- Test: `tests/unit/rooms/office/test_service.py`

- [ ] **Step 1: 写失败测试 — resume_workflow 恢复暂停的执行**

在 `tests/unit/rooms/office/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_resume_workflow(publisher):
    from cabinet.core.workflow.engine import WorkflowEngine
    from cabinet.models.workflows import (
        EndNode,
        HumanApprovalNode,
        TriggerNode,
        Workflow,
        WorkflowEdge,
    )

    trigger_id = uuid4()
    approval_id = uuid4()
    end_id = uuid4()
    workflow = Workflow(
        project_id=uuid4(),
        name="approval_flow",
        kind="composite_skill",
        nodes=[
            TriggerNode(id=trigger_id, trigger_type="manual"),
            HumanApprovalNode(id=approval_id, decision_type="strategic"),
            EndNode(id=end_id),
        ],
        edges=[
            WorkflowEdge(source_node_id=trigger_id, target_node_id=approval_id),
            WorkflowEdge(source_node_id=approval_id, target_node_id=end_id),
        ],
    )
    engine = WorkflowEngine(agent_factory=StubAgentFactory())
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory(), workflow_engine=engine)
    execution = await service.execute_workflow(workflow.id, {"__workflow__": workflow})
    assert execution.status == "paused"

    resumed = await service.resume_workflow(execution.id, {"approved": True, "option": "go"})
    assert resumed.status == "completed"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/rooms/office/test_service.py::test_resume_workflow -v`
Expected: FAIL — `AttributeError: 'OfficeSchedulerService' object has no attribute 'resume_workflow'`

- [ ] **Step 3: 实现 resume_workflow 方法**

在 `src/cabinet/rooms/office/service.py` 的 `execute_workflow` 方法之后、`check_permission` 方法之前，追加：

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

        complete_event = WorkflowCompleted(
            execution_id=execution_id,
            results={"resumed": decision_result},
        )
        await self._publish_and_apply(complete_event)
        return self._executions[execution_id]
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/rooms/office/test_service.py::test_resume_workflow -v`
Expected: PASS

- [ ] **Step 5: 写测试 — resume_workflow 非 paused 状态时报错**

在 `tests/unit/rooms/office/test_service.py` 末尾追加：

```python
@pytest.mark.asyncio
async def test_resume_workflow_not_paused_raises(service):
    order = TaskOrder(employee_id=uuid4(), skill_id=uuid4())
    task = await service.submit_task(order)
    with pytest.raises(KeyError):
        await service.resume_workflow(uuid4(), {})


@pytest.mark.asyncio
async def test_resume_workflow_wrong_status_raises(publisher):
    store = RoomEventStore("office")
    service = OfficeSchedulerService(store, publisher, StubAgentFactory())
    execution = await service.execute_workflow(uuid4(), {"input": "data"})
    with pytest.raises(ValueError, match="not paused"):
        await service.resume_workflow(execution.id, {"approved": True})
```

- [ ] **Step 6: 运行测试确认通过**

Run: `python -m pytest tests/unit/rooms/office/test_service.py::test_resume_workflow_not_paused_raises tests/unit/rooms/office/test_service.py::test_resume_workflow_wrong_status_raises -v`
Expected: ALL PASS

- [ ] **Step 7: 提交**

```bash
git add src/cabinet/rooms/office/service.py tests/unit/rooms/office/test_service.py
git commit -m "feat(office): add resume_workflow for paused HumanApprovalNode executions"
```

---

### Task 4: CabinetRuntime 组装 WorkflowEngine

**Files:**
- Modify: `src/cabinet/runtime.py`
- Test: `tests/unit/test_runtime.py`

- [ ] **Step 1: 写失败测试 — Runtime 创建 WorkflowEngine 并注入 Office**

在 `tests/unit/test_runtime.py` 末尾追加：

```python
def test_runtime_creates_workflow_engine():
    from cabinet.core.workflow.engine import WorkflowEngine

    runtime = CabinetRuntime()
    assert isinstance(runtime.workflow_engine, WorkflowEngine)


def test_runtime_injects_workflow_engine_into_office():
    runtime = CabinetRuntime()
    assert runtime.office._workflow_engine is runtime.workflow_engine
```

- [ ] **Step 2: 运行测试确认失败**

Run: `python -m pytest tests/unit/test_runtime.py::test_runtime_creates_workflow_engine -v`
Expected: FAIL — `AttributeError: 'CabinetRuntime' object has no attribute 'workflow_engine'`

- [ ] **Step 3: 修改 CabinetRuntime**

替换 `src/cabinet/runtime.py` 全部内容：

```python
from __future__ import annotations

from cabinet.agents.protocol import AgentFactory
from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.core.events.wiring import RoomEventWiring
from cabinet.core.harness.escalation import DefaultEscalationProtocol
from cabinet.core.harness.evaluator import DefaultEvaluator
from cabinet.core.harness.verification_gate import WorkflowVerificationGate
from cabinet.core.workflow.engine import WorkflowEngine
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.service import DecisionRoomService
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.meeting.service import MeetingRoomService
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.service import OfficeSchedulerService
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.service import SecretaryAgentService
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.service import StrategyDecoderService
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.service import SummaryRoomService


class CabinetRuntime:
    def __init__(self, agent_factory: AgentFactory | None = None, gateway: object | None = None):
        self._agent_factory = agent_factory or StubAgentFactory()
        self._bus = AsyncIOEventBus()
        self._wiring = RoomEventWiring(self._bus)

        self._evaluator = DefaultEvaluator(gateway=gateway)
        self._verification_gate = WorkflowVerificationGate(evaluator=self._evaluator)
        self._escalation_protocol = DefaultEscalationProtocol(rules=[])
        self._workflow_engine = WorkflowEngine(
            agent_factory=self._agent_factory,
            verification_gate=self._verification_gate,
        )

        self._meeting_store = RoomEventStore("meeting")
        self._strategy_store = RoomEventStore("strategy")
        self._decision_store = RoomEventStore("decision")
        self._office_store = RoomEventStore("office")
        self._summary_store = RoomEventStore("summary")
        self._secretary_store = RoomEventStore("secretary")

        self._meeting = MeetingRoomService(self._meeting_store, self._wiring, self._agent_factory)
        self._strategy = StrategyDecoderService(self._strategy_store, self._wiring, self._agent_factory)
        self._decision = DecisionRoomService(
            self._decision_store, self._wiring, self._agent_factory,
            escalation_protocol=self._escalation_protocol,
        )
        self._office = OfficeSchedulerService(
            self._office_store, self._wiring, self._agent_factory,
            verification_gate=self._verification_gate,
            workflow_engine=self._workflow_engine,
        )
        self._summary = SummaryRoomService(self._summary_store, self._wiring, self._agent_factory)
        self._secretary = SecretaryAgentService(self._secretary_store, self._wiring, self._agent_factory)

        self._meeting_handler = MeetingEventHandler()
        self._strategy_handler = StrategyEventHandler()
        self._decision_handler = DecisionEventHandler(self._decision)
        self._office_handler = OfficeEventHandler(self._office)
        self._summary_handler = SummaryEventHandler(self._summary)
        self._secretary_handler = SecretaryEventHandler(self._secretary)

    async def start(self) -> None:
        await self._wiring.register(self._meeting_handler)
        await self._wiring.register(self._strategy_handler)
        await self._wiring.register(self._decision_handler)
        await self._wiring.register(self._office_handler)
        await self._wiring.register(self._summary_handler)
        await self._wiring.register(self._secretary_handler)

    async def stop(self) -> None:
        pass

    @property
    def bus(self) -> AsyncIOEventBus:
        return self._bus

    @property
    def wiring(self) -> RoomEventWiring:
        return self._wiring

    @property
    def evaluator(self) -> DefaultEvaluator:
        return self._evaluator

    @property
    def verification_gate(self) -> WorkflowVerificationGate:
        return self._verification_gate

    @property
    def escalation_protocol(self) -> DefaultEscalationProtocol:
        return self._escalation_protocol

    @property
    def workflow_engine(self) -> WorkflowEngine:
        return self._workflow_engine

    @property
    def meeting(self) -> MeetingRoomService:
        return self._meeting

    @property
    def strategy(self) -> StrategyDecoderService:
        return self._strategy

    @property
    def decision(self) -> DecisionRoomService:
        return self._decision

    @property
    def office(self) -> OfficeSchedulerService:
        return self._office

    @property
    def summary(self) -> SummaryRoomService:
        return self._summary

    @property
    def secretary(self) -> SecretaryAgentService:
        return self._secretary

    @property
    def store(self):
        return self._bus._store
```

- [ ] **Step 4: 运行测试确认通过**

Run: `python -m pytest tests/unit/test_runtime.py -v`
Expected: ALL PASS

- [ ] **Step 5: 提交**

```bash
git add src/cabinet/runtime.py tests/unit/test_runtime.py
git commit -m "feat(runtime): create WorkflowEngine and inject into OfficeSchedulerService"
```

---

### Task 5: 全量测试验证 + ruff check

**Files:**
- 无新文件

- [ ] **Step 1: 运行全量测试**

Run: `python -m pytest -q --no-header`
Expected: ALL PASSED (测试数量应 >= 407 + 新增约 12 = ~419)

- [ ] **Step 2: 运行 ruff check**

Run: `python -m ruff check src/`
Expected: 0 errors

- [ ] **Step 3: 验证 WorkflowEngine 协议合规**

Run: `python -c "from cabinet.core.workflow.engine import WorkflowEngine; from cabinet.agents.stub_factory import StubAgentFactory; e = WorkflowEngine(agent_factory=StubAgentFactory()); print('OK')"`
Expected: `OK`

- [ ] **Step 4: 提交最终状态**

```bash
git add -A
git commit -m "chore: WorkflowEngine implementation complete — all tests pass"
```
