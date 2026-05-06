from __future__ import annotations

import aiosqlite


class V001InitialSchema:
    version = 1
    description = "initial schema: event_store, room_events, memory, audit_log"

    async def up(self, db: aiosqlite.Connection) -> None:
        tables = await self._existing_tables(db)
        if "event_store" not in tables:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS event_store (
                    message_id TEXT PRIMARY KEY,
                    correlation_id TEXT NOT NULL,
                    causation_id TEXT NOT NULL,
                    sender TEXT NOT NULL,
                    recipients TEXT NOT NULL,
                    message_type TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'active',
                    payload TEXT NOT NULL
                )
                """
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_event_store_type ON event_store(message_type)"
            )
        if "room_events" not in tables:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS room_events (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    room_name TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    event_data TEXT NOT NULL
                )
                """
            )
            await db.execute(
                "CREATE INDEX IF NOT EXISTS idx_room_events_room ON room_events(room_name)"
            )
        if "memory" not in tables:
            await db.execute(
                """
                CREATE TABLE IF NOT EXISTS memory (
                    key TEXT NOT NULL,
                    scope TEXT NOT NULL,
                    owner_id TEXT NOT NULL,
                    content TEXT NOT NULL,
                    metadata TEXT DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    accessed_at TEXT,
                    PRIMARY KEY (key, scope)
                )
                """
            )

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP TABLE IF EXISTS memory")
        await db.execute("DROP TABLE IF EXISTS room_events")
        await db.execute("DROP TABLE IF EXISTS event_store")

    async def _existing_tables(self, db: aiosqlite.Connection) -> set[str]:
        cursor = await db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        rows = await cursor.fetchall()
        return {row[0] for row in rows}
