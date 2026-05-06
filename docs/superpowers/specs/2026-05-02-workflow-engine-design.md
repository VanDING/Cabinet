# WorkflowEngine 核心引擎 + DecisionRoom 联动设计

## 背景

Cabinet 项目已完成 6 室 Agent 化 + Harness 集成（407 tests passed）。`Workflow` 模型定义了 8 种节点类型（TriggerNode/SkillNode/ConditionNode/LoopNode/HumanApprovalNode/HumanNode/ParallelNode/EndNode）和边（WorkflowEdge），但 `OfficeSchedulerService.execute_workflow()` 是伪执行：让 LLM "描述执行计划"，然后假装完成了一个节点。没有真正的拓扑遍历和节点执行逻辑。

## 目标

实现 WorkflowEngine，按拓扑排序遍历 Workflow 节点，替换 Office 的伪执行逻辑，并实现 HumanApprovalNode 与 DecisionRoom 的联动。

## 范围

### 在范围内

1. WorkflowEngine 核心实现：拓扑排序 + 节点执行器映射
2. 6 种节点的执行逻辑：Trigger/Skill/Condition/HumanApproval/Parallel/End
3. HumanApprovalNode 与 DecisionRoom 联动（暂停/恢复）
4. OfficeSchedulerService 委托给 WorkflowEngine
5. CabinetRuntime 组装 WorkflowEngine

### 不在范围内

- LoopNode 完整实现（骨架仅记录迭代变量，不做实际循环）
- HumanNode 超时策略
- 工作流可视化
- 工作流版本管理
- SkillExecutor 集成（SkillNode 使用 Agent 模拟执行，不调用真实 SkillExecutor）

## 设计决策

### 决策 1：WorkflowEngine 作为独立组件

WorkflowEngine 不放在 `rooms/office/` 下，而是放在 `core/workflow/` 下。原因：
- Workflow 是跨 Room 的概念，不仅 Office 使用
- 引擎逻辑与 Room 的事件溯源逻辑解耦
- 便于独立测试

### 决策 2：SkillNode 使用 Agent 模拟执行

当前 SkillExecutor 需要 ToolRegistry + ModelGateway，集成复杂度高。SkillNode 先用 executor Agent 模拟执行，后续再接入真实 SkillExecutor。这保持了 YAGNI 原则。

### 决策 3：HumanApprovalNode 暂停执行

遇到 HumanApprovalNode 时，WorkflowEngine 将执行状态设为 `paused`，向 DecisionRoom 提交决策请求，然后返回。外部通过 `resume_workflow()` 恢复执行。这是"人类驾驭"原则的体现——需要 Captain 决策时暂停，等待人类介入。

### 决策 4：LoopNode 骨架实现

LoopNode 仅记录迭代变量到执行结果中，不做实际循环体执行。完整实现需要子引擎递归调用，复杂度高，留作后续任务。

### 决策 5：向后兼容

WorkflowEngine 为可选依赖。`OfficeSchedulerService` 新增 `workflow_engine` 参数，默认 `None`。`None` 时保持现有伪执行逻辑。

## 架构变更

### 1. 新增 WorkflowEngine

文件：`src/cabinet/core/workflow/engine.py`

```python
from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

from cabinet.agents.context import AgentContext
from cabinet.agents.protocol import AgentFactory
from cabinet.core.harness.protocol import VerificationGate
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
        verification_gate: VerificationGate | None = None,
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
        paused_info: dict | None = None

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
                paused_info = {
                    "node_id": str(node.id),
                    "decision_type": node.decision_type,
                    "message_template": node.message_template,
                    "context_data": context_data,
                }
                results["__paused__"] = paused_info
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

### 2. 新增领域事件 WorkflowPaused

文件：`src/cabinet/rooms/office/domain_events.py`

在现有事件列表末尾追加：

```python
class WorkflowPaused(BaseModel):
    execution_id: UUID
    node_id: UUID
    decision_id: UUID
    reason: str
```

### 3. OfficeSchedulerService 变更

#### 构造函数变更

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

#### execute_workflow() 变更

当 `workflow_engine` 不为 `None` 时，委托给 WorkflowEngine：

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
            self._executions[execution_id] = self._executions[execution_id].model_copy(
                update={"status": "paused", "current_node_id": UUID(paused["node_id"])},
            )
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

#### 新增 resume_workflow() 方法

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

#### _apply_event 变更

在 `_apply_event` 中增加 `WorkflowPaused` 的处理：

```python
elif isinstance(event, WorkflowPaused):
    if event.execution_id in self._executions:
        self._executions[event.execution_id] = self._executions[event.execution_id].model_copy(
            update={"status": "paused", "current_node_id": event.node_id},
        )
```

### 4. CabinetRuntime 变更

```python
from cabinet.core.workflow.engine import WorkflowEngine

class CabinetRuntime:
    def __init__(self, agent_factory=None, gateway=None):
        # ... existing code ...
        self._evaluator = DefaultEvaluator(gateway=gateway)
        self._verification_gate = WorkflowVerificationGate(evaluator=self._evaluator)
        self._escalation_protocol = DefaultEscalationProtocol(rules=[])
        self._workflow_engine = WorkflowEngine(
            agent_factory=self._agent_factory,
            verification_gate=self._verification_gate,
        )

        # ... existing stores ...

        self._office = OfficeSchedulerService(
            self._office_store, self._wiring, self._agent_factory,
            verification_gate=self._verification_gate,
            workflow_engine=self._workflow_engine,
        )
        # ... rest unchanged ...

    @property
    def workflow_engine(self) -> WorkflowEngine:
        return self._workflow_engine
```

## 向后兼容

- `workflow_engine` 参数默认 `None`，`None` 时保持现有伪执行逻辑
- 现有测试无需修改
- 新增测试覆盖 WorkflowEngine 路径

## 测试策略

### 新增测试

1. **WorkflowEngine 单元测试**：测试各节点类型的执行逻辑
2. **WorkflowEngine 集成测试**：测试完整工作流的拓扑遍历
3. **HumanApprovalNode 暂停/恢复测试**：测试与 DecisionRoom 的联动
4. **Office + WorkflowEngine 集成测试**：测试 execute_workflow 委托给 engine
5. **resume_workflow 测试**：测试暂停后恢复执行
6. **Runtime 组装测试**：验证 WorkflowEngine 正确注入
7. **向后兼容测试**：验证 `workflow_engine=None` 时行为不变

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|:---|:---|:---|
| `src/cabinet/core/workflow/__init__.py` | 新建 | 包初始化 |
| `src/cabinet/core/workflow/engine.py` | 新建 | WorkflowEngine 核心实现 |
| `src/cabinet/rooms/office/service.py` | 修改 | 注入 engine，委托 execute_workflow，新增 resume_workflow |
| `src/cabinet/rooms/office/domain_events.py` | 修改 | 新增 WorkflowPaused 事件 |
| `src/cabinet/runtime.py` | 修改 | 创建 WorkflowEngine 并注入 |
| `tests/unit/core/workflow/__init__.py` | 新建 | 测试包初始化 |
| `tests/unit/core/workflow/test_engine.py` | 新建 | WorkflowEngine 单元测试 |
| `tests/unit/rooms/office/test_service.py` | 修改 | 新增 resume_workflow 测试 |
| `tests/unit/test_runtime.py` | 修改 | 新增 engine 注入测试 |
