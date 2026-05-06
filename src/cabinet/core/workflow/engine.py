from __future__ import annotations

import asyncio
import logging
from uuid import UUID, uuid4

from cabinet.agents.context import AgentContext
from cabinet.agents.protocol import AgentFactory
from cabinet.core.workflow.safe_eval import safe_eval
from cabinet.models.workflows import (
    ConditionNode,
    EndNode,
    GraphResult,
    HumanApprovalNode,
    HumanNode,
    LoopNode,
    ParallelNode,
    SkillNode,
    TriggerNode,
    Workflow,
    WorkflowNode,
)

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
        tool_registry: object | None = None,
    ):
        self._agent_factory = agent_factory
        self._verification_gate = verification_gate
        self._knowledge_base = knowledge_base
        self._dead_letter_queue = dead_letter_queue
        self._tool_registry = tool_registry
        self._cancel_tokens: dict[str, asyncio.Event] = {}
        self._current_execution_id: str | None = None

    async def run(
        self,
        workflow: Workflow,
        inputs: dict,
        on_node_completed: object | None = None,
        context: EngineContext | None = None,
    ) -> dict:
        try:
            return await asyncio.wait_for(
                self._run_inner(workflow, inputs, on_node_completed, context),
                timeout=3600.0,
            )
        except asyncio.TimeoutError:
            logger.error("Workflow execution timed out after 3600s")
            raise

    async def _run_inner(
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
            on_node_completed=on_node_completed,
        )

        results = dict(graph_result.output)
        if graph_result.paused and graph_result.pause_info:
            results["__paused__"] = graph_result.pause_info
        if graph_result.completed:
            if "__end__" not in results:
                results["__end__"] = {"status": "completed"}

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
        on_node_completed: object | None = None,
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

            if on_node_completed is not None:
                await on_node_completed(node.id, node_result.output)

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

        if self._tool_registry is not None:
            try:
                skill = await self._tool_registry.get_skill(node.skill_id)
                if skill is not None:
                    skill_inputs = dict(node.inputs)
                    for k, v in node.inputs.items():
                        if isinstance(v, str) and v.startswith("$"):
                            skill_inputs[k] = context_data.get(v[1:], v)
                    result = await self._tool_registry.execute(skill.name, skill_inputs)
                    output_data = {"output": result.content, "skill_id": str(node.skill_id), "executed_via": "tool_registry"}
                    if knowledge_context:
                        output_data["knowledge_context"] = knowledge_context[:500]
                    return NodeResult(node.id, output_data)
            except Exception as exc:
                logger.error("Tool registry execution failed for skill %s: %s", node.skill_id, exc, exc_info=True)

        policy = node.retry_policy
        max_attempts = (policy.max_retries + 1) if policy else 1
        last_error = None

        for attempt in range(max_attempts):
            try:
                agent = await self._agent_factory.create_agent(uuid4(), "executor")
                context = AgentContext(model="default", temperature=0.3)
                prompt = f"Execute skill {node.skill_id} for employee {node.employee_id} with inputs: {node.inputs}\n\n"
                if knowledge_context:
                    prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
                prompt += f"Context: {context_data}\n\nDescribe the execution result."
                output = await agent.execute(prompt, context)
                return NodeResult(node.id, {"output": output.content, "skill_id": str(node.skill_id)})
            except Exception as exc:
                last_error = exc
                if policy and attempt < policy.max_retries:
                    import asyncio
                    delay = min(policy.backoff_base * (2 ** attempt), policy.backoff_max)
                    await asyncio.sleep(delay)
                    continue

        if self._dead_letter_queue is not None:
            await self._dead_letter_queue.enqueue(
                event_type="skill.execution_failed",
                source=f"node:{node.id}",
                payload={"skill_id": str(node.skill_id), "attempt": max_attempts},
                error=str(last_error),
            )
        return NodeResult(node.id, {"failed": True, "error": str(last_error), "skill_id": str(node.skill_id)})

    async def _execute_condition(self, node: ConditionNode, context_data: dict) -> NodeResult:
        result = safe_eval(node.expression, context_data)
        if result is None:
            logger.warning("Condition eval returned None for: %s, defaulting to False", node.expression)
            result = False
        is_true = bool(result)
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
        completed_iterations = 0
        for iteration in range(node.max_iterations):
            if context.cancel_token and context.cancel_token.is_set():
                return NodeResult(node.id, {"cancelled": True, "iteration": completed_iterations})

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
                return NodeResult(node.id, {"paused": True, "iteration": completed_iterations, **graph_result.output})
            if graph_result.failed and node.break_on_error:
                return NodeResult(node.id, {"failed": True, "iteration": completed_iterations, "error": graph_result.error})
            if graph_result.cancelled:
                return NodeResult(node.id, {"cancelled": True, "iteration": completed_iterations})

            context_data.update(graph_result.output)
            completed_iterations += 1

        return NodeResult(node.id, {
            "iterations": completed_iterations,
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
                    branch_id = str(node.branch_node_ids[i])
                    branch_results[branch_id] = {"error": str(result)}
                    if self._dead_letter_queue is not None:
                        await self._dead_letter_queue.enqueue(
                            event_type="parallel.branch_failed",
                            source=f"node:{node.id}:branch:{branch_id}",
                            payload={"branch_id": branch_id},
                            error=str(result),
                        )
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
        result = safe_eval(expr, context_data)
        if result is None:
            logger.warning("Failed to evaluate expression: %s", expr)
        return result

    @staticmethod
    def _eval_condition(expr: str, context_data: dict) -> bool:
        result = safe_eval(expr, context_data)
        return bool(result) if result is not None else False
