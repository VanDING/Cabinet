from __future__ import annotations

import aiosqlite


class V006AgentOrchestration:
    version = 6
    description = "add agent orchestration tables"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_mailbox (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                sender_id TEXT NOT NULL,
                recipient_id TEXT NOT NULL,
                msg_type TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                reply_to TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_agent_mailbox_recipient
            ON agent_mailbox(recipient_id, msg_type)
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_pool (
                agent_id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                state TEXT NOT NULL DEFAULT 'idle',
                current_task TEXT,
                created_at TEXT NOT NULL,
                last_active_at TEXT NOT NULL,
                total_tasks INTEGER NOT NULL DEFAULT 0,
                error_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_agent_pool_role_state
            ON agent_pool(role, state)
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS team_composition (
                id TEXT PRIMARY KEY,
                task TEXT NOT NULL,
                members TEXT NOT NULL,
                leader_id TEXT,
                strategy TEXT NOT NULL DEFAULT 'collaborative',
                created_at TEXT NOT NULL
            )
            """
        )
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_failure (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL,
                error_type TEXT NOT NULL,
                error_message TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
            """
        )
        await db.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_agent_failure_agent_id
            ON agent_failure(agent_id)
            """
        )

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP INDEX IF EXISTS idx_agent_failure_agent_id")
        await db.execute("DROP TABLE IF EXISTS agent_failure")
        await db.execute("DROP TABLE IF EXISTS team_composition")
        await db.execute("DROP INDEX IF EXISTS idx_agent_pool_role_state")
        await db.execute("DROP TABLE IF EXISTS agent_pool")
        await db.execute("DROP INDEX IF EXISTS idx_agent_mailbox_recipient")
        await db.execute("DROP TABLE IF EXISTS agent_mailbox")
