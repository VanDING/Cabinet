from __future__ import annotations

import asyncio
import logging

from crewai import Crew, Task

from cabinet.agents.context import TeamContext, TeamOutput
from cabinet.models.primitives import Team

logger = logging.getLogger(__name__)


class CrewAITeamAdapter:
    def __init__(self, team: Team, agents: list = [], handoff_manager: object | None = None):
        self._team = team
        self._agents = agents
        self._handoff_manager = handoff_manager

    @property
    def team(self) -> Team:
        return self._team

    async def dispatch(self, task: str, context: TeamContext) -> TeamOutput:
        crewai_agents = [a._crewai_agent for a in self._agents if hasattr(a, "_crewai_agent")]
        crewai_task = Task(
            description=task,
            expected_output="Complete the team task",
        )
        crew = Crew(
            agents=crewai_agents,
            tasks=[crewai_task],
            memory=False,
        )
        result = await asyncio.to_thread(crew.kickoff)
        return TeamOutput(
            content=result.raw,
            team_id=self._team.id,
        )

    async def delegate_task(self, from_agent_id, to_agent_id: str, task_description: str) -> object | None:
        if self._handoff_manager is None:
            logger.warning("No handoff_manager configured for team %s", self._team.id)
            return None
        from cabinet.agents.handoff import HandoffRequest
        request = HandoffRequest(
            from_agent_id=from_agent_id,
            to_agent_id=to_agent_id,
            task_description=task_description,
            context_snapshot={"team_id": str(self._team.id)},
            reason="delegation",
        )
        return await self._handoff_manager.request_handoff(request)
