from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

import aiosqlite

logger = logging.getLogger(__name__)


@runtime_checkable
class Migration(Protocol):
    version: int
    description: str

    async def up(self, db: aiosqlite.Connection) -> None: ...

    async def down(self, db: aiosqlite.Connection) -> None: ...


class MigrationRunner:
    def __init__(self, db_path: str, migrations: list[Migration] | None = None):
        self._db_path = db_path
        self._migrations = sorted(migrations or [], key=lambda m: m.version)
        self._db: aiosqlite.Connection | None = None

    async def initialize(self) -> None:
        self._db = await aiosqlite.connect(self._db_path)
        await self._db.execute("PRAGMA journal_mode=WAL")
        await self._db.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL,
                description TEXT NOT NULL
            )
            """
        )
        await self._db.commit()

    async def current_version(self) -> int:
        cursor = await self._db.execute("SELECT MAX(version) FROM schema_version")
        row = await cursor.fetchone()
        return row[0] if row[0] is not None else 0

    async def pending_migrations(self) -> list[Migration]:
        current = await self.current_version()
        return [m for m in self._migrations if m.version > current]

    async def run_pending(self) -> None:
        current = await self.current_version()
        pending = [m for m in self._migrations if m.version > current]
        if not pending:
            logger.info("No pending migrations (current version: %d)", current)
            return
        for migration in pending:
            logger.info("Applying migration v%03d: %s", migration.version, migration.description)
            await self._db.execute("BEGIN")
            try:
                await migration.up(self._db)
                await self._db.execute(
                    "INSERT INTO schema_version (version, applied_at, description) VALUES (?, ?, ?)",
                    (migration.version, datetime.now(timezone.utc).isoformat(), migration.description),
                )
                await self._db.commit()
                logger.info("Migration v%03d applied successfully", migration.version)
            except Exception:
                await self._db.rollback()
                logger.error("Migration v%03d failed, rolled back", migration.version)
                raise
        logger.info("All pending migrations applied (version: %d -> %d)", current, pending[-1].version)

    async def rollback_to(self, target_version: int) -> None:
        current = await self.current_version()
        if target_version >= current:
            logger.info("No rollback needed (current: %d, target: %d)", current, target_version)
            return
        to_rollback = [m for m in reversed(self._migrations) if target_version < m.version <= current]
        for migration in to_rollback:
            logger.info("Rolling back migration v%03d: %s", migration.version, migration.description)
            await self._db.execute("BEGIN")
            try:
                await migration.down(self._db)
                await self._db.execute(
                    "DELETE FROM schema_version WHERE version = ?",
                    (migration.version,),
                )
                await self._db.commit()
                logger.info("Migration v%03d rolled back", migration.version)
            except Exception:
                await self._db.rollback()
                logger.error("Rollback v%03d failed", migration.version)
                raise

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None
