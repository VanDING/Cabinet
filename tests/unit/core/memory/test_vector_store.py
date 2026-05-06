import hashlib
import uuid

import pytest

from cabinet.core.memory.vector_store import ChromaDBMemoryStore
from cabinet.models.primitives import MemoryItem, MemoryScope


class FakeEmbeddingFunction:
    def _embed(self, input):
        result = []
        for text in input:
            h = hashlib.md5(text.encode()).hexdigest()
            vector = [float(int(h[i:i+2], 16)) / 255.0 for i in range(0, 32, 2)]
            vector += [0.0] * (384 - len(vector))
            result.append(vector)
        return result

    def __call__(self, input):
        return self._embed(input)

    def embed_query(self, input):
        return self._embed(input)

    def name(self):
        return "fake"

    def is_legacy(self):
        return True


@pytest.fixture
async def store():
    s = ChromaDBMemoryStore(embedding_function=FakeEmbeddingFunction())
    yield s


@pytest.mark.asyncio
async def test_store_and_retrieve_semantic(store):
    item = MemoryItem(
        owner_id=uuid.uuid4(),
        scope=MemoryScope.LONG_TERM,
        content="Cabinet is an AI collaboration framework for super-individuals",
    )
    await store.store("mem-1", item, MemoryScope.LONG_TERM)

    results = await store.search("AI framework", MemoryScope.LONG_TERM, limit=1)
    assert len(results) >= 1
    assert "Cabinet" in results[0].content


@pytest.mark.asyncio
async def test_scope_isolation_via_metadata(store):
    item_short = MemoryItem(
        owner_id=uuid.uuid4(),
        scope=MemoryScope.SHORT_TERM,
        content="Short term memory content",
    )
    item_long = MemoryItem(
        owner_id=uuid.uuid4(),
        scope=MemoryScope.LONG_TERM,
        content="Long term memory content about strategy",
    )
    await store.store("key-1", item_short, MemoryScope.SHORT_TERM)
    await store.store("key-2", item_long, MemoryScope.LONG_TERM)

    results = await store.search("strategy", MemoryScope.LONG_TERM, limit=5)
    assert all(r.scope == MemoryScope.LONG_TERM for r in results)


@pytest.mark.asyncio
async def test_delete(store):
    item = MemoryItem(
        owner_id=uuid.uuid4(),
        scope=MemoryScope.ENTITY,
        content="Captain prefers concise summaries",
    )
    await store.store("entity-1", item, MemoryScope.ENTITY)
    await store.delete("entity-1", MemoryScope.ENTITY)

    results = await store.search("Captain preferences", MemoryScope.ENTITY, limit=5)
    assert len(results) == 0


@pytest.mark.asyncio
async def test_chromadb_memory_store_has_initialize():
    store = ChromaDBMemoryStore(embedding_function=FakeEmbeddingFunction())
    assert hasattr(store, "initialize")
    await store.initialize()


@pytest.mark.asyncio
async def test_chromadb_memory_store_has_close():
    store = ChromaDBMemoryStore(embedding_function=FakeEmbeddingFunction())
    assert hasattr(store, "close")
    await store.close()


@pytest.mark.asyncio
async def test_close_stops_client():
    from unittest.mock import MagicMock

    store = ChromaDBMemoryStore.__new__(ChromaDBMemoryStore)
    mock_system = MagicMock()
    store._client = MagicMock()
    store._client._system = mock_system
    await store.close()
    mock_system.stop.assert_called_once()


@pytest.mark.asyncio
async def test_close_no_system_attribute():
    from unittest.mock import MagicMock

    store = ChromaDBMemoryStore.__new__(ChromaDBMemoryStore)
    store._client = MagicMock(spec=[])
    await store.close()
