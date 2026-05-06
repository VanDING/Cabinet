from __future__ import annotations

import logging
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.agents.pool import AgentPool, AgentState

logger = logging.getLogger(__name__)


class RecoveryAction(str, Enum):
    RETRY = "retry"
    REPLACE = "replace"
    ESCALATE = "escalate"
    SKIP = "skip"


class RecoveryConfig(BaseModel):
    max_retries: int = 3
    retry_delay: float = 1.0
    critical_errors: list[str] = ["critical", "auth", "permission"]


class FailureRecord(BaseModel):
    agent_id: UUID
    error_type: str
    error_message: str
    timestamp: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class AgentRecovery:
    def __init__(self, pool: AgentPool, config: RecoveryConfig | None = None):
        self._pool = pool
        self._config = config or RecoveryConfig()
        self._failures: dict[UUID, list[FailureRecord]] = {}

    async def record_failure(self, agent_id: UUID, error_type: str, error_message: str) -> None:
        record = FailureRecord(
            agent_id=agent_id, error_type=error_type, error_message=error_message,
        )
        if agent_id not in self._failures:
            self._failures[agent_id] = []
        self._failures[agent_id].append(record)
        logger.warning("Agent %s failure: %s - %s", agent_id, error_type, error_message)

    async def get_failures(self, agent_id: UUID) -> list[FailureRecord]:
        return self._failures.get(agent_id, [])

    async def decide_action(self, agent_id: UUID) -> RecoveryAction:
        records = self._failures.get(agent_id, [])
        if not records:
            return RecoveryAction.SKIP

        latest = records[-1]
        if latest.error_type in self._config.critical_errors:
            return RecoveryAction.ESCALATE

        failure_count = len(records)
        if failure_count >= self._config.max_retries:
            return RecoveryAction.REPLACE

        return RecoveryAction.RETRY

    async def execute_recovery(
        self, agent_id: UUID, action: RecoveryAction, role: str | None = None,
    ) -> bool:
        if action == RecoveryAction.RETRY:
            return await self._retry(agent_id)
        elif action == RecoveryAction.REPLACE:
            return await self._replace(agent_id, role)
        elif action == RecoveryAction.ESCALATE:
            logger.error("Escalation required for agent %s", agent_id)
            return True
        return False

    async def _retry(self, agent_id: UUID) -> bool:
        await self._pool.set_state(agent_id, AgentState.IDLE)
        logger.info("Retrying agent %s", agent_id)
        return True

    async def _replace(self, agent_id: UUID, role: str | None = None) -> bool:
        await self._pool.terminate(agent_id)
        if role:
            try:
                await self._pool.acquire(role)
                logger.info("Replaced agent %s with new %s agent", agent_id, role)
            except Exception:
                logger.error("Failed to replace agent %s", agent_id)
        return True

    async def get_stats(self) -> dict:
        total = sum(len(v) for v in self._failures.values())
        by_type: dict[str, int] = {}
        for records in self._failures.values():
            for r in records:
                by_type[r.error_type] = by_type.get(r.error_type, 0) + 1
        return {"total_failures": total, "by_type": by_type, "affected_agents": len(self._failures)}
