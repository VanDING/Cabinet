from __future__ import annotations

import aiosqlite


class V003MemoryFts:
    version = 3
    description = "add FTS5 full-text search for memory table"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
                key, content, metadata,
                content='memory',
                content_rowid='rowid'
            )
            """
        )
        await db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
                INSERT INTO memory_fts(rowid, key, content, metadata)
                VALUES (new.rowid, new.key, new.content, new.metadata);
            END
            """
        )
        await db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
                INSERT INTO memory_fts(memory_fts, rowid, key, content, metadata)
                VALUES ('delete', old.rowid, old.key, old.content, old.metadata);
            END
            """
        )
        await db.execute(
            """
            CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
                INSERT INTO memory_fts(memory_fts, rowid, key, content, metadata)
                VALUES ('delete', old.rowid, old.key, old.content, old.metadata);
                INSERT INTO memory_fts(rowid, key, content, metadata)
                VALUES (new.rowid, new.key, new.content, new.metadata);
            END
            """
        )
        await db.execute(
            "INSERT INTO memory_fts(rowid, key, content, metadata) SELECT rowid, key, content, metadata FROM memory"
        )

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP TRIGGER IF EXISTS memory_au")
        await db.execute("DROP TRIGGER IF EXISTS memory_ad")
        await db.execute("DROP TRIGGER IF EXISTS memory_ai")
        await db.execute("DROP TABLE IF EXISTS memory_fts")
