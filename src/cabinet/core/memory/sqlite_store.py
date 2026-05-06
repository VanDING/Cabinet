from __future__ import annotations

import json
import logging
import time
from uuid import UUID

import aiosqlite

from cabinet.models.primitives import MemoryItem, MemoryScope


logger = logging.getLogger(__name__)

try:
    from cabinet.core.observability import DB_OPERATION_LATENCY

    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False


class SQLiteMemoryStore:
    def __init__(self, db_path: str = "data/db/cabinet.db", conn_manager: object | None = None):
        self._db_path = db_path
        self._conn_manager = conn_manager
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        if self._conn_manager is not None:
            self._db = self._conn_manager.connection
        else:
            self._db = await aiosqlite.connect(self._db_path)
            await self._db.commit()
        logger.info("SQLiteMemoryStore initialized: db_path=%s", self._db_path)

    async def store(self, key: str, value: MemoryItem, scope: MemoryScope) -> None:
        start = time.monotonic()
        await self._db.execute(
            """
            INSERT OR REPLACE INTO memory (key, scope, owner_id, content, metadata, created_at, accessed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                key,
                scope.value,
                str(value.owner_id),
                value.content,
                json.dumps(value.metadata),
                value.created_at.isoformat(),
                value.accessed_at.isoformat() if value.accessed_at else None,
            ),
        )
        await self._db.commit()
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store="sqlite_memory", operation="store").observe(
                time.monotonic() - start
            )

    async def retrieve(self, key: str, scope: MemoryScope) -> MemoryItem | None:
        cursor = await self._db.execute(
            "SELECT owner_id, content, metadata, created_at, accessed_at FROM memory WHERE key = ? AND scope = ?",
            (key, scope.value),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        return MemoryItem(
            owner_id=UUID(row[0]),
            scope=scope,
            content=row[1],
            metadata=json.loads(row[2]),
        )

    async def search(self, query: str, scope: MemoryScope, limit: int = 5) -> list[MemoryItem]:
        start = time.monotonic()
        try:
            cursor = await self._db.execute(
                """
                SELECT m.owner_id, m.content, m.metadata
                FROM memory_fts fts
                JOIN memory m ON fts.rowid = m.rowid
                WHERE memory_fts MATCH ? AND m.scope = ?
                LIMIT ?
                """,
                (self._fts_escape(query), scope.value, limit),
            )
            rows = await cursor.fetchall()
        except Exception:
            cursor = await self._db.execute(
                "SELECT owner_id, content, metadata FROM memory WHERE scope = ? AND content LIKE ? LIMIT ?",
                (scope.value, f"%{query}%", limit),
            )
            rows = await cursor.fetchall()
        results = [
            MemoryItem(
                owner_id=UUID(row[0]),
                scope=scope,
                content=row[1],
                metadata=json.loads(row[2]),
            )
            for row in rows
        ]
        if _OBSERVABILITY_ENABLED:
            DB_OPERATION_LATENCY.labels(store="sqlite_memory", operation="search").observe(
                time.monotonic() - start
            )
        return results

    @staticmethod
    def _fts_escape(query: str) -> str:
        escaped = query.replace('"', '""')
        return f'"{escaped}"'

    async def delete(self, key: str, scope: MemoryScope) -> None:
        await self._db.execute(
            "DELETE FROM memory WHERE key = ? AND scope = ?",
            (key, scope.value),
        )
        await self._db.commit()

    async def close(self) -> None:
        if self._conn_manager is None and self._db:
            await self._db.close()
        self._db = None
        logger.info("SQLiteMemoryStore closed")
