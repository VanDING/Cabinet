from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import TYPE_CHECKING
from uuid import uuid4

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.agents.structured import StructuredOutputConfig, StructuredOutputParser
from cabinet.agents.tools import ToolDefinition, partition_tool_calls
from cabinet.core.compact import TokenBudget, compact_tool_result
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.core.resilience import (
    CircuitBreaker,
    CircuitBreakerOpenError,
    retry_with_backoff,
)
from cabinet.models.primitives import Employee, Team

if TYPE_CHECKING:
    from cabinet.core.memory.protocol import MemoryStore


logger = logging.getLogger(__name__)


class LiteLLMAgent:
    def __init__(
        self,
        employee: Employee,
        gateway: ModelGateway,
        system_prompt: str = "",
        memory_store: MemoryStore | None = None,
        max_history: int = 20,
        max_context_tokens: int | None = None,
        tools: list[ToolDefinition] | None = None,
        tool_registry: object | None = None,
    ):
        self._employee = employee
        self._gateway = gateway
        self._system_prompt = system_prompt or (
            f"You are a {employee.role}. {employee.personality or ''}"
        )
        self._memory_store = memory_store
        self._max_history = max_history
        self._history: list[dict] = []
        self._tools = tools or []
        self._tool_registry = tool_registry
        self._tool_schemas = self._build_tool_schemas()
        self._output_parser = StructuredOutputParser()
        self._token_budget = TokenBudget(
            model_max_tokens=max_context_tokens or 200_000
        )
        self._tool_breaker = CircuitBreaker(max_failures=3)
        self._api_breaker = CircuitBreaker(max_failures=5, reset_timeout=30.0)

    @property
    def employee(self) -> Employee:
        return self._employee

    async def _build_messages(self, task: str) -> list[dict]:
        system_msgs = [{"role": "system", "content": self._system_prompt}]
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope

            items = await self._memory_store.search(
                str(self._employee.id),
                MemoryScope.LONG_TERM,
                limit=10,
            )
            if items:
                from cabinet.core.memory.scoring import MemoryScorer
                scorer = MemoryScorer()
                scored = scorer.score(items, task)
                relevant = [s for s in scored[:3] if s.score >= MemoryScorer.MIN_SCORE]
                if relevant:
                    memory_text = "\n".join(
                        f"- [score={s.score:.2f}] {s.item.content}" for s in relevant
                    )
                    system_msgs.append({
                        "role": "system",
                        "content": f"Relevant memory:\n{memory_text}",
                    })
        new_msg = {"role": "user", "content": task}
        return self._token_budget.fit_messages(system_msgs, self._history, new_msg)

    def _trim_history(self) -> None:
        result = self._token_budget.fit_messages([], self._history, {"role": "user", "content": ""})
        self._history = result[:-1]

    def _build_tool_schemas(self) -> list[dict]:
        return [t.to_openai_schema() for t in self._tools]

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        messages = await self._build_messages(task)
        start = time.monotonic()

        if self._tool_schemas:
            return await self._execute_with_tools(task, context, messages, start)

        response = await self._gateway.complete(
            messages=messages,
            model=context.model,
            temperature=context.temperature,
        )
        elapsed = (time.monotonic() - start) * 1000
        logger.info("Agent execute: employee=%s model=%s", self._employee.role, context.model)
        self._history.append({"role": "user", "content": task})
        self._history.append({"role": "assistant", "content": response.content})
        self._trim_history()

        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryItem, MemoryScope

            await self._memory_store.store(
                f"chat:{uuid4()}",
                MemoryItem(
                    owner_id=self._employee.id,
                    content=f"Q: {task}\nA: {response.content}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"employee_id": str(self._employee.id), "role": self._employee.role},
                ),
                MemoryScope.LONG_TERM,
            )

        return AgentOutput(content=response.content, employee_id=self._employee.id, duration_ms=elapsed)

    async def execute_stream(self, task: str, context: AgentContext):
        messages = await self._build_messages(task)
        full_content: list[str] = []
        async for chunk in self._gateway.stream(
            messages=messages, model=context.model, temperature=context.temperature
        ):
            full_content.append(chunk.content)
            yield chunk.content
        complete = "".join(full_content)
        logger.info("Agent stream complete: employee=%s model=%s", self._employee.role, context.model)
        self._history.append({"role": "user", "content": task})
        self._history.append({"role": "assistant", "content": complete})
        self._trim_history()

        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryItem, MemoryScope

            await self._memory_store.store(
                f"chat:{uuid4()}",
                MemoryItem(
                    owner_id=self._employee.id,
                    content=f"Q: {task}\nA: {complete}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"employee_id": str(self._employee.id), "role": self._employee.role},
                ),
                MemoryScope.LONG_TERM,
            )

    async def reflect(self, output: AgentOutput) -> AgentOutput:
        reflection_prompt = f"Review and improve your previous response:\n\n{output.content}"
        system_msgs = [{"role": "system", "content": self._system_prompt}]
        new_msg = {"role": "user", "content": reflection_prompt}
        messages = self._token_budget.fit_messages(system_msgs, self._history, new_msg)
        response = await self._gateway.complete(messages=messages, model="default", temperature=0.5)
        return AgentOutput(content=response.content, employee_id=self._employee.id)

    async def _execute_with_tools(
        self, task: str, context: AgentContext, messages: list[dict], start: float,
    ) -> AgentOutput:
        self._history.append({"role": "user", "content": task})

        for _ in range(10):
            kwargs = {
                "messages": messages, "model": context.model,
                "temperature": context.temperature,
            }
            if self._tool_schemas:
                kwargs["tools"] = self._tool_schemas
                kwargs["tool_choice"] = "auto"

            try:
                response = await self._api_breaker.call(
                    lambda: retry_with_backoff(
                        lambda: self._gateway.complete(**kwargs)
                    )
                )
            except CircuitBreakerOpenError:
                elapsed = (time.monotonic() - start) * 1000
                return AgentOutput(
                    content="Service temporarily unavailable (circuit breaker open)",
                    employee_id=self._employee.id,
                    status="error",
                    duration_ms=elapsed,
                )

            tool_calls = getattr(response, "tool_calls", None)

            if not tool_calls:
                elapsed = (time.monotonic() - start) * 1000
                self._history.append({"role": "assistant", "content": response.content})
                self._trim_history()
                return AgentOutput(
                    content=response.content, employee_id=self._employee.id,
                    duration_ms=elapsed,
                )

            assistant_msg = {"role": "assistant", "content": response.content or ""}
            assistant_msg["tool_calls"] = [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in tool_calls
            ]
            messages.append(assistant_msg)

            partitions = partition_tool_calls(tool_calls)
            for batch in partitions:
                if len(batch) == 1:
                    tc = batch[0]
                    try:
                        result = await self._tool_breaker.call(
                            lambda tc=tc: self._execute_tool_call(tc)
                        )
                    except CircuitBreakerOpenError:
                        result = {"error": "Tool execution suspended", "status": "error"}
                    messages.append({
                        "role": "tool", "tool_call_id": tc.id,
                        "content": json.dumps(result),
                    })
                else:
                    batch_results = await asyncio.gather(*[
                        self._tool_breaker.call(
                            lambda tc=tc: self._execute_tool_call(tc)
                        ) for tc in batch
                    ], return_exceptions=True)
                    for tc, result in zip(batch, batch_results):
                        if isinstance(result, CircuitBreakerOpenError):
                            result = {"error": "Tool execution suspended", "status": "error"}
                        elif isinstance(result, Exception):
                            result = {"error": str(result), "status": "error"}
                        messages.append({
                            "role": "tool", "tool_call_id": tc.id,
                            "content": json.dumps(result),
                        })

        elapsed = (time.monotonic() - start) * 1000
        self._history.append({"role": "assistant", "content": "Max tool calls reached"})
        self._trim_history()
        return AgentOutput(
            content="Max tool calls reached", employee_id=self._employee.id,
            status="partial", duration_ms=elapsed,
        )

    async def _execute_tool_call(self, tool_call) -> dict:
        tool_name = tool_call.function.name
        try:
            tool_args = json.loads(tool_call.function.arguments)
        except (json.JSONDecodeError, TypeError):
            tool_args = {}

        if self._tool_registry is not None:
            try:
                from cabinet.agents.tools import ToolRegistryAdapter
                if isinstance(self._tool_registry, ToolRegistryAdapter):
                    result = await self._tool_registry.execute_tool(tool_name, tool_args)
                    result_str = str(result)
                    compacted, filepath = compact_tool_result(result_str, tool_name)
                    truncated = filepath is not None or result_str != compacted
                    return {"result": compacted, "status": "success", "truncated": truncated}
            except Exception as e:
                return {"error": str(e), "status": "error"}

        simulated = f"Tool {tool_name} executed with {tool_args}"
        return {"result": simulated, "status": "simulated"}

    async def execute_structured(
        self, task: str, context: AgentContext, output_schema: dict,
    ) -> AgentOutput:
        messages = await self._build_messages(task)
        start = time.monotonic()

        kwargs = {
            "messages": messages, "model": context.model,
            "temperature": context.temperature,
            "response_format": {"type": "json_object"},
        }
        response = await self._gateway.complete(**kwargs)
        elapsed = (time.monotonic() - start) * 1000

        parsed = self._output_parser.parse(
            response.content, StructuredOutputConfig(schema_def=output_schema),
        )

        self._history.append({"role": "user", "content": task})
        self._history.append({"role": "assistant", "content": response.content})
        self._trim_history()

        return AgentOutput(
            content=response.content, employee_id=self._employee.id,
            structured_data=parsed, duration_ms=elapsed,
        )


class LLMTeam:
    def __init__(
        self,
        team: Team,
        agents: list[LiteLLMAgent],
        gateway: ModelGateway,
    ):
        self._team = team
        self._agents = agents
        self._gateway = gateway

    @property
    def team(self) -> Team:
        return self._team

    async def dispatch(self, task: str, context: TeamContext) -> TeamOutput:
        agent_descriptions = "\n".join(
            f"- {a.employee.role}: {a.employee.personality or 'general'}" for a in self._agents
        )
        messages = [
            {
                "role": "system",
                "content": f"You are a team coordinator. Team members:\n{agent_descriptions}",
            },
            {"role": "user", "content": task},
        ]
        response = await self._gateway.complete(messages=messages, model=context.model)
        return TeamOutput(content=response.content, team_id=self._team.id)
