from __future__ import annotations

import asyncio
import logging
from uuid import UUID

from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.models.primitives import Employee, SkillDefinition

logger = logging.getLogger(__name__)


class CrewAIAgentAdapter:
    def __init__(
        self,
        employee: Employee,
        skills: list[SkillDefinition] = [],
        handoff_manager: object | None = None,
    ):
        self._employee = employee
        self._crewai_agent = None
        self._skills = skills
        self._handoff_manager = handoff_manager

    def _ensure_agent(self):
        if self._crewai_agent is not None:
            return
        from crewai import Agent

        self._crewai_agent = Agent(
            role=self._employee.role,
            goal=self._employee.personality or f"Execute {self._employee.role} tasks",
            backstory=self._employee.personality or "",
            tools=[],
            memory=False,
            allow_delegation=self._employee.permission_level in ("L2", "L3"),
        )

    @property
    def employee(self) -> Employee:
        return self._employee

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        self._ensure_agent()
        from crewai import Crew, Task

        crewai_task = Task(
            description=task,
            expected_output="Complete the assigned task",
            agent=self._crewai_agent,
        )
        crew = Crew(
            agents=[self._crewai_agent],
            tasks=[crewai_task],
            memory=False,
        )
        result = await asyncio.to_thread(crew.kickoff)
        return AgentOutput(
            content=result.raw,
            employee_id=self._employee.id,
        )

    async def reflect(self, output: AgentOutput) -> AgentOutput:
        return output

    async def handoff_to(self, target_agent_id: UUID, task_description: str, context_snapshot: dict = None) -> object | None:
        if self._handoff_manager is None:
            logger.warning("No handoff_manager configured for agent %s", self._employee.id)
            return None
        from cabinet.agents.handoff import HandoffRequest
        request = HandoffRequest(
            from_agent_id=self._employee.id,
            to_agent_id=target_agent_id,
            task_description=task_description,
            context_snapshot=context_snapshot or {},
            reason="delegation",
        )
        return await self._handoff_manager.request_handoff(request)
