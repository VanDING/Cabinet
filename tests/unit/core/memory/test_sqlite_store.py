import tempfile
import uuid

import pytest

from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
from cabinet.core.events.migrations.v003_memory_fts import V003MemoryFts
from cabinet.core.memory.protocol import MemoryStore
from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
from cabinet.models.primitives import MemoryItem, MemoryScope


@pytest.fixture
async def store():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = f"{tmpdir}/test.db"
        runner = MigrationRunner(db_path, [V001InitialSchema()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()
        s = SQLiteMemoryStore(db_path=db_path)
        await s.initialize()
        yield s
        await s.close()


def test_store_satisfies_protocol(store):
    assert isinstance(store, MemoryStore)


@pytest.mark.asyncio
async def test_store_and_retrieve(store):
    item = MemoryItem(
        owner_id=uuid.uuid4(),
        scope=MemoryScope.SHORT_TERM,
        content="Test memory content",
    )
    await store.store("key-1", item, MemoryScope.SHORT_TERM)
    result = await store.retrieve("key-1", MemoryScope.SHORT_TERM)
    assert result is not None
    assert result.content == "Test memory content"


@pytest.mark.asyncio
async def test_retrieve_nonexistent(store):
    result = await store.retrieve("nonexistent", MemoryScope.SHORT_TERM)
    assert result is None


@pytest.mark.asyncio
async def test_delete(store):
    item = MemoryItem(
        owner_id=uuid.uuid4(),
        scope=MemoryScope.SHORT_TERM,
        content="To be deleted",
    )
    await store.store("key-del", item, MemoryScope.SHORT_TERM)
    await store.delete("key-del", MemoryScope.SHORT_TERM)
    result = await store.retrieve("key-del", MemoryScope.SHORT_TERM)
    assert result is None


@pytest.fixture
async def fts_store():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = f"{tmpdir}/test.db"
        runner = MigrationRunner(db_path, [V001InitialSchema(), V003MemoryFts()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()
        s = SQLiteMemoryStore(db_path=db_path)
        await s.initialize()
        yield s
        await s.close()


@pytest.mark.asyncio
async def test_fts_search(fts_store):
    owner_id = uuid.uuid4()
    item1 = MemoryItem(owner_id=owner_id, scope=MemoryScope.LONG_TERM, content="Python is a programming language")
    item2 = MemoryItem(owner_id=owner_id, scope=MemoryScope.LONG_TERM, content="Rust is a systems programming language")
    item3 = MemoryItem(owner_id=owner_id, scope=MemoryScope.LONG_TERM, content="The weather is nice today")

    await fts_store.store("key1", item1, MemoryScope.LONG_TERM)
    await fts_store.store("key2", item2, MemoryScope.LONG_TERM)
    await fts_store.store("key3", item3, MemoryScope.LONG_TERM)

    results = await fts_store.search("programming", MemoryScope.LONG_TERM, limit=5)
    assert len(results) >= 2
    contents = [r.content for r in results]
    assert any("Python" in c for c in contents)
    assert any("Rust" in c for c in contents)
