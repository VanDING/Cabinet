from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

import aiosqlite

logger = logging.getLogger(__name__)


class WorkflowVersionStore:
    def __init__(self, db: aiosqlite.Connection):
        self._db = db

    async def save(
        self,
        workflow_id: UUID,
        version: int,
        definition: str,
        checksum: str,
    ) -> str:
        version_id = str(uuid4())
        now = datetime.now(timezone.utc).isoformat()
        await self._db.execute(
            """
            INSERT INTO workflow_versions (id, workflow_id, version, definition, checksum, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (version_id, str(workflow_id), version, definition, checksum, now),
        )
        await self._db.commit()
        return version_id

    async def list_versions(self, workflow_id: UUID) -> list[dict]:
        cursor = await self._db.execute(
            "SELECT id, workflow_id, version, definition, checksum, created_at "
            "FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC",
            (str(workflow_id),),
        )
        rows = await cursor.fetchall()
        return [
            {
                "id": row[0],
                "workflow_id": row[1],
                "version": row[2],
                "definition": row[3],
                "checksum": row[4],
                "created_at": row[5],
            }
            for row in rows
        ]

    async def get_version(self, workflow_id: UUID, version: int) -> dict | None:
        cursor = await self._db.execute(
            "SELECT id, workflow_id, version, definition, checksum, created_at "
            "FROM workflow_versions WHERE workflow_id = ? AND version = ?",
            (str(workflow_id), version),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "workflow_id": row[1],
            "version": row[2],
            "definition": row[3],
            "checksum": row[4],
            "created_at": row[5],
        }

    async def get_latest(self, workflow_id: UUID) -> dict | None:
        cursor = await self._db.execute(
            "SELECT id, workflow_id, version, definition, checksum, created_at "
            "FROM workflow_versions WHERE workflow_id = ? ORDER BY version DESC LIMIT 1",
            (str(workflow_id),),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return {
            "id": row[0],
            "workflow_id": row[1],
            "version": row[2],
            "definition": row[3],
            "checksum": row[4],
            "created_at": row[5],
        }

    async def checksum_matches(self, workflow_id: UUID, checksum: str) -> bool:
        latest = await self.get_latest(workflow_id)
        if latest is None:
            return False
        return latest["checksum"] == checksum
