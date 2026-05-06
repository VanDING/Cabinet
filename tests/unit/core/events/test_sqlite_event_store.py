import pytest
import pytest_asyncio
from uuid import uuid4

from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema
from cabinet.core.events.sqlite_store import SqliteEventStore
from cabinet.models.events import MessageEnvelope


@pytest_asyncio.fixture
async def store(tmp_path):
    db_path = str(tmp_path / "test.db")
    runner = MigrationRunner(db_path, [V001InitialSchema()])
    await runner.initialize()
    await runner.run_pending()
    await runner.close()
    s = SqliteEventStore(db_path)
    await s.initialize()
    yield s
    await s.close()


@pytest.mark.asyncio
async def test_sqlite_store_append_and_get(store):
    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "expand"},
    )
    await store.append(env)
    result = await store.get(env.message_id)
    assert result is not None
    assert result.message_id == env.message_id
    assert result.message_type == "deliberation.proposal"
    assert result.payload == {"proposal_text": "expand"}


@pytest.mark.asyncio
async def test_sqlite_store_get_returns_none_for_missing(store):
    result = await store.get(uuid4())
    assert result is None


@pytest.mark.asyncio
async def test_sqlite_store_get_by_type(store):
    env1 = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "a"},
    )
    env2 = MessageEnvelope(
        sender="room:decision",
        recipients=["room:office"],
        message_type="decision.response",
        payload={"action": "approve"},
    )
    await store.append(env1)
    await store.append(env2)
    proposals = await store.get_by_type("deliberation.proposal")
    assert len(proposals) == 1
    assert proposals[0].message_id == env1.message_id


@pytest.mark.asyncio
async def test_sqlite_store_causation_chain(store):
    env1 = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal": "expand"},
    )
    await store.append(env1)
    env2 = MessageEnvelope(
        sender="room:decision",
        recipients=["room:office"],
        message_type="task.order",
        payload={"task": "research"},
        causation_id=env1.message_id,
    )
    await store.append(env2)
    chain = await store.get_causation_chain(env2.message_id)
    assert len(chain) == 2
    assert chain[0].message_id == env1.message_id
    assert chain[1].message_id == env2.message_id


@pytest.mark.asyncio
async def test_sqlite_store_persists_across_reopen(tmp_path):
    db_path = str(tmp_path / "persist.db")
    runner = MigrationRunner(db_path, [V001InitialSchema()])
    await runner.initialize()
    await runner.run_pending()
    await runner.close()
    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "persist test"},
    )
    store1 = SqliteEventStore(db_path)
    await store1.initialize()
    await store1.append(env)
    await store1.close()

    store2 = SqliteEventStore(db_path)
    await store2.initialize()
    result = await store2.get(env.message_id)
    await store2.close()
    assert result is not None
    assert result.payload == {"proposal_text": "persist test"}
