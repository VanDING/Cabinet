from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from cabinet.agents.mailbox import AgentMailbox, MailboxRouter
from cabinet.agents.protocol import AgentFactory
from cabinet.models.primitives import Employee

logger = logging.getLogger(__name__)


class AgentState(str, Enum):
    IDLE = "idle"
    BUSY = "busy"
    WAITING = "waiting"
    ERROR = "error"
    TERMINATED = "terminated"


class PooledAgent(BaseModel):
    agent_id: UUID
    employee: Employee
    state: AgentState = AgentState.IDLE
    current_task: str | None = None
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    last_active_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    total_tasks: int = 0
    error_count: int = 0


class PoolExhaustedError(Exception):
    pass


class AgentPool:
    def __init__(
        self,
        factory: AgentFactory,
        mailbox_router: MailboxRouter,
        max_per_role: int = 3,
    ):
        self._factory = factory
        self._router = mailbox_router
        self._max_per_role = max_per_role
        self._pool: dict[UUID, PooledAgent] = {}
        self._role_index: dict[str, list[UUID]] = {}
        self._mailboxes: dict[UUID, AgentMailbox] = {}
        self._release_events: dict[str, asyncio.Event] = {}

    async def acquire(
        self, role: str, employee_id: UUID | None = None, timeout: float = 30.0,
    ) -> PooledAgent:
        idle_agents = [
            a for a in self._pool.values()
            if a.employee.role == role and a.state == AgentState.IDLE
        ]
        if idle_agents:
            agent = idle_agents[0]
            agent = agent.model_copy(update={
                "state": AgentState.BUSY,
                "last_active_at": datetime.now(timezone.utc).isoformat(),
            })
            self._pool[agent.agent_id] = agent
            return agent

        role_count = len(self._role_index.get(role, []))
        if role_count < self._max_per_role:
            return await self._create_new(role, employee_id)

        key = f"release:{role}"
        event = asyncio.Event()
        self._release_events[key] = event
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            raise PoolExhaustedError(f"No available agent for role '{role}' after {timeout}s")
        finally:
            self._release_events.pop(key, None)

        idle_agents = [
            a for a in self._pool.values()
            if a.employee.role == role and a.state == AgentState.IDLE
        ]
        if idle_agents:
            agent = idle_agents[0]
            agent = agent.model_copy(update={"state": AgentState.BUSY})
            self._pool[agent.agent_id] = agent
            return agent
        raise PoolExhaustedError(f"No available agent for role '{role}'")

    async def _create_new(self, role: str, employee_id: UUID | None = None) -> PooledAgent:
        agent_id = employee_id or uuid4()
        base_agent = await self._factory.create_agent(agent_id, role)
        pooled = PooledAgent(agent_id=agent_id, employee=base_agent.employee, state=AgentState.BUSY)
        self._pool[agent_id] = pooled
        self._role_index.setdefault(role, []).append(agent_id)

        mailbox = AgentMailbox(agent_id)
        self._mailboxes[agent_id] = mailbox
        self._router.register(agent_id, mailbox)
        return pooled

    async def release(self, agent_id: UUID) -> None:
        agent = self._pool.get(agent_id)
        if agent is None:
            return
        self._pool[agent_id] = agent.model_copy(update={
            "state": AgentState.IDLE, "current_task": None,
            "total_tasks": agent.total_tasks + 1,
            "last_active_at": datetime.now(timezone.utc).isoformat(),
        })
        key = f"release:{agent.employee.role}"
        event = self._release_events.get(key)
        if event and not event.is_set():
            event.set()

    async def get_state(self, agent_id: UUID) -> AgentState | None:
        agent = self._pool.get(agent_id)
        return agent.state if agent else None

    async def set_state(self, agent_id: UUID, state: AgentState, task: str | None = None) -> None:
        agent = self._pool.get(agent_id)
        if agent is None:
            return
        self._pool[agent_id] = agent.model_copy(update={"state": state, "current_task": task})

    async def terminate(self, agent_id: UUID) -> None:
        agent = self._pool.get(agent_id)
        if agent is None:
            return
        self._pool[agent_id] = agent.model_copy(update={"state": AgentState.TERMINATED})
        self._router.unregister(agent_id)
        self._mailboxes.pop(agent_id, None)

    async def list_by_role(self, role: str) -> list[PooledAgent]:
        ids = self._role_index.get(role, [])
        return [self._pool[aid] for aid in ids if aid in self._pool]

    async def list_idle(self, role: str | None = None) -> list[PooledAgent]:
        agents = [a for a in self._pool.values() if a.state == AgentState.IDLE]
        if role:
            agents = [a for a in agents if a.employee.role == role]
        return agents

    async def health_check(self) -> dict:
        by_state: dict[str, int] = {}
        by_role: dict[str, int] = {}
        for agent in self._pool.values():
            by_state[agent.state.value] = by_state.get(agent.state.value, 0) + 1
            by_role[agent.employee.role] = by_role.get(agent.employee.role, 0) + 1
        return {"total": len(self._pool), "by_state": by_state, "by_role": by_role}

    def get_mailbox(self, agent_id: UUID) -> AgentMailbox | None:
        return self._mailboxes.get(agent_id)
