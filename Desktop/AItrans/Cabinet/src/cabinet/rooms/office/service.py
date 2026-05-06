from __future__ import annotations

import logging
import re
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.agents.context import AgentContext
from cabinet.agents.protocol import AgentFactory
from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.core.parsing import PermissionCheckResult, parse_llm_json
from cabinet.models.events import TaskFailure, TaskOrder, TaskStatusUpdate
from cabinet.rooms.office.domain_events import (
    TaskCancelled,
    TaskFailed,
    TaskStatusChanged,
    TaskSubmitted,
    WorkflowCancelled,
    WorkflowCompleted,
    WorkflowNodeCompleted,
    WorkflowPaused,
    WorkflowStarted,
)
from cabinet.rooms.office.models import (
    PermissionLevel,
    PermissionVerdict,
    Task,
    TaskStatus,
    WorkflowExecution,
)

try:
    from cabinet.core.observability import ROOM_OPERATION, get_tracer

    _tracer = get_tracer("cabinet.office")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False

logger = logging.getLogger(__name__)


class OfficeSchedulerService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: AgentFactory,
        verification_gate: object | None = None,
        workflow_engine: object | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._verification_gate = verification_gate
        self._workflow_engine = workflow_engine
        self._tasks: dict[UUID, Task] = {}
        self._executions: dict[UUID, WorkflowExecution] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, TaskSubmitted):
            self._tasks[event.task_id] = Task(
                id=event.task_id,
                project_id=event.project_id,
                employee_id=event.employee_id,
                skill_id=event.skill_id,
                inputs=event.inputs,
                status="queued",
            )
        elif isinstance(event, TaskCancelled):
            if event.task_id in self._tasks:
                self._tasks[event.task_id] = self._tasks[event.task_id].model_copy(
                    update={"status": "cancelled"},
                )
                cross_room.append(
                    (
                        "task.status_update",
                        TaskStatusUpdate(
                            task_id=event.task_id,
                            status="cancelled",
                            progress=0.0,
                        ),
                        None,
                    )
                )
        elif isinstance(event, TaskStatusChanged):
            if event.task_id in self._tasks:
                self._tasks[event.task_id] = self._tasks[event.task_id].model_copy(
                    update={
                        "status": event.new_status,
                        "progress": event.progress,
                    },
                )
                cross_room.append(
                    (
                        "task.status_update",
                        TaskStatusUpdate(
                            task_id=event.task_id,
                            status=event.new_status,
                            progress=event.progress,
                        ),
                        None,
                    )
                )
        elif isinstance(event, TaskFailed):
            if event.task_id in self._tasks:
                self._tasks[event.task_id] = self._tasks[event.task_id].model_copy(
                    update={
                        "status": "failed",
                        "error": event.error_message,
                        "retry_count": event.retry_count,
                    },
                )
                cross_room.append(
                    (
                        "task.failure",
                        TaskFailure(
                            task_id=event.task_id,
                            error_message=event.error_message,
                            retry_count=event.retry_count,
                        ),
                        None,
                    )
                )
        elif isinstance(event, WorkflowStarted):
            self._executions[event.execution_id] = WorkflowExecution(
                id=event.execution_id,
                workflow_id=event.workflow_id,
                project_id=event.project_id,
            )
        elif isinstance(event, WorkflowNodeCompleted):
            if event.execution_id in self._executions:
                ex = self._executions[event.execution_id]
                completed = ex.completed_nodes + [event.node_id]
                results = {**ex.results, str(event.node_id): event.result}
                self._executions[event.execution_id] = ex.model_copy(
                    update={
                        "completed_nodes": completed,
                        "results": results,
                    }
                )
        elif isinstance(event, WorkflowCompleted):
            if event.execution_id in self._executions:
                self._executions[event.execution_id] = self._executions[
                    event.execution_id
                ].model_copy(
                    update={"status": "completed", "results": event.results},
                )
                cross_room.append(
                    (
                        "task.status_update",
                        TaskStatusUpdate(
                            task_id=event.execution_id,
                            status="completed",
                            progress=1.0,
                        ),
                        None,
                    )
                )
        elif isinstance(event, WorkflowPaused):
            if event.execution_id in self._executions:
                self._executions[event.execution_id] = self._executions[
                    event.execution_id
                ].model_copy(
                    update={"status": "paused", "current_node_id": event.node_id},
                )
        elif isinstance(event, WorkflowCancelled):
            if event.execution_id in self._executions:
                self._executions[event.execution_id] = self._executions[
                    event.execution_id
                ].model_copy(
                    update={"status": "cancelled"},
                )
        return cross_room

    async def submit_task(self, order: TaskOrder) -> Task:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="office", operation="submit_task").inc()
        task_id = uuid4()
        project_id = (
            order.inputs.get("p", uuid4()) if isinstance(order.inputs.get("p"), UUID) else uuid4()
        )
        event = TaskSubmitted(
            task_id=task_id,
            project_id=project_id,
            employee_id=order.employee_id,
            skill_id=order.skill_id,
            inputs=order.inputs,
        )
        await self._publish_and_apply(event)
        return self._tasks[task_id]

    async def cancel_task(self, task_id: UUID) -> None:
        if task_id not in self._tasks:
            raise KeyError(f"task {task_id} not found")
        event = TaskCancelled(task_id=task_id)
        await self._publish_and_apply(event)

    async def get_task_status(self, task_id: UUID) -> TaskStatus:
        if task_id not in self._tasks:
            raise KeyError(f"task {task_id} not found")
        task = self._tasks[task_id]
        return TaskStatus(
            task_id=task.id,
            status=task.status,
            progress=task.progress,
        )

    async def list_active_tasks(self, project_id: UUID) -> list[Task]:
        return [
            t
            for t in self._tasks.values()
            if t.project_id == project_id and t.status in ("queued", "running")
        ]

    async def execute_workflow(self, workflow_id: UUID, inputs: dict) -> WorkflowExecution:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="office", operation="execute_workflow").inc()
        execution_id = uuid4()
        project_id = (
            inputs.get("project_id", uuid4())
            if isinstance(inputs.get("project_id"), UUID)
            else uuid4()
        )
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

            self._last_workflow = workflow

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
                    reason=paused.get("message_template") or "Human approval required",
                )
                await self._publish_and_apply(pause_event)
                return self._executions[execution_id]

            complete_event = WorkflowCompleted(
                execution_id=execution_id,
                results=engine_results,
            )
            await self._publish_and_apply(complete_event)
            return self._executions[execution_id]

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

        if self._workflow_engine is not None and hasattr(self, '_last_workflow'):
            from cabinet.core.workflow.engine import EngineContext

            workflow = self._last_workflow
            node_map, edge_map = self._workflow_engine._build_maps(workflow)
            targets = edge_map.get(execution.current_node_id, [])
            next_node_id = targets[0][0] if targets else None

            if next_node_id is not None:
                ctx = EngineContext(
                    execution_id=str(execution_id),
                    resume_from=next_node_id,
                )
                context_data = {**execution.results, str(execution.current_node_id): {"approval": decision_result}}

                async def on_node_completed(node_id: UUID, result: dict):
                    node_evt = WorkflowNodeCompleted(
                        execution_id=execution_id,
                        node_id=node_id,
                        result=result,
                    )
                    await self._publish_and_apply(node_evt)

                engine_results = await self._workflow_engine.run(
                    workflow, context_data, on_node_completed, context=ctx,
                )

                if "__paused__" in engine_results:
                    paused = engine_results["__paused__"]
                    decision_id = uuid4()
                    pause_event = WorkflowPaused(
                        execution_id=execution_id,
                        node_id=UUID(paused["node_id"]),
                        decision_id=decision_id,
                        reason=paused.get("message_template") or "Human approval required",
                    )
                    await self._publish_and_apply(pause_event)
                    return self._executions[execution_id]

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

    async def cancel_workflow(self, execution_id: UUID, reason: str | None = None) -> WorkflowExecution:
        if execution_id not in self._executions:
            raise KeyError(f"execution {execution_id} not found")
        execution = self._executions[execution_id]
        if execution.status not in ("running", "paused"):
            raise ValueError(f"execution {execution_id} cannot be cancelled (status: {execution.status})")

        if self._workflow_engine is not None:
            await self._workflow_engine.cancel(str(execution_id))

        cancel_event = WorkflowCancelled(execution_id=execution_id, reason=reason)
        await self._publish_and_apply(cancel_event)
        return self._executions[execution_id]

    async def check_permission(self, employee_id: UUID, action: str) -> PermissionVerdict:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="office", operation="check_permission").inc()
        agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
        context = AgentContext(model="default", temperature=0.2)
        output = await agent.execute(
            f"Evaluate permission for:\n\n"
            f"Employee: {employee_id}\n"
            f"Action: {action}\n\n"
            f"Determine: 1) Is this allowed? 2) What permission level (L0-L3)? 3) Reasoning",
            context,
        )
        parsed = parse_llm_json(output.content, PermissionCheckResult)
        if parsed is not None:
            allowed = parsed.allowed
            level = PermissionLevel(parsed.level)
        else:
            allowed = "not allowed" not in output.content.lower()[:50]
            level = self._parse_permission_level(output.content)
        return PermissionVerdict(
            allowed=allowed,
            level=level,
            reason=output.content[:200],
        )

    @staticmethod
    def _parse_permission_level(content: str) -> PermissionLevel:
        match = re.search(r"L([0-3])", content.upper())
        if match:
            return PermissionLevel(f"L{match.group(1)}")
        return PermissionLevel.L1
