from __future__ import annotations

import aiosqlite


class V002AddIndexes:
    version = 2
    description = "add performance indexes to event_store, room_events, memory"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_correlation ON event_store(correlation_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_causation ON event_store(causation_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_timestamp ON event_store(timestamp)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_sender ON event_store(sender)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_room_events_room_seq ON room_events(room_name, seq)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_memory_owner ON memory(owner_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_memory_scope ON memory(scope)"
        )

    async def down(self, db: aiosqlite.Connection) -> None:
        for idx in [
            "idx_event_correlation",
            "idx_event_causation",
            "idx_event_timestamp",
            "idx_event_sender",
            "idx_room_events_room_seq",
            "idx_memory_owner",
            "idx_memory_scope",
        ]:
            await db.execute(f"DROP INDEX IF EXISTS {idx}")
