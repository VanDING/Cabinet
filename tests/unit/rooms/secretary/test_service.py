import pytest
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.models.primitives import MemoryScope
from cabinet.models.decisions import Decision, DecisionType
from cabinet.rooms.secretary.models import (
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationEvent,
    NotificationResult,
    PendingSummary,
    SecretaryResponse,
)
from cabinet.rooms.secretary.service import SecretaryAgentService


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, object, object]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: object, causation_id: object = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def service(publisher):
    store = RoomEventStore("secretary")
    return SecretaryAgentService(store, publisher, StubAgentFactory())


@pytest.mark.asyncio
async def test_greet(service):
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)
    assert greeting.captain_id == "cap1"


@pytest.mark.asyncio
async def test_process_input(service):
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("what's pending?", context)
    assert isinstance(response, SecretaryResponse)


@pytest.mark.asyncio
async def test_summarize_pending(service):
    summary = await service.summarize_pending("cap1")
    assert isinstance(summary, PendingSummary)
    assert summary.captain_id == "cap1"


@pytest.mark.asyncio
async def test_notify(service, publisher):
    event = NotificationEvent(
        event_type="decision_made",
        severity="info",
        source="room:decision",
        content="Decision approved",
    )
    publisher.published.clear()
    result = await service.notify(event)
    assert isinstance(result, NotificationResult)
    assert result.delivered is True
    assert any(mt == "secretary.notification" for _, mt, _, _ in publisher.published)


@pytest.mark.asyncio
async def test_filter_decision(service):
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="small task",
        description="auto",
        captain_id="cap1",
    )
    result = await service.filter_decision(decision)
    assert isinstance(result, FilterResult)


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    await service.greet("cap1")
    new_service = SecretaryAgentService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert "cap1" in new_service._greetings


@pytest.mark.asyncio
async def test_process_input_tracks_history(service):
    context = InteractionContext(captain_id="cap1")
    await service.process_input("hello", context)
    await service.process_input("status?", context)
    assert "cap1" in service._inputs
    assert len(service._inputs["cap1"]) == 2


@pytest.mark.asyncio
async def test_summarize_pending_tracks_latest(service):
    await service.summarize_pending("cap1")
    assert "cap1" in service._pending_summaries


@pytest.mark.asyncio
async def test_filter_decision_tracks_result(service):
    decision = Decision(
        project_id=uuid4(),
        decision_type=DecisionType.EXECUTION,
        title="small task",
        description="auto",
        captain_id="cap1",
    )
    await service.filter_decision(decision)
    assert decision.id in service._filtered_decisions
    assert service._filtered_decisions[decision.id].auto_action == "auto_approve"


@pytest.mark.asyncio
async def test_restore_includes_input_history(service, publisher):
    context = InteractionContext(captain_id="cap1")
    await service.process_input("hello", context)
    new_service = SecretaryAgentService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert "cap1" in new_service._inputs
    assert len(new_service._inputs["cap1"]) == 1


@pytest.mark.asyncio
async def test_greet_with_knowledge_base(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.knowledge.protocol import KnowledgeBase

    kb = AsyncMock(spec=KnowledgeBase)
    kb.query = AsyncMock(return_value=[])
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), knowledge_base=kb)
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)


@pytest.mark.asyncio
async def test_process_input_queries_knowledge_base(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.knowledge.protocol import KnowledgeBase
    from cabinet.core.knowledge.protocol import DocumentChunk

    kb = AsyncMock(spec=KnowledgeBase)
    kb.query = AsyncMock(return_value=[
        DocumentChunk(content="Cabinet uses event sourcing", source="docs"),
    ])
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), knowledge_base=kb)
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("how does cabinet work?", context)
    assert isinstance(response, SecretaryResponse)
    kb.query.assert_called_once()


@pytest.mark.asyncio
async def test_process_input_without_knowledge_base(publisher):
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory())
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("hello", context)
    assert isinstance(response, SecretaryResponse)


@pytest.mark.asyncio
async def test_greet_with_memory_store(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[])
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), memory_store=ms)
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)


@pytest.mark.asyncio
async def test_greet_searches_memory_for_captain_preferences(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    from cabinet.models.primitives import MemoryItem, MemoryScope

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[
        MemoryItem(owner_id=uuid4(), scope=MemoryScope.LONG_TERM, content="Captain prefers concise summaries"),
    ])
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), memory_store=ms)
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)
    ms.search.assert_called_once()


@pytest.mark.asyncio
async def test_greet_without_memory_store(publisher):
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory())
    greeting = await service.greet("cap1")
    assert isinstance(greeting, Greeting)


@pytest.mark.asyncio
async def test_process_input_queries_memory_store(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore
    from cabinet.models.primitives import MemoryItem, MemoryScope

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[
        MemoryItem(owner_id=uuid4(), scope=MemoryScope.LONG_TERM, content="Captain prefers brief answers"),
    ])
    ms.store = AsyncMock()
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), memory_store=ms)
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("hello", context)
    assert isinstance(response, SecretaryResponse)
    ms.search.assert_called_once()


@pytest.mark.asyncio
async def test_process_input_stores_interaction_to_memory(publisher):
    from unittest.mock import AsyncMock
    from cabinet.core.memory.protocol import MemoryStore

    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[])
    ms.store = AsyncMock()
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory(), memory_store=ms)
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("what's the status?", context)
    assert isinstance(response, SecretaryResponse)
    ms.store.assert_called_once()
    call_args = ms.store.call_args
    stored_item = call_args[0][1]
    assert "what's the status?" in stored_item.content
    assert stored_item.scope == MemoryScope.LONG_TERM


@pytest.mark.asyncio
async def test_process_input_without_memory_store_still_works(publisher):
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory())
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input("hello", context)
    assert isinstance(response, SecretaryResponse)


@pytest.mark.asyncio
async def test_process_input_stream_returns_streaming_response(publisher):
    store = RoomEventStore("secretary")
    service = SecretaryAgentService(store, publisher, StubAgentFactory())
    context = InteractionContext(captain_id="cap1")
    response = await service.process_input_stream("hello", context)
    assert hasattr(response, "stream")
    assert hasattr(response, "finalize")


@pytest.mark.asyncio
async def test_process_input_with_conversation_history(publisher):
    from unittest.mock import AsyncMock, MagicMock

    from cabinet.rooms.secretary.conversation import ConversationStore

    store = RoomEventStore("secretary")
    agent_factory = AsyncMock()
    mock_agent = AsyncMock()
    mock_agent.execute = AsyncMock(return_value=MagicMock(content="I remember our chat!"))
    agent_factory.create_agent = AsyncMock(return_value=mock_agent)

    memory_store = AsyncMock()
    conv_store = ConversationStore(memory_store, max_turns=5)
    conv_store.get_history = AsyncMock(return_value=[
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi Captain!"},
    ])
    conv_store.add_turn = AsyncMock()

    service = SecretaryAgentService(
        store=store,
        publisher=publisher,
        agent_factory=agent_factory,
        conversation_store=conv_store,
    )

    context = InteractionContext(captain_id="captain")
    result = await service.process_input("What did I say?", context)

    assert isinstance(result, SecretaryResponse)
    conv_store.add_turn.assert_called_once_with("captain", "What did I say?", "I remember our chat!")


@pytest.mark.asyncio
async def test_process_input_stream_with_conversation_history(publisher):
    from unittest.mock import AsyncMock

    from cabinet.rooms.secretary.conversation import ConversationStore

    store = RoomEventStore("secretary")
    agent_factory = AsyncMock()
    mock_agent = AsyncMock()

    async def fake_stream(prompt, context):
        yield "I "
        yield "remember!"

    mock_agent.execute_stream = fake_stream
    agent_factory.create_agent = AsyncMock(return_value=mock_agent)

    memory_store = AsyncMock()
    conv_store = ConversationStore(memory_store, max_turns=5)
    conv_store.get_history = AsyncMock(return_value=[
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi Captain!"},
    ])
    conv_store.add_turn = AsyncMock()

    service = SecretaryAgentService(
        store=store,
        publisher=publisher,
        agent_factory=agent_factory,
        conversation_store=conv_store,
    )

    context = InteractionContext(captain_id="captain")
    response = await service.process_input_stream("What did I say?", context)
    chunks = []
    async for chunk in response.stream:
        chunks.append(chunk)
    await response.finalize()

    assert chunks == ["I ", "remember!"]
    conv_store.add_turn.assert_called_once_with("captain", "What did I say?", "I remember!")


@pytest.mark.asyncio
async def test_streaming_response_finalize_is_idempotent():
    from cabinet.rooms.secretary.service import StreamingSecretaryResponse

    call_count = 0

    async def mock_finalize():
        nonlocal call_count
        call_count += 1

    response = StreamingSecretaryResponse(stream=None, finalize=mock_finalize)
    await response.finalize()
    await response.finalize()
    assert call_count == 1


@pytest.mark.asyncio
async def test_streaming_response_context_manager():
    from cabinet.rooms.secretary.service import StreamingSecretaryResponse

    finalized = False

    async def mock_finalize():
        nonlocal finalized
        finalized = True

    response = StreamingSecretaryResponse(stream=None, finalize=mock_finalize)
    async with response:
        pass
    assert finalized


@pytest.mark.asyncio
async def test_streaming_response_finalize_swallows_errors():
    from cabinet.rooms.secretary.service import StreamingSecretaryResponse

    async def failing_finalize():
        raise RuntimeError("storage error")

    response = StreamingSecretaryResponse(stream=None, finalize=failing_finalize)
    await response.finalize()
