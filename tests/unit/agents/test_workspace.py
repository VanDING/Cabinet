from __future__ import annotations

import pytest
from uuid import uuid4
from unittest.mock import AsyncMock

from cabinet.agents.workspace import SharedWorkspace
from cabinet.core.memory.protocol import MemoryStore


@pytest.fixture
def mock_memory_store():
    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[])
    ms.store = AsyncMock()
    return ms


@pytest.mark.asyncio
async def test_workspace_set_and_get(mock_memory_store):
    ws = SharedWorkspace(uuid4(), mock_memory_store)
    await ws.set("key1", "value1")
    result = await ws.get("key1")
    assert result == "value1"


@pytest.mark.asyncio
async def test_workspace_get_default(mock_memory_store):
    ws = SharedWorkspace(uuid4(), mock_memory_store)
    result = await ws.get("nonexistent", default="fallback")
    assert result == "fallback"


@pytest.mark.asyncio
async def test_workspace_append(mock_memory_store):
    ws = SharedWorkspace(uuid4(), mock_memory_store)
    await ws.append("items", "first")
    await ws.append("items", "second")
    result = await ws.get("items")
    assert result == ["first", "second"]


@pytest.mark.asyncio
async def test_workspace_snapshot(mock_memory_store):
    ws = SharedWorkspace(uuid4(), mock_memory_store)
    await ws.set("a", 1)
    await ws.set("b", "two")
    snap = await ws.snapshot()
    assert snap["a"] == 1
    assert snap["b"] == "two"


@pytest.mark.asyncio
async def test_workspace_clear_scratch(mock_memory_store):
    ws = SharedWorkspace(uuid4(), mock_memory_store)
    await ws.set("temp", "data", scope="scratch")
    await ws.clear_scratch()
    result = await ws.get("temp")
    assert result is None


@pytest.mark.asyncio
async def test_workspace_overwrite(mock_memory_store):
    ws = SharedWorkspace(uuid4(), mock_memory_store)
    await ws.set("key", "old")
    await ws.set("key", "new")
    result = await ws.get("key")
    assert result == "new"


@pytest.mark.asyncio
async def test_workspace_persist_team_scope(mock_memory_store):
    ws = SharedWorkspace(uuid4(), mock_memory_store)
    await ws.set("persisted", "data", scope="team")
    mock_memory_store.store.assert_called_once()
