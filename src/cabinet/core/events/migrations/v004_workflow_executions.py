from __future__ import annotations

import aiosqlite


class V004WorkflowExecutions:
    version = 4
    description = "add workflow_executions and dead_letter_queue tables"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS workflow_executions (
                id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                project_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'running',
                current_node_id TEXT,
                completed_nodes TEXT NOT NULL DEFAULT '[]',
                results TEXT NOT NULL DEFAULT '{}',
                gate_results TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL
            )
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id
            ON workflow_executions(workflow_id)
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_workflow_executions_status
            ON workflow_executions(status)
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS dead_letter_queue (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                source TEXT,
                payload TEXT NOT NULL,
                error TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                last_retry_at TEXT
            )
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_dead_letter_queue_event_type
            ON dead_letter_queue(event_type)
            """
        )

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP INDEX IF EXISTS idx_dead_letter_queue_event_type")
        await db.execute("DROP INDEX IF EXISTS idx_workflow_executions_status")
        await db.execute("DROP INDEX IF EXISTS idx_workflow_executions_workflow_id")
        await db.execute("DROP TABLE IF EXISTS dead_letter_queue")
        await db.execute("DROP TABLE IF EXISTS workflow_executions")
