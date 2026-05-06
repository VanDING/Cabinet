from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from uuid import uuid4

import aiosqlite

logger = logging.getLogger(__name__)


class DeadLetterQueue:
    def __init__(self, db: aiosqlite.Connection, conn_manager: object | None = None):
        self._db = db
        self._conn_manager = conn_manager

    async def enqueue(
        self,
        event_type: str,
        source: str | None = None,
        payload: dict | None = None,
        error: str | None = None,
    ) -> str:
        entry_id = str(uuid4())
        now = datetime.now(timezone.utc).isoformat()
        await self._db.execute(
            """
            INSERT INTO dead_letter_queue (id, event_type, source, payload, error, retry_count, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
            """,
            (entry_id, event_type, source, json.dumps(payload or {}), error, now),
        )
        await self._db.commit()
        logger.warning("DLQ enqueue: %s from %s - %s", event_type, source, error)
        return entry_id

    async def peek(self, limit: int = 50) -> list[dict]:
        cursor = await self._db.execute(
            "SELECT id, event_type, source, payload, error, retry_count, created_at, last_retry_at "
            "FROM dead_letter_queue ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        rows = await cursor.fetchall()
        return [self._row_to_dict(row) for row in rows]

    async def retry(self, entry_id: str) -> bool:
        now = datetime.now(timezone.utc).isoformat()
        cursor = await self._db.execute(
            """
            UPDATE dead_letter_queue SET retry_count = retry_count + 1, last_retry_at = ?
            WHERE id = ?
            """,
            (now, entry_id),
        )
        await self._db.commit()
        return cursor.rowcount > 0

    async def remove(self, entry_id: str) -> bool:
        cursor = await self._db.execute(
            "DELETE FROM dead_letter_queue WHERE id = ?",
            (entry_id,),
        )
        await self._db.commit()
        return cursor.rowcount > 0

    async def list_by_type(self, event_type: str) -> list[dict]:
        cursor = await self._db.execute(
            "SELECT id, event_type, source, payload, error, retry_count, created_at, last_retry_at "
            "FROM dead_letter_queue WHERE event_type = ? ORDER BY created_at DESC",
            (event_type,),
        )
        rows = await cursor.fetchall()
        return [self._row_to_dict(row) for row in rows]

    async def stats(self) -> dict:
        cursor = await self._db.execute("SELECT COUNT(*) FROM dead_letter_queue")
        row = await cursor.fetchone()
        total = row[0] if row else 0

        cursor = await self._db.execute(
            "SELECT event_type, COUNT(*) FROM dead_letter_queue GROUP BY event_type"
        )
        type_rows = await cursor.fetchall()
        by_type = {r[0]: r[1] for r in type_rows}

        return {"total": total, "by_type": by_type}

    @staticmethod
    def _row_to_dict(row) -> dict:
        return {
            "id": row[0],
            "event_type": row[1],
            "source": row[2],
            "payload": json.loads(row[3]) if row[3] else {},
            "error": row[4],
            "retry_count": row[5],
            "created_at": row[6],
            "last_retry_at": row[7],
        }

    async def close(self) -> None:
        if self._conn_manager is None and self._db:
            await self._db.close()
        self._db = None
