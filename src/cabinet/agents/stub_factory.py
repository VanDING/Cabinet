from __future__ import annotations

from uuid import UUID, uuid4

from cabinet.agents.context import AgentContext, AgentOutput, TeamContext, TeamOutput
from cabinet.models.primitives import Employee, Team


class StubAgent:
    def __init__(self, employee: Employee):
        self._employee = employee

    @property
    def employee(self) -> Employee:
        return self._employee

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        return AgentOutput(
            content=f"Stub response for {self._employee.role}: {task}",
            employee_id=self._employee.id,
        )

    async def reflect(self, output: AgentOutput) -> AgentOutput:
        return AgentOutput(
            content=f"Stub reflection: {output.content}",
            employee_id=self._employee.id,
        )


class StubTeam:
    def __init__(self, team: Team):
        self._team = team

    @property
    def team(self) -> Team:
        return self._team

    async def dispatch(self, task: str, context: TeamContext) -> TeamOutput:
        return TeamOutput(
            content=f"Stub team response: {task}",
            team_id=self._team.id,
        )


class StubAgentFactory:
    async def create_agent(self, agent_id: UUID, role: str) -> StubAgent:
        employee = Employee(
            id=agent_id,
            team_id=uuid4(),
            name="stub-agent",
            role=role,
            kind="ai",
        )
        return StubAgent(employee)

    async def create_team(self, agents: list, task: str) -> StubTeam:
        team = Team(
            project_id=uuid4(),
            name="stub-team",
            purpose=task,
            employees=[a.employee.id for a in agents],
        )
        return StubTeam(team)
