from __future__ import annotations

import asyncio
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
    def __init__(self, db_path: str = "data/db/cabinet.db", conn_manager: object | None = None,
                 buffer_size: int = 20, flush_interval: float = 2.0):
        self._db_path = db_path
        self._conn_manager = conn_manager
        self._db: aiosqlite.Connection | None = None
        self._buffer: list[MessageEnvelope] = []
        self._buffer_size = buffer_size
        self._flush_interval = flush_interval
        self._flush_task: asyncio.Task | None = None

    async def initialize(self) -> None:
        if self._conn_manager is not None:
            self._db = self._conn_manager.connection
        else:
            self._db = await aiosqlite.connect(self._db_path)
            self._db.row_factory = aiosqlite.Row
            await self._db.commit()
        self._flush_task = asyncio.create_task(self._periodic_flush())

    async def append(self, envelope: MessageEnvelope) -> None:
        start = _time.monotonic() if _OBSERVABILITY_ENABLED else 0
        self._buffer.append(envelope)
        if len(self._buffer) >= self._buffer_size:
            await self._flush_buffer()
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store="event_store", operation="append").observe(
                _time.monotonic() - start
            )

    async def _flush_buffer(self) -> None:
        if not self._buffer or self._db is None:
            return
        events = self._buffer[:]
        self._buffer.clear()
        for envelope in events:
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

    async def _periodic_flush(self) -> None:
        try:
            while True:
                await asyncio.sleep(self._flush_interval)
                await self._flush_buffer()
        except asyncio.CancelledError:
            await self._flush_buffer()

    async def get(self, message_id: UUID) -> MessageEnvelope | None:
        await self._flush_buffer()
        cursor = await self._db.execute(
            "SELECT * FROM event_store WHERE message_id = ?",
            (str(message_id),),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return self._row_to_envelope(row)

    async def get_by_type(self, message_type: str) -> list[MessageEnvelope]:
        await self._flush_buffer()
        cursor = await self._db.execute(
            "SELECT * FROM event_store WHERE message_type = ?",
            (message_type,),
        )
        rows = await cursor.fetchall()
        return [self._row_to_envelope(row) for row in rows]

    async def get_causation_chain(self, message_id: UUID) -> list[MessageEnvelope]:
        await self._flush_buffer()
        cursor = await self._db.execute(
            """
            WITH RECURSIVE chain AS (
                SELECT * FROM event_store WHERE message_id = ?
                UNION ALL
                SELECT e.* FROM event_store e
                INNER JOIN chain c ON e.message_id = c.causation_id
                WHERE e.message_id != c.message_id
            )
            SELECT * FROM chain ORDER BY timestamp ASC
            """,
            (str(message_id),),
        )
        rows = await cursor.fetchall()
        return [self._row_to_envelope(row) for row in rows]

    async def close(self) -> None:
        await self._flush_buffer()
        if self._flush_task is not None:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
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
