# Capability Enhancement Design

## Overview

Enhance Cabinet's core capabilities by switching to ChromaDBMemoryStore for semantic memory search and adding cross-session conversation history persistence.

## 1. ChromaDBMemoryStore Runtime Integration

### 1.1 Replace SQLiteMemoryStore with ChromaDBMemoryStore

**File**: `src/cabinet/cli/main.py` (`_init_runtime`)

**Current**:
```python
memory_store = SQLiteMemoryStore(db_path=db_path)
```

**Change**:
```python
memory_store = ChromaDBMemoryStore(
    persist_dir=os.path.join(data_dir, "vectors"),
)
```

### 1.2 CabinetConfig Extension

**File**: `src/cabinet/cli/config.py`

Add `memory_type` field:

```python
class CabinetConfig(BaseModel):
    ...
    memory_type: str = "chromadb"  # "chromadb" or "sqlite"
```

In `_init_runtime`, select memory store based on config:

```python
if config.memory_type == "sqlite":
    memory_store = SQLiteMemoryStore(db_path=db_path)
else:
    memory_store = ChromaDBMemoryStore(
        persist_dir=os.path.join(data_dir, "vectors"),
    )
```

### 1.3 ChromaDBMemoryStore.close() Fix

**File**: `src/cabinet/core/memory/vector_store.py`

**Current**:
```python
async def close(self) -> None:
    pass
```

**Change**:
```python
async def close(self) -> None:
    if hasattr(self._client, "_system"):
        self._client._system.stop()
```

## 2. Conversation History Persistence

### 2.1 ConversationStore

**New file**: `src/cabinet/rooms/secretary/conversation.py`

A per-captain conversation history store backed by MemoryStore. Uses `MemoryScope.SHORT_TERM` to distinguish conversation turns from long-term knowledge/preferences.

```python
class ConversationStore:
    def __init__(self, memory_store: MemoryStore, max_turns: int = 20):
        self._memory_store = memory_store
        self._max_turns = max_turns

    async def get_history(self, captain_id: str) -> list[dict]:
        """Load recent conversation turns for a captain."""
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
        """Persist a conversation turn."""
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

### 2.2 SecretaryAgentService Integration

**File**: `src/cabinet/rooms/secretary/service.py`

Add `ConversationStore` as optional parameter:

```python
class SecretaryAgentService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        knowledge_base: KnowledgeBase | None = None,
        memory_store: MemoryStore | None = None,
        conversation_store: ConversationStore | None = None,
    ):
```

In `process_input` and `process_input_stream`:
1. Load history from `conversation_store.get_history(captain_id)`
2. Inject history into agent prompt as context
3. After response, call `conversation_store.add_turn(captain_id, user_msg, response)`

### 2.3 CabinetRuntime Wiring

**File**: `src/cabinet/runtime.py`

Pass `conversation_store` to `SecretaryAgentService`:

```python
if memory_store is not None:
    from cabinet.rooms.secretary.conversation import ConversationStore
    conversation_store = ConversationStore(memory_store)
else:
    conversation_store = None

self._secretary = SecretaryAgentService(
    self._secretary_store,
    self._wiring,
    self._agent_factory,
    knowledge_base=self._knowledge_base,
    memory_store=self._memory_store,
    conversation_store=conversation_store,
)
```

### 2.4 LiteLLMAgent.execute_stream() Memory Persistence

**File**: `src/cabinet/agents/llm_agent.py`

Add memory store write in `execute_stream()`, matching the pattern in `execute()`:

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
