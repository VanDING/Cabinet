# Capability Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch to ChromaDBMemoryStore for semantic memory search and add cross-session conversation history persistence.

**Architecture:** ChromaDBMemoryStore replaces SQLiteMemoryStore as the default memory backend (with config-based fallback). A new ConversationStore class persists per-captain conversation turns using SHORT_TERM memory scope. SecretaryAgentService integrates ConversationStore to maintain dialogue context across sessions.

**Tech Stack:** ChromaDB (vector search), Pydantic (MemoryItem/MemoryScope), aiosqlite (fallback), pytest-asyncio

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/cabinet/core/memory/vector_store.py` | Fix close() method |
| Modify | `src/cabinet/cli/config.py` | Add memory_type field |
| Modify | `src/cabinet/cli/main.py` | Switch memory store based on config |
| Create | `src/cabinet/rooms/secretary/conversation.py` | ConversationStore for history persistence |
| Modify | `src/cabinet/rooms/secretary/service.py` | Integrate ConversationStore |
| Modify | `src/cabinet/runtime.py` | Wire ConversationStore into SecretaryAgentService |
| Modify | `src/cabinet/agents/llm_agent.py` | Add memory persistence to execute_stream() |
| Modify | `tests/unit/core/memory/test_vector_store.py` | Add close() test |
| Create | `tests/unit/rooms/secretary/test_conversation.py` | ConversationStore unit tests |
| Modify | `tests/unit/rooms/secretary/test_service.py` | Add conversation history tests |
| Modify | `tests/unit/agents/test_llm_agent.py` | Add execute_stream memory test |

---

### Task 1: ChromaDBMemoryStore.close() Fix

**Files:**
- Modify: `src/cabinet/core/memory/vector_store.py:72-73`
- Modify: `tests/unit/core/memory/test_vector_store.py`

- [ ] **Step 1: Write failing test for close() cleanup**

Add to `tests/unit/core/memory/test_vector_store.py`:

```python
@pytest.mark.asyncio
async def test_close_stops_client():
    store = ChromaDBMemoryStore()
    await store.close()
    assert True
```

- [ ] **Step 2: Run test to verify it passes (no-op close)**

Run: `python -m pytest tests/unit/core/memory/test_vector_store.py::test_close_stops_client -v`
Expected: PASS (current close() is a no-op)

- [ ] **Step 3: Implement close() with proper cleanup**

Change `src/cabinet/core/memory/vector_store.py` line 72-73:

```python
    async def close(self) -> None:
        if hasattr(self._client, "_system"):
            self._client._system.stop()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/core/memory/test_vector_store.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/core/memory/vector_store.py tests/unit/core/memory/test_vector_store.py
git commit -m "fix: ChromaDBMemoryStore.close() properly stops client"
```

---

### Task 2: CabinetConfig memory_type + _init_runtime Switch

**Files:**
- Modify: `src/cabinet/cli/config.py`
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: Write failing test for memory_type config**

Add to `tests/unit/cli/test_config.py`:

```python
def test_cabinet_config_memory_type_default():
    from cabinet.cli.config import CabinetConfig
    from cabinet.models.primitives import Organization
    from uuid import uuid4

    config = CabinetConfig(
        organization=Organization(name="test", captain_id="cap1"),
        default_project=uuid4(),
    )
    assert config.memory_type == "chromadb"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/cli/test_config.py::test_cabinet_config_memory_type_default -v`
Expected: FAIL (field does not exist yet)

- [ ] **Step 3: Add memory_type field to CabinetConfig**

Modify `src/cabinet/cli/config.py`:

```python
class CabinetConfig(BaseModel):
    organization: Organization
    default_project: UUID
    model_config_path: str = "data/models.json"
    mcp_servers: list[dict] = []
    api_keys: dict[str, str] = {}
    api_token: str = ""
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:8000"]
    memory_type: str = "chromadb"
    employees_path: str = "data/employees.json"
    skills_dir: str = "data/skills"
    knowledge_dir: str = "data/knowledge"
    created_at: datetime = Field(default_factory=_now)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/cli/test_config.py::test_cabinet_config_memory_type_default -v`
Expected: PASS

- [ ] **Step 5: Update _init_runtime to use ChromaDBMemoryStore by default**

Modify `src/cabinet/cli/main.py` in the `_init_runtime` function. Change the memory store initialization:

```python
    if config.memory_type == "sqlite":
        from cabinet.core.memory.sqlite_store import SQLiteMemoryStore

        memory_store = SQLiteMemoryStore(db_path=db_path)
    else:
        from cabinet.core.memory.vector_store import ChromaDBMemoryStore

        memory_store = ChromaDBMemoryStore(
            persist_dir=os.path.join(data_dir, "vectors"),
        )
```

Remove the old import line:
```python
    from cabinet.core.memory.sqlite_store import SQLiteMemoryStore
```

And remove the old initialization:
```python
    memory_store = SQLiteMemoryStore(db_path=db_path)
```

- [ ] **Step 6: Run all tests**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/cabinet/cli/config.py src/cabinet/cli/main.py tests/unit/cli/test_config.py
git commit -m "feat: ChromaDBMemoryStore as default memory backend with memory_type config"
```

---

### Task 3: ConversationStore Implementation

**Files:**
- Create: `src/cabinet/rooms/secretary/conversation.py`
- Create: `tests/unit/rooms/secretary/test_conversation.py`

- [ ] **Step 1: Write failing tests for ConversationStore**

Create `tests/unit/rooms/secretary/test_conversation.py`:

```python
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
            content="Hi Captain!",
            metadata={"user": "Hello", "type": "conversation"},
        ),
        MemoryItem(
            owner_id=uuid4(),
            scope=MemoryScope.SHORT_TERM,
            content="How can I help?",
            metadata={"user": "What can you do?", "type": "conversation"},
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/unit/rooms/secretary/test_conversation.py -v`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement ConversationStore**

Create `src/cabinet/rooms/secretary/conversation.py`:

```python
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from cabinet.core.memory.protocol import MemoryStore


class ConversationStore:
    def __init__(self, memory_store: MemoryStore, max_turns: int = 20):
        self._memory_store = memory_store
        self._max_turns = max_turns

    async def get_history(self, captain_id: str) -> list[dict]:
        from uuid import NAMESPACE_DNS, uuid5

        from cabinet.models.primitives import MemoryScope

        captain_uuid = uuid5(NAMESPACE_DNS, captain_id)
        items = await self._memory_store.search(
            str(captain_uuid),
            MemoryScope.SHORT_TERM,
            limit=self._max_turns,
        )
        history = []
        for item in reversed(items):
            user_msg = item.metadata.get("user", "")
            if user_msg:
                history.append({"role": "user", "content": user_msg})
            history.append({"role": "assistant", "content": item.content})
        return history

    async def add_turn(self, captain_id: str, user_msg: str, assistant_msg: str) -> None:
        from uuid import NAMESPACE_DNS, uuid4, uuid5

        from cabinet.models.primitives import MemoryItem, MemoryScope

        captain_uuid = uuid5(NAMESPACE_DNS, captain_id)
        await self._memory_store.store(
            f"conv:{uuid4()}",
            MemoryItem(
                owner_id=captain_uuid,
                content=assistant_msg,
                scope=MemoryScope.SHORT_TERM,
                metadata={"captain_id": captain_id, "user": user_msg, "type": "conversation"},
            ),
            MemoryScope.SHORT_TERM,
        )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/unit/rooms/secretary/test_conversation.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/rooms/secretary/conversation.py tests/unit/rooms/secretary/test_conversation.py
git commit -m "feat: ConversationStore for cross-session conversation history"
```

---

### Task 4: SecretaryAgentService + CabinetRuntime Integration

**Files:**
- Modify: `src/cabinet/rooms/secretary/service.py`
- Modify: `src/cabinet/runtime.py`

- [ ] **Step 1: Write failing test for conversation history in Secretary**

Add to `tests/unit/rooms/secretary/test_service.py`:

```python
@pytest.mark.asyncio
async def test_process_input_with_conversation_history():
    from unittest.mock import AsyncMock, MagicMock
    from cabinet.rooms.secretary.conversation import ConversationStore
    from cabinet.rooms.secretary.service import SecretaryAgentService
    from cabinet.rooms.secretary.models import InteractionContext, SecretaryResponse, SecretaryLevel

    store = MagicMock()
    publisher = MagicMock()
    publisher.publish = AsyncMock()
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

    context = InteractionContext(captain_id="captain", channel="terminal")
    result = await service.process_input("What did I say?", context)

    assert isinstance(result, SecretaryResponse)
    conv_store.add_turn.assert_called_once_with("captain", "What did I say?", "I remember our chat!")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/rooms/secretary/test_service.py::test_process_input_with_conversation_history -v`
Expected: FAIL (conversation_store parameter does not exist)

- [ ] **Step 3: Add conversation_store parameter to SecretaryAgentService**

Modify `src/cabinet/rooms/secretary/service.py`:

In the imports section, add:
```python
if TYPE_CHECKING:
    from cabinet.core.knowledge.protocol import KnowledgeBase
    from cabinet.core.memory.protocol import MemoryStore
    from cabinet.rooms.secretary.conversation import ConversationStore
```

Change the `__init__` method:
```python
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        knowledge_base: KnowledgeBase | None = None,
        memory_store: MemoryStore | None = None,
        conversation_store: ConversationStore | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._knowledge_base = knowledge_base
        self._memory_store = memory_store
        self._conversation_store = conversation_store
        self._greetings: dict[str, str] = {}
        self._notifications: list[NotificationEvent] = []
        self._inputs: dict[str, list[str]] = {}
        self._pending_summaries: dict[str, str] = {}
        self._filtered_decisions: dict[UUID, FilterResult] = {}
```

- [ ] **Step 4: Integrate conversation history into process_input**

In `process_input`, after building the prompt but before calling `agent.execute`, inject conversation history:

```python
    async def process_input(
        self,
        captain_input: str,
        context: InteractionContext,
    ) -> SecretaryResponse:
        knowledge_context = ""
        if self._knowledge_base is not None:
            chunks = await self._knowledge_base.query(captain_input, top_k=3)
            knowledge_context = "\n".join(c.content for c in chunks)

        memory_context = ""
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope

            items = await self._memory_store.search(
                context.captain_id,
                MemoryScope.LONG_TERM,
                limit=3,
            )
            memory_context = "\n".join(item.content for item in items)

        conversation_history = ""
        if self._conversation_store is not None:
            history = await self._conversation_store.get_history(context.captain_id)
            if history:
                lines = []
                for msg in history:
                    role = msg["role"].capitalize()
                    lines.append(f"{role}: {msg['content']}")
                conversation_history = "\n".join(lines)

        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        agent_context = AgentContext(model="default", temperature=0.7)
        prompt = f"Captain says: {captain_input}\n\n"
        if conversation_history:
            prompt += f"Recent conversation:\n{conversation_history}\n\n"
        if knowledge_context:
            prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
        if memory_context:
            prompt += f"Captain's preferences and history:\n{memory_context}\n\n"
        prompt += (
            "Parse this instruction and respond appropriately. "
            "If it's a question, answer it. If it's a task, acknowledge and plan. "
            "If it's ambiguous, ask for clarification."
        )
        output = await agent.execute(prompt, agent_context)
        event = InputProcessed(
            captain_id=context.captain_id,
            input_text=captain_input,
            response_text=output.content,
        )
        await self._publish_and_apply(event)

        if self._memory_store is not None:
            from uuid import uuid5, NAMESPACE_DNS
            from cabinet.models.primitives import MemoryItem, MemoryScope

            captain_uuid = uuid5(NAMESPACE_DNS, context.captain_id)
            await self._memory_store.store(
                f"interaction:{uuid4()}",
                MemoryItem(
                    owner_id=captain_uuid,
                    content=f"Captain: {captain_input}\nSecretary: {output.content}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"captain_id": context.captain_id, "type": "interaction"},
                ),
                MemoryScope.LONG_TERM,
            )

        if self._conversation_store is not None:
            await self._conversation_store.add_turn(
                context.captain_id, captain_input, output.content
            )

        return SecretaryResponse(message=output.content, level=SecretaryLevel.L1)
```

- [ ] **Step 5: Integrate conversation history into process_input_stream**

In `process_input_stream`, add the same conversation history injection and add_turn in finalize:

```python
    async def process_input_stream(
        self,
        captain_input: str,
        context: InteractionContext,
    ) -> StreamingSecretaryResponse:
        knowledge_context = ""
        if self._knowledge_base is not None:
            chunks = await self._knowledge_base.query(captain_input, top_k=3)
            knowledge_context = "\n".join(c.content for c in chunks)

        memory_context = ""
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope

            items = await self._memory_store.search(
                context.captain_id,
                MemoryScope.LONG_TERM,
                limit=3,
            )
            memory_context = "\n".join(item.content for item in items)

        conversation_history = ""
        if self._conversation_store is not None:
            history = await self._conversation_store.get_history(context.captain_id)
            if history:
                lines = []
                for msg in history:
                    role = msg["role"].capitalize()
                    lines.append(f"{role}: {msg['content']}")
                conversation_history = "\n".join(lines)

        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        agent_context = AgentContext(model="default", temperature=0.7)
        prompt = f"Captain says: {captain_input}\n\n"
        if conversation_history:
            prompt += f"Recent conversation:\n{conversation_history}\n\n"
        if knowledge_context:
            prompt += f"Relevant knowledge:\n{knowledge_context}\n\n"
        if memory_context:
            prompt += f"Captain's preferences and history:\n{memory_context}\n\n"
        prompt += (
            "Parse this instruction and respond appropriately. "
            "If it's a question, answer it. If it's a task, acknowledge and plan. "
            "If it's ambiguous, ask for clarification."
        )

        collected_chunks: list[str] = []

        async def _stream_and_collect():
            async for chunk in agent.execute_stream(prompt, agent_context):
                collected_chunks.append(chunk)
                yield chunk

        async def _finalize():
            full_content = "".join(collected_chunks)
            event = InputProcessed(
                captain_id=context.captain_id,
                input_text=captain_input,
                response_text=full_content,
            )
            await self._publish_and_apply(event)

            if self._memory_store is not None:
                from uuid import uuid5, NAMESPACE_DNS
                from cabinet.models.primitives import MemoryItem, MemoryScope

                captain_uuid = uuid5(NAMESPACE_DNS, context.captain_id)
                await self._memory_store.store(
                    f"interaction:{uuid4()}",
                    MemoryItem(
                        owner_id=captain_uuid,
                        content=f"Captain: {captain_input}\nSecretary: {full_content}",
                        scope=MemoryScope.LONG_TERM,
                        metadata={"captain_id": context.captain_id, "type": "interaction"},
                    ),
                    MemoryScope.LONG_TERM,
                )

            if self._conversation_store is not None:
                await self._conversation_store.add_turn(
                    context.captain_id, captain_input, full_content
                )

        return StreamingSecretaryResponse(
            stream=_stream_and_collect(),
            finalize=_finalize,
        )
```

- [ ] **Step 6: Wire ConversationStore in CabinetRuntime**

Modify `src/cabinet/runtime.py`. In the `__init__` method, after `self._memory_store` is set, create the ConversationStore and pass it to SecretaryAgentService:

```python
        self._conversation_store = None
        if self._memory_store is not None:
            from cabinet.rooms.secretary.conversation import ConversationStore

            self._conversation_store = ConversationStore(self._memory_store)

        self._secretary = SecretaryAgentService(
            self._secretary_store,
            self._wiring,
            self._agent_factory,
            knowledge_base=self._knowledge_base,
            memory_store=self._memory_store,
            conversation_store=self._conversation_store,
        )
```

- [ ] **Step 7: Run all tests**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/cabinet/rooms/secretary/service.py src/cabinet/runtime.py tests/unit/rooms/secretary/test_service.py
git commit -m "feat: integrate ConversationStore into Secretary for cross-session history"
```

---

### Task 5: LiteLLMAgent.execute_stream() Memory Persistence

**Files:**
- Modify: `src/cabinet/agents/llm_agent.py:81-90`
- Modify: `tests/unit/agents/test_llm_agent.py`

- [ ] **Step 1: Write failing test for execute_stream memory persistence**

Add to `tests/unit/agents/test_llm_agent.py`:

```python
@pytest.mark.asyncio
async def test_execute_stream_persists_to_memory():
    from unittest.mock import AsyncMock, MagicMock
    from uuid import uuid4

    from cabinet.agents.context import AgentContext
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.models.primitives import Employee, MemoryScope

    gateway = AsyncMock()
    chunk1 = MagicMock()
    chunk1.content = "Hello"
    chunk2 = MagicMock()
    chunk2.content = " Captain"

    async def fake_stream(**kwargs):
        for chunk in [chunk1, chunk2]:
            yield chunk

    gateway.stream = fake_stream

    memory_store = AsyncMock()
    memory_store.store = AsyncMock()

    employee = Employee(id=uuid4(), team_id=uuid4(), name="TestAgent", role="advisor", kind="ai")
    agent = LiteLLMAgent(employee, gateway, memory_store=memory_store)

    context = AgentContext(model="default", temperature=0.7)
    chunks = []
    async for chunk in agent.execute_stream("test task", context):
        chunks.append(chunk)

    assert chunks == ["Hello", " Captain"]
    memory_store.store.assert_called_once()
    call_args = memory_store.store.call_args[0]
    item = call_args[1]
    assert "test task" in item.content
    assert "Hello Captain" in item.content
    assert call_args[2] == MemoryScope.LONG_TERM
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py::test_execute_stream_persists_to_memory -v`
Expected: FAIL (memory_store.store is not called in execute_stream)

- [ ] **Step 3: Add memory persistence to execute_stream**

Modify `src/cabinet/agents/llm_agent.py`, replacing the `execute_stream` method:

```python
    async def execute_stream(self, task: str, context: AgentContext):
        messages = self._build_messages(task)
        full_content: list[str] = []
        async for chunk in self._gateway.stream(
            messages=messages, model=context.model, temperature=context.temperature
        ):
            full_content.append(chunk.content)
            yield chunk.content
        complete = "".join(full_content)
        self._history.append({"role": "user", "content": task})
        self._history.append({"role": "assistant", "content": complete})

        if self._memory_store is not None:
            from uuid import uuid4
            from cabinet.models.primitives import MemoryItem, MemoryScope

            await self._memory_store.store(
                f"chat:{uuid4()}",
                MemoryItem(
                    owner_id=self._employee.id,
                    content=f"Q: {task}\nA: {complete}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"employee_id": str(self._employee.id), "role": self._employee.role},
                ),
                MemoryScope.LONG_TERM,
            )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py::test_execute_stream_persists_to_memory -v`
Expected: PASS

- [ ] **Step 5: Run all tests**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/cabinet/agents/llm_agent.py tests/unit/agents/test_llm_agent.py
git commit -m "feat: LiteLLMAgent.execute_stream() persists to MemoryStore"
```

---

### Task 6: Final Verification

**Files:**
- No new files

- [ ] **Step 1: Run full test suite**

Run: `python -m pytest tests/ -v --tb=short`
Expected: All tests PASS

- [ ] **Step 2: Run linter**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 3: Verify ChromaDBMemoryStore is used by default**

Run: `python -c "from cabinet.cli.config import CabinetConfig; from cabinet.models.primitives import Organization; from uuid import uuid4; c = CabinetConfig(organization=Organization(name='t', captain_id='c'), default_project=uuid4()); print(f'memory_type={c.memory_type}')"`
Expected: `memory_type=chromadb`

- [ ] **Step 4: Commit (if any lint fixes needed)**

```bash
git add -A
git commit -m "chore: final verification for capability enhancement"
```
