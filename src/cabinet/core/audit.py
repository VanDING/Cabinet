from __future__ import annotations

import asyncio
import aiosqlite
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from opentelemetry import trace


class AuditEvent(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    action: str
    actor: str
    role: str = ""
    resource_type: str
    resource_id: str
    detail: str = ""
    ip_address: str = ""
    trace_id: str = ""


class AuditStore:
    def __init__(self, db_path: str, buffer_size: int = 50, flush_interval: float = 5.0,
                 conn_manager: object | None = None):
        self._db_path = db_path
        self._conn_manager = conn_manager
        self._db: aiosqlite.Connection | None = None
        self._buffer: list[AuditEvent] = []
        self._buffer_size = buffer_size
        self._flush_interval = flush_interval
        self._flush_task: asyncio.Task | None = None

    async def initialize(self) -> None:
        if self._conn_manager is not None:
            self._db = self._conn_manager.connection
        else:
            self._db = await aiosqlite.connect(self._db_path)
        self._db.row_factory = aiosqlite.Row
        await self._db.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                action TEXT NOT NULL,
                actor TEXT NOT NULL,
                role TEXT DEFAULT '',
                resource_type TEXT NOT NULL,
                resource_id TEXT NOT NULL,
                detail TEXT DEFAULT '',
                ip_address TEXT DEFAULT '',
                trace_id TEXT DEFAULT ''
            )
        """)
        await self._db.commit()
        self._flush_task = asyncio.create_task(self._periodic_flush())

    async def log(self, event: AuditEvent) -> None:
        if self._db is None:
            return
        span = trace.get_current_span()
        ctx = span.get_span_context()
        event.trace_id = format(ctx.trace_id, "032x") if ctx.is_valid else event.trace_id
        self._buffer.append(event)
        if len(self._buffer) >= self._buffer_size:
            await self._flush_buffer()

    async def _flush_buffer(self) -> None:
        if not self._buffer or self._db is None:
            return
        events = self._buffer[:]
        self._buffer.clear()
        for event in events:
            await self._db.execute(
                "INSERT INTO audit_log (timestamp, action, actor, role, resource_type, resource_id, detail, ip_address, trace_id) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    event.timestamp.isoformat(),
                    event.action,
                    event.actor,
                    event.role,
                    event.resource_type,
                    event.resource_id,
                    event.detail,
                    event.ip_address,
                    event.trace_id,
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

    async def query(
        self,
        action: str = "",
        actor: str = "",
        role: str = "",
        start_time: datetime | None = None,
        end_time: datetime | None = None,
        limit: int = 100,
    ) -> list[AuditEvent]:
        await self._flush_buffer()
        if self._db is None:
            return []
        conditions = []
        params = []
        if action:
            conditions.append("action = ?")
            params.append(action)
        if actor:
            conditions.append("actor = ?")
            params.append(actor)
        if role:
            conditions.append("role = ?")
            params.append(role)
        if start_time:
            conditions.append("timestamp >= ?")
            params.append(start_time.isoformat())
        if end_time:
            conditions.append("timestamp <= ?")
            params.append(end_time.isoformat())
        where = " WHERE " + " AND ".join(conditions) if conditions else ""
        params.append(limit)
        cursor = await self._db.execute(
            f"SELECT timestamp, action, actor, role, resource_type, resource_id, detail, ip_address, trace_id FROM audit_log{where} ORDER BY id DESC LIMIT ?",
            params,
        )
        rows = await cursor.fetchall()
        return [self._row_to_event(row) for row in rows]

    async def close(self) -> None:
        await self._flush_buffer()
        if self._flush_task is not None:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
        if self._conn_manager is None and self._db is not None:
            await self._db.close()
        self._db = None

    def _row_to_event(self, row) -> AuditEvent:
        return AuditEvent(
            timestamp=datetime.fromisoformat(row["timestamp"]),
            action=row["action"],
            actor=row["actor"],
            role=row["role"],
            resource_type=row["resource_type"],
            resource_id=row["resource_id"],
            detail=row["detail"] or "",
            ip_address=row["ip_address"] or "",
            trace_id=row["trace_id"] or "",
        )
