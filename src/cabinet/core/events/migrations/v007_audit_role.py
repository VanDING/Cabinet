from __future__ import annotations

import aiosqlite


class V007AuditRole:
    version = 7
    description = "add role column to audit_log"

    async def up(self, db: aiosqlite.Connection) -> None:
        cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'")
        row = await cursor.fetchone()
        if row is None:
            return
        cursor = await db.execute("PRAGMA table_info(audit_log)")
        columns = await cursor.fetchall()
        for col in columns:
            if col[1] == "role":
                return
        await db.execute("ALTER TABLE audit_log ADD COLUMN role TEXT DEFAULT ''")

    async def down(self, db: aiosqlite.Connection) -> None:
        cursor = await db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'")
        row = await cursor.fetchone()
        if row is None:
            return
        await db.execute(
            "CREATE TABLE audit_log_backup AS SELECT id, timestamp, action, actor, resource_type, resource_id, detail, ip_address, trace_id FROM audit_log"
        )
        await db.execute("DROP TABLE audit_log")
        await db.execute(
            "ALTER TABLE audit_log_backup RENAME TO audit_log"
        )
