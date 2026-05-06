from __future__ import annotations

import json
import time as _time
from datetime import datetime
from uuid import UUID

import aiosqlite

from cabinet.models.events import MessageEnvelope

try:
    from cabinet.core.observability import DB_OPERATION_LATENCY
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False


class SqliteEventStore:
    def __init__(self, db_path: str = "data/db/cabinet.db", conn_manager: object | None = None):
        self._db_path = db_path
        self._conn_manager = conn_manager
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        if self._conn_manager is not None:
            self._db = self._conn_manager.connection
        else:
            self._db = await aiosqlite.connect(self._db_path)
            self._db.row_factory = aiosqlite.Row
            await self._db.commit()

    async def append(self, envelope: MessageEnvelope) -> None:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        await self._db.execute(
            """
            INSERT OR REPLACE INTO event_store
            (message_id, correlation_id, causation_id, sender, recipients,
             message_type, timestamp, status, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(envelope.message_id),
                str(envelope.correlation_id),
                str(envelope.causation_id),
                envelope.sender,
                json.dumps(envelope.recipients),
                envelope.message_type,
                envelope.timestamp.isoformat(),
                envelope.status,
                json.dumps(envelope.payload),
            ),
        )
        await self._db.commit()
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store="event_store", operation="append").observe(
                _time.monotonic() - start
            )

    async def get(self, message_id: UUID) -> MessageEnvelope | None:
        cursor = await self._db.execute(
            "SELECT * FROM event_store WHERE message_id = ?",
            (str(message_id),),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return self._row_to_envelope(row)

    async def get_by_type(self, message_type: str) -> list[MessageEnvelope]:
        cursor = await self._db.execute(
            "SELECT * FROM event_store WHERE message_type = ?",
            (message_type,),
        )
        rows = await cursor.fetchall()
        return [self._row_to_envelope(row) for row in rows]

    async def get_causation_chain(self, message_id: UUID) -> list[MessageEnvelope]:
        chain = []
        current_id = str(message_id)
        visited = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            cursor = await self._db.execute(
                "SELECT * FROM event_store WHERE message_id = ?",
                (current_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                break
            chain.append(self._row_to_envelope(row))
            causation = row["causation_id"]
            current_id = causation if causation != row["message_id"] else None
        chain.reverse()
        return chain

    async def close(self) -> None:
        if self._conn_manager is None and self._db:
            await self._db.close()
        self._db = None

    def _row_to_envelope(self, row: aiosqlite.Row) -> MessageEnvelope:
        return MessageEnvelope(
            message_id=UUID(row["message_id"]),
            correlation_id=UUID(row["correlation_id"]),
            causation_id=UUID(row["causation_id"]),
            sender=row["sender"],
            recipients=json.loads(row["recipients"]),
            message_type=row["message_type"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
            status=row["status"],
            payload=json.loads(row["payload"]),
        )
