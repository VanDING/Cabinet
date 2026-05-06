from __future__ import annotations

import asyncio
import logging

import aiosqlite

logger = logging.getLogger(__name__)


class SharedConnectionManager:
    def __init__(self, db_path: str):
        self._db_path = db_path
        self._conn: aiosqlite.Connection | None = None
        self._write_lock = asyncio.Lock()

    async def initialize(self) -> None:
        self._conn = await aiosqlite.connect(self._db_path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA synchronous=NORMAL")
        await self._conn.commit()
        logger.info("SharedConnectionManager initialized: %s", self._db_path)

    async def execute_write(self, sql: str, params: tuple = ()) -> None:
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        async with self._write_lock:
            await self._conn.execute(sql, params)
            await self._conn.commit()

    async def execute_writemany(self, sql: str, params_seq: list[tuple]) -> None:
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        async with self._write_lock:
            await self._conn.executemany(sql, params_seq)
            await self._conn.commit()

    async def execute_read(self, sql: str, params: tuple = ()) -> list:
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        cursor = await self._conn.execute(sql, params)
        return await cursor.fetchall()

    async def execute_read_one(self, sql: str, params: tuple = ()):
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        cursor = await self._conn.execute(sql, params)
        return await cursor.fetchone()

    @property
    def connection(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("ConnectionManager not initialized")
        return self._conn

    async def close(self) -> None:
        if self._conn:
            await self._conn.close()
            self._conn = None
            logger.info("SharedConnectionManager closed")
