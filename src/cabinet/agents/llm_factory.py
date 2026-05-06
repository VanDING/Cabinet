from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from cabinet.agents.llm_agent import LiteLLMAgent, LLMTeam
from cabinet.agents.protocol import BaseAgent
from cabinet.core.gateway.protocol import ModelGateway
from cabinet.models.primitives import Employee, Team

if TYPE_CHECKING:
    from cabinet.agents.employee_store import JsonEmployeeStore
    from cabinet.core.memory.protocol import MemoryStore


DEFAULT_ROLE_PROMPTS: dict[str, str] = {
    "secretary": (
        "You are the Secretary Agent of Cabinet, Captain's first mate and sole interface. "
        "Your tone: respectful but not sycophantic, professional but not cold. "
        "Always address the user as 'Captain'. "
        "Your duties: parse natural language instructions, generate decision cards, "
        "summarize pending items, filter decisions by authorization rules, "
        "and notify Captain of important events."
    ),
    "advisor": (
        "You are an advisor in the Meeting Room. "
        "Provide thoughtful, multi-perspective analysis on the given topic. "
        "Consider risks, opportunities, and trade-offs. "
        "Be concise but thorough."
    ),
    "validator": (
        "You are a cross-validation agent. "
        "Compare multiple perspectives, identify consensus and dissent. "
        "Highlight unresolved disagreements that need Captain's attention."
    ),
    "strategist": (
        "You are a strategy decoder. "
        "Transform strategic proposals into structured action blueprints. "
        "Define action domains, goals, constraints, success criteria, and dependencies."
    ),
    "executor": (
        "You are an execution agent in the Office. "
        "Execute tasks efficiently and report status. "
        "Flag any issues or blockers immediately."
    ),
    "evaluator": (
        "You are an independent quality evaluator. "
        "Verify outputs, challenge assumptions, and discover gaps. "
        "Be rigorous but constructive."
    ),
}


class LLMAgentFactory:
    def __init__(
        self,
        gateway: ModelGateway,
        role_prompts: dict[str, str] | None = None,
        memory_store: MemoryStore | None = None,
        employee_store: JsonEmployeeStore | None = None,
    ):
        self._gateway = gateway
        self._role_prompts = role_prompts or DEFAULT_ROLE_PROMPTS
        self._memory_store = memory_store
        self._employee_store = employee_store

    async def create_agent(self, agent_id: UUID, role: str) -> LiteLLMAgent:
        if self._employee_store is not None:
            registered = await self._employee_store.get(agent_id)
            if registered is not None:
                prompt = registered.personality or self._role_prompts.get(role, "")
                return LiteLLMAgent(
                    registered, self._gateway, system_prompt=prompt, memory_store=self._memory_store
                )

        prompt = self._role_prompts.get(role, "")
        employee = Employee(
            id=agent_id,
            team_id=uuid4(),
            name=f"agent-{role}",
            role=role,
            kind="ai",
            personality=prompt,
        )
        return LiteLLMAgent(
            employee, self._gateway, system_prompt=prompt, memory_store=self._memory_store
        )

    async def create_team(self, agents: list[BaseAgent], task: str) -> LLMTeam:
        team = Team(
            project_id=uuid4(),
            name=f"team-{task[:20]}",
            purpose=task,
            employees=[a.employee.id for a in agents],
        )
        return LLMTeam(team, agents, self._gateway)
