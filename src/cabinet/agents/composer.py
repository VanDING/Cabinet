from __future__ import annotations

import logging
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.agents.capability import CapabilityRegistry

logger = logging.getLogger(__name__)


class TeamMember(BaseModel):
    agent_id: UUID
    role: str
    skills: list[str] = []
    assigned_task: str | None = None


class TeamComposition(BaseModel):
    id: UUID
    task: str
    members: list[TeamMember]
    leader_id: UUID | None = None
    strategy: str = "collaborative"


LEADER_ROLES = {"strategist", "coordinator", "manager", "captain"}


class TeamComposer:
    def __init__(self, capability_registry: CapabilityRegistry):
        self._registry = capability_registry

    async def compose(
        self,
        task: str,
        required_roles: list[str] | None = None,
        required_skills: list[str] | None = None,
        max_members: int = 5,
        strategy: str = "collaborative",
    ) -> TeamComposition:
        members: list[TeamMember] = []
        used_agents: set[UUID] = set()
        leader_id: UUID | None = None

        if required_roles:
            for role in required_roles:
                candidates = await self._registry.discover(role=role)
                candidates = [c for c in candidates if c.agent_id not in used_agents]
                candidates.sort(key=lambda c: c.current_load)
                if candidates:
                    cap = candidates[0]
                    members.append(TeamMember(
                        agent_id=cap.agent_id, role=cap.role, skills=cap.skills,
                    ))
                    used_agents.add(cap.agent_id)
                    if leader_id is None and cap.role in LEADER_ROLES:
                        leader_id = cap.agent_id

        if required_skills:
            for skill in required_skills:
                if any(skill in m.skills for m in members):
                    continue
                candidates = await self._registry.discover(skill=skill)
                candidates = [c for c in candidates if c.agent_id not in used_agents]
                candidates.sort(key=lambda c: c.current_load)
                if candidates:
                    cap = candidates[0]
                    members.append(TeamMember(
                        agent_id=cap.agent_id, role=cap.role, skills=cap.skills,
                    ))
                    used_agents.add(cap.agent_id)

        if leader_id is None and members:
            leader_id = members[0].agent_id

        return TeamComposition(
            id=uuid4(), task=task, members=members,
            leader_id=leader_id, strategy=strategy,
        )
