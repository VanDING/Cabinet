from __future__ import annotations

import os
import tempfile

import pytest

from cabinet.core.events.migrations import MigrationRunner
from cabinet.core.events.migrations.v001_initial_schema import V001InitialSchema


@pytest.fixture
async def db_env():
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        runner = MigrationRunner(db_path, [V001InitialSchema()])
        await runner.initialize()
        await runner.run_pending()
        await runner.close()
        yield db_path


@pytest.mark.asyncio
async def test_event_store_append_and_retrieve_flow(db_env):
    from cabinet.core.events.sqlite_store import SqliteEventStore
    from cabinet.models.events import MessageEnvelope

    store = SqliteEventStore(db_env)
    await store.initialize()

    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "expand market"},
    )
    await store.append(env)

    await store._flush_buffer()
    result = await store.get(env.message_id)
    assert result is not None
    assert result.payload["proposal_text"] == "expand market"
    await store.close()


@pytest.mark.asyncio
async def test_event_causation_chain_flow(db_env):
    from cabinet.core.events.sqlite_store import SqliteEventStore
    from cabinet.models.events import MessageEnvelope

    store = SqliteEventStore(db_env)
    await store.initialize()

    env1 = MessageEnvelope(
        sender="room:meeting", recipients=["room:decision"],
        message_type="deliberation.proposal", payload={"p": 1},
    )
    await store.append(env1)

    env2 = MessageEnvelope(
        sender="room:decision", recipients=["room:office"],
        message_type="decision.response", payload={"d": 1},
        causation_id=env1.message_id,
    )
    await store.append(env2)

    await store._flush_buffer()
    chain = await store.get_causation_chain(env2.message_id)
    assert len(chain) == 2
    await store.close()
