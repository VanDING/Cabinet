from __future__ import annotations

import aiosqlite


class V005WorkflowVersions:
    version = 5
    description = "add workflow_versions table"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS workflow_versions (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                definition TEXT NOT NULL,
                checksum TEXT NOT NULL,
                created_at TEXT NOT NULL,
                UNIQUE(workflow_id, version)
            )
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_workflow_versions_workflow_id
            ON workflow_versions(workflow_id)
            """
        )

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP INDEX IF EXISTS idx_workflow_versions_workflow_id")
        await db.execute("DROP TABLE IF EXISTS workflow_versions")
