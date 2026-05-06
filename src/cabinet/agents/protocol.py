from __future__ import annotations

from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.agents.context import (
    AgentContext,
    AgentOutput,
    SkillContext,
    SkillOutput,
    TeamContext,
    TeamOutput,
)
from cabinet.models.primitives import Employee, SkillDefinition, Team


@runtime_checkable
class BaseAgent(Protocol):
    @property
    def employee(self) -> Employee: ...

    async def execute(self, task: str, context: AgentContext) -> AgentOutput: ...
    async def reflect(self, output: AgentOutput) -> AgentOutput: ...


@runtime_checkable
class BaseSkill(Protocol):
    @property
    def definition(self) -> SkillDefinition: ...

    async def run(self, inputs: dict, context: SkillContext) -> SkillOutput: ...


@runtime_checkable
class BaseTeam(Protocol):
    @property
    def team(self) -> Team: ...

    async def dispatch(self, task: str, context: TeamContext) -> TeamOutput: ...


@runtime_checkable
class AgentFactory(Protocol):
    async def create_agent(self, agent_id: UUID, role: str) -> BaseAgent: ...
    async def create_team(self, agents: list[BaseAgent], task: str) -> BaseTeam: ...
