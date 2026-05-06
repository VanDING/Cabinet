from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from cabinet.models.primitives import MemoryItem, MemoryScope


@pytest.fixture
def mock_memory_store():
    store = AsyncMock()
    store.store = AsyncMock()
    return store


@pytest.mark.asyncio
async def test_add_turn_stores_conversation(mock_memory_store):
    from cabinet.rooms.secretary.conversation import ConversationStore

    conv = ConversationStore(mock_memory_store)
    await conv.add_turn("captain", "Hello", "Hi Captain!")

    mock_memory_store.store.assert_called_once()
    args = mock_memory_store.store.call_args
    key = args[0][0]
    item = args[0][1]
    scope = args[0][2]
    assert key.startswith("conv:")
    assert item.content == "Hi Captain!"
    assert item.metadata["user"] == "Hello"
    assert item.metadata["type"] == "conversation"
    assert scope == MemoryScope.SHORT_TERM


@pytest.mark.asyncio
async def test_get_history_returns_conversation(mock_memory_store):
    from cabinet.rooms.secretary.conversation import ConversationStore

    items = [
        MemoryItem(
            owner_id=uuid4(),
            scope=MemoryScope.SHORT_TERM,
            content="How can I help?",
            metadata={"user": "What can you do?", "type": "conversation"},
        ),
        MemoryItem(
            owner_id=uuid4(),
            scope=MemoryScope.SHORT_TERM,
            content="Hi Captain!",
            metadata={"user": "Hello", "type": "conversation"},
        ),
    ]
    mock_memory_store.search = AsyncMock(return_value=items)

    conv = ConversationStore(mock_memory_store)
    history = await conv.get_history("captain")

    assert len(history) == 4
    assert history[0] == {"role": "user", "content": "Hello"}
    assert history[1] == {"role": "assistant", "content": "Hi Captain!"}
    assert history[2] == {"role": "user", "content": "What can you do?"}
    assert history[3] == {"role": "assistant", "content": "How can I help?"}


@pytest.mark.asyncio
async def test_get_history_empty(mock_memory_store):
    from cabinet.rooms.secretary.conversation import ConversationStore

    mock_memory_store.search = AsyncMock(return_value=[])

    conv = ConversationStore(mock_memory_store)
    history = await conv.get_history("captain")

    assert history == []


@pytest.mark.asyncio
async def test_get_history_skips_missing_user_msg(mock_memory_store):
    from cabinet.rooms.secretary.conversation import ConversationStore

    items = [
        MemoryItem(
            owner_id=uuid4(),
            scope=MemoryScope.SHORT_TERM,
            content="Response without user",
            metadata={"type": "conversation"},
        ),
    ]
    mock_memory_store.search = AsyncMock(return_value=items)

    conv = ConversationStore(mock_memory_store)
    history = await conv.get_history("captain")

    assert len(history) == 1
    assert history[0] == {"role": "assistant", "content": "Response without user"}
