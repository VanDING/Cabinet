from __future__ import annotations

import logging
from uuid import UUID

from pydantic import BaseModel

from cabinet.agents.employee_store import JsonEmployeeStore
from cabinet.core.tools.registry import LocalToolRegistry

logger = logging.getLogger(__name__)


class AgentCapability(BaseModel):
    agent_id: UUID
    role: str
    skills: list[str] = []
    specializations: list[str] = []
    max_concurrent_tasks: int = 1
    current_load: int = 0


class CapabilityRegistry:
    def __init__(self, employee_store: JsonEmployeeStore, tool_registry: LocalToolRegistry):
        self._employee_store = employee_store
        self._tool_registry = tool_registry
        self._capabilities: dict[UUID, AgentCapability] = {}

    async def register(self, agent_id: UUID, capability: AgentCapability) -> None:
        self._capabilities[agent_id] = capability

    async def discover(self, query: str = "", role: str | None = None, skill: str | None = None) -> list[AgentCapability]:
        results = list(self._capabilities.values())
        if role:
            results = [c for c in results if c.role == role]
        if skill:
            results = [c for c in results if skill in c.skills]
        if query:
            q = query.lower()
            results = [c for c in results if q in c.role.lower() or any(q in s.lower() for s in c.skills)]
        return results

    async def get_capability(self, agent_id: UUID) -> AgentCapability | None:
        return self._capabilities.get(agent_id)

    async def update_load(self, agent_id: UUID, delta: int) -> None:
        cap = self._capabilities.get(agent_id)
        if cap is None:
            return
        self._capabilities[agent_id] = cap.model_copy(
            update={"current_load": max(0, cap.current_load + delta)}
        )
