from __future__ import annotations

import asyncio
import json
import logging
from typing import Any
from uuid import UUID, uuid4

from cabinet.core.memory.protocol import MemoryStore
from cabinet.models.primitives import MemoryItem, MemoryScope

logger = logging.getLogger(__name__)


class SharedWorkspace:
    def __init__(self, team_id: UUID, memory_store: MemoryStore):
        self._team_id = team_id
        self._memory_store = memory_store
        self._scratch: dict[str, Any] = {}
        self._lock = asyncio.Lock()

    @property
    def team_id(self) -> UUID:
        return self._team_id

    async def set(self, key: str, value: Any, scope: str = "scratch") -> None:
        async with self._lock:
            self._scratch[key] = value
        if scope == "team":
            await self._persist(key, value)

    async def get(self, key: str, default: Any = None) -> Any:
        async with self._lock:
            if key in self._scratch:
                return self._scratch[key]
        items = await self._memory_store.search(
            str(self._team_id), MemoryScope.LONG_TERM, limit=1,
        )
        for item in items:
            try:
                data = json.loads(item.content)
                if key in data:
                    return data[key]
            except (json.JSONDecodeError, TypeError):
                pass
        return default

    async def append(self, key: str, value: Any) -> None:
        async with self._lock:
            current = self._scratch.get(key, [])
            if not isinstance(current, list):
                current = [current]
            current.append(value)
            self._scratch[key] = current

    async def get_history(self, key: str, limit: int = 10) -> list[Any]:
        items = await self._memory_store.search(
            str(self._team_id), MemoryScope.LONG_TERM, limit=limit,
        )
        history = []
        for item in items:
            try:
                data = json.loads(item.content)
                if key in data:
                    history.append(data[key])
            except (json.JSONDecodeError, TypeError):
                pass
        return history

    async def snapshot(self) -> dict:
        async with self._lock:
            return dict(self._scratch)

    async def clear_scratch(self) -> None:
        async with self._lock:
            self._scratch.clear()

    async def _persist(self, key: str, value: Any) -> None:
        current = {}
        items = await self._memory_store.search(
            str(self._team_id), MemoryScope.LONG_TERM, limit=1,
        )
        if items:
            try:
                current = json.loads(items[0].content)
            except (json.JSONDecodeError, TypeError):
                pass
        current[key] = value
        await self._memory_store.store(
            f"workspace:{self._team_id}:{uuid4()}",
            MemoryItem(
                owner_id=self._team_id,
                content=json.dumps(current),
                scope=MemoryScope.LONG_TERM,
                metadata={"type": "workspace", "team_id": str(self._team_id)},
            ),
            MemoryScope.LONG_TERM,
        )
