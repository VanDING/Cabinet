# 多智能体编排 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Cabinet 添加完整的多智能体编排能力——Agent 间通信、任务交接、共享记忆、工具调用、生命周期管理、动态组队、辩论协商，并打通现有系统的断链。

**Architecture:** 严格分层实施：L1 通信基础 → L2 工具调用 → L3 生命周期管理 → L4 集成打通

**Tech Stack:** Python 3.12+, Pydantic v2, asyncio, pytest-asyncio, aiosqlite, LiteLLM

---

## File Structure

### New Files

| File | Layer | Responsibility |
|------|-------|---------------|
| `src/cabinet/agents/mailbox.py` | L1 | AgentMessage, AgentMailbox, MailboxRouter |
| `src/cabinet/agents/handoff.py` | L1 | HandoffRequest, HandoffResponse, HandoffManager |
| `src/cabinet/agents/workspace.py` | L1 | SharedWorkspace |
| `src/cabinet/agents/dialogue.py` | L1 | DialogueOrchestrator |
| `src/cabinet/agents/tools.py` | L2 | ToolDefinition, ToolRegistryAdapter |
| `src/cabinet/agents/structured.py` | L2 | StructuredOutputParser |
| `src/cabinet/agents/capability.py` | L2 | CapabilityRegistry |
| `src/cabinet/agents/pool.py` | L3 | AgentPool, PooledAgent, PoolExhaustedError |
| `src/cabinet/agents/composer.py` | L3 | TeamComposer |
| `src/cabinet/agents/debate.py` | L3 | DebateProtocol |
| `src/cabinet/agents/recovery.py` | L3 | AgentRecovery |
| `src/cabinet/core/events/migrations/v006_multi_agent.py` | L4 | 数据库迁移 |
| `src/cabinet/api/routes/agents.py` | L4 | 多 Agent API 端点 |
| `tests/unit/agents/test_mailbox.py` | L1 | |
| `tests/unit/agents/test_handoff.py` | L1 | |
| `tests/unit/agents/test_workspace.py` | L1 | |
| `tests/unit/agents/test_dialogue.py` | L1 | |
| `tests/unit/agents/test_tools.py` | L2 | |
| `tests/unit/agents/test_structured.py` | L2 | |
| `tests/unit/agents/test_capability.py` | L2 | |
| `tests/unit/agents/test_pool.py` | L3 | |
| `tests/unit/agents/test_composer.py` | L3 | |
| `tests/unit/agents/test_debate.py` | L3 | |
| `tests/unit/agents/test_recovery.py` | L3 | |

### Modified Files

| File | Layer | Change |
|------|-------|--------|
| `src/cabinet/agents/context.py` | L1 | AgentOutput 增强字段 |
| `src/cabinet/agents/llm_agent.py` | L2 | function calling + structured output |
| `src/cabinet/agents/crewai_adapter/agent.py` | L4 | 工具注入 + reflect 实现 |
| `src/cabinet/agents/crewai_adapter/team.py` | L4 | 多 Task + process 选择 |
| `src/cabinet/core/workflow/engine.py` | L4 | _execute_skill 真正执行 |
| `src/cabinet/rooms/decision/service.py` | L4 | delegate 真正交接 |
| `src/cabinet/runtime.py` | L4 | 组装新组件 |
| `src/cabinet/cli/main.py` | L4 | 新 CLI 命令 |
| `src/cabinet/api/routes/__init__.py` | L4 | 注册新路由 |

---

## L1 通信基础层

### Task 1: AgentMessage + AgentMailbox + MailboxRouter

**Files:**
- Create: `src/cabinet/agents/mailbox.py`
- Create: `tests/unit/agents/test_mailbox.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_mailbox.py
from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.mailbox import AgentMessage, AgentMailbox, MailboxRouter


@pytest.mark.asyncio
async def test_agent_message_creation():
    sender = uuid4()
    recipient = uuid4()
    msg = AgentMessage(sender_id=sender, recipient_id=recipient, msg_type="notify", content="hello")
    assert msg.sender_id == sender
    assert msg.recipient_id == recipient
    assert msg.msg_type == "notify"
    assert msg.content == "hello"
    assert msg.reply_to is None
    assert msg.metadata == {}


@pytest.mark.asyncio
async def test_agent_message_with_reply_to():
    sender = uuid4()
    recipient = uuid4()
    original_id = uuid4()
    msg = AgentMessage(
        sender_id=sender, recipient_id=recipient, msg_type="response",
        content="reply", reply_to=original_id,
    )
    assert msg.reply_to == original_id


@pytest.mark.asyncio
async def test_mailbox_send_and_receive():
    router = MailboxRouter()
    agent_id = uuid4()
    other_id = uuid4()
    mailbox = AgentMailbox(agent_id)
    router.register(agent_id, mailbox)
    other_mailbox = AgentMailbox(other_id)
    router.register(other_id, other_mailbox)

    msg_id = await mailbox.send(other_id, "notify", "hello from agent")
    assert msg_id is not None

    received = await other_mailbox.receive(timeout=1.0)
    assert received is not None
    assert received.content == "hello from agent"
    assert received.sender_id == agent_id


@pytest.mark.asyncio
async def test_mailbox_receive_timeout():
    agent_id = uuid4()
    mailbox = AgentMailbox(agent_id)
    result = await mailbox.receive(timeout=0.1)
    assert result is None


@pytest.mark.asyncio
async def test_mailbox_broadcast():
    router = MailboxRouter()
    sender_id = uuid4()
    recipient_ids = [uuid4(), uuid4()]
    sender_mb = AgentMailbox(sender_id)
    router.register(sender_id, sender_mb)
    for rid in recipient_ids:
        router.register(rid, AgentMailbox(rid))

    await sender_mb.broadcast("notify", "announcement", recipient_ids)

    for rid in recipient_ids:
        mb = router.get_mailbox(rid)
        received = await mb.receive(timeout=1.0)
        assert received is not None
        assert received.content == "announcement"
        assert received.msg_type == "broadcast"


@pytest.mark.asyncio
async def test_mailbox_on_message_handler():
    agent_id = uuid4()
    mailbox = AgentMailbox(agent_id)
    received_messages = []

    def handler(msg: AgentMessage):
        received_messages.append(msg)

    mailbox.on_message("notify", handler)

    router = MailboxRouter()
    router.register(agent_id, mailbox)
    other_id = uuid4()
    other_mb = AgentMailbox(other_id)
    router.register(other_id, other_mb)

    await other_mb.send(agent_id, "notify", "test notification")
    import asyncio
    await asyncio.sleep(0.1)

    assert len(received_messages) == 1
    assert received_messages[0].content == "test notification"


@pytest.mark.asyncio
async def test_mailbox_router_unregister():
    router = MailboxRouter()
    agent_id = uuid4()
    mailbox = AgentMailbox(agent_id)
    router.register(agent_id, mailbox)
    assert router.get_mailbox(agent_id) is not None
    router.unregister(agent_id)
    assert router.get_mailbox(agent_id) is None


@pytest.mark.asyncio
async def test_mailbox_router_send_request():
    router = MailboxRouter()
    sender_id = uuid4()
    recipient_id = uuid4()
    sender_mb = AgentMailbox(sender_id)
    recipient_mb = AgentMailbox(recipient_id)
    router.register(sender_id, sender_mb)
    router.register(recipient_id, recipient_mb)

    async def auto_respond():
        msg = await recipient_mb.receive(timeout=2.0)
        if msg:
            await recipient_mb.send(sender_id, "response", f"re: {msg.content}", reply_to=msg.id)

    import asyncio
    task = asyncio.create_task(auto_respond())
    reply = await router.send_request(sender_id, recipient_id, "ping", timeout=2.0)
    assert reply is not None
    assert reply.content == "re: ping"
    assert reply.msg_type == "response"
    await task


@pytest.mark.asyncio
async def test_mailbox_router_send_request_timeout():
    router = MailboxRouter()
    sender_id = uuid4()
    recipient_id = uuid4()
    sender_mb = AgentMailbox(sender_id)
    recipient_mb = AgentMailbox(recipient_id)
    router.register(sender_id, sender_mb)
    router.register(recipient_id, recipient_mb)

    reply = await router.send_request(sender_id, recipient_id, "ping", timeout=0.2)
    assert reply is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_mailbox.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'cabinet.agents.mailbox'`

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/mailbox.py
from __future__ import annotations

import asyncio
import logging
from typing import Callable, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

MsgType = Literal["request", "response", "notify", "handoff", "broadcast"]


class AgentMessage(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    sender_id: UUID
    recipient_id: UUID
    msg_type: MsgType
    content: str
    metadata: dict = {}
    reply_to: UUID | None = None
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class AgentMailbox:
    def __init__(self, agent_id: UUID):
        self._agent_id = agent_id
        self._queue: asyncio.Queue[AgentMessage] = asyncio.Queue()
        self._subscribers: dict[str, list[Callable]] = {}
        self._router: MailboxRouter | None = None

    @property
    def agent_id(self) -> UUID:
        return self._agent_id

    def _set_router(self, router: MailboxRouter) -> None:
        self._router = router

    async def send(
        self, recipient_id: UUID, msg_type: MsgType, content: str, **metadata
    ) -> UUID:
        msg = AgentMessage(
            sender_id=self._agent_id,
            recipient_id=recipient_id,
            msg_type=msg_type,
            content=content,
            metadata=metadata,
        )
        if self._router is not None:
            await self._router.route(msg)
        return msg.id

    async def receive(self, timeout: float = 30.0) -> AgentMessage | None:
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    async def broadcast(
        self, msg_type: MsgType, content: str, agent_ids: list[UUID]
    ) -> None:
        for aid in agent_ids:
            msg = AgentMessage(
                sender_id=self._agent_id,
                recipient_id=aid,
                msg_type="broadcast",
                content=content,
            )
            if self._router is not None:
                await self._router.route(msg)

    def on_message(self, msg_type: str, handler: Callable) -> None:
        if msg_type not in self._subscribers:
            self._subscribers[msg_type] = []
        self._subscribers[msg_type].append(handler)

    async def _deliver(self, message: AgentMessage) -> None:
        await self._queue.put(message)
        handlers = self._subscribers.get(message.msg_type, [])
        for handler in handlers:
            try:
                handler(message)
            except Exception:
                logger.exception("Handler error for msg_type=%s", message.msg_type)


class MailboxRouter:
    def __init__(self):
        self._mailboxes: dict[UUID, AgentMailbox] = {}

    def register(self, agent_id: UUID, mailbox: AgentMailbox) -> None:
        self._mailboxes[agent_id] = mailbox
        mailbox._set_router(self)

    def unregister(self, agent_id: UUID) -> None:
        mb = self._mailboxes.pop(agent_id, None)
        if mb is not None:
            mb._set_router(None)

    def get_mailbox(self, agent_id: UUID) -> AgentMailbox | None:
        return self._mailboxes.get(agent_id)

    async def route(self, message: AgentMessage) -> None:
        recipient = self._mailboxes.get(message.recipient_id)
        if recipient is None:
            logger.warning("No mailbox for recipient %s", message.recipient_id)
            return
        await recipient._deliver(message)

    async def send_request(
        self,
        sender_id: UUID,
        recipient_id: UUID,
        content: str,
        timeout: float = 30.0,
    ) -> AgentMessage | None:
        msg = AgentMessage(
            sender_id=sender_id,
            recipient_id=recipient_id,
            msg_type="request",
            content=content,
        )
        await self.route(msg)
        sender_mb = self._mailboxes.get(sender_id)
        if sender_mb is None:
            return None
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                return None
            candidate = await sender_mb.receive(timeout=min(remaining, 0.5))
            if candidate is not None:
                if candidate.msg_type == "response" and candidate.reply_to == msg.id:
                    return candidate
                await sender_mb._queue.put(candidate)
                await asyncio.sleep(0.05)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_mailbox.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/mailbox.py tests/unit/agents/test_mailbox.py
git commit -m "feat(agents): add AgentMailbox and MailboxRouter for inter-agent messaging"
```

---

### Task 2: HandoffManager

**Files:**
- Create: `src/cabinet/agents/handoff.py`
- Create: `tests/unit/agents/test_handoff.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_handoff.py
from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.handoff import HandoffRequest, HandoffResponse, HandoffManager
from cabinet.agents.mailbox import AgentMailbox, MailboxRouter


@pytest.mark.asyncio
async def test_handoff_request_creation():
    req = HandoffRequest(
        from_agent_id=uuid4(), to_agent_id=uuid4(),
        task_description="Analyze financial data",
        context_snapshot={"decision_id": str(uuid4())},
        reason="expertise",
    )
    assert req.reason == "expertise"
    assert req.priority == "normal"


@pytest.mark.asyncio
async def test_handoff_request_with_priority():
    req = HandoffRequest(
        from_agent_id=uuid4(), to_agent_id=uuid4(),
        task_description="Urgent task", context_snapshot={},
        reason="escalation", priority="urgent",
    )
    assert req.priority == "urgent"


@pytest.mark.asyncio
async def test_handoff_manager_request_and_accept():
    router = MailboxRouter()
    from_id, to_id = uuid4(), uuid4()
    from_mb, to_mb = AgentMailbox(from_id), AgentMailbox(to_id)
    router.register(from_id, from_mb)
    router.register(to_id, to_mb)

    manager = HandoffManager(router)

    async def auto_accept():
        msg = await to_mb.receive(timeout=2.0)
        if msg and msg.msg_type == "handoff":
            from uuid import UUID
            req_id = UUID(msg.metadata.get("request_id"))
            await manager.accept_handoff(req_id, to_id)

    import asyncio
    task = asyncio.create_task(auto_accept())

    req = HandoffRequest(
        from_agent_id=from_id, to_agent_id=to_id,
        task_description="delegate analysis", context_snapshot={}, reason="delegation",
    )
    response = await manager.request_handoff(req)
    assert response.accepted is True
    await task


@pytest.mark.asyncio
async def test_handoff_manager_reject():
    router = MailboxRouter()
    from_id, to_id = uuid4(), uuid4()
    from_mb, to_mb = AgentMailbox(from_id), AgentMailbox(to_id)
    router.register(from_id, from_mb)
    router.register(to_id, to_mb)

    manager = HandoffManager(router)

    async def auto_reject():
        msg = await to_mb.receive(timeout=2.0)
        if msg and msg.msg_type == "handoff":
            from uuid import UUID
            req_id = UUID(msg.metadata.get("request_id"))
            await manager.reject_handoff(req_id, "Too busy")

    import asyncio
    task = asyncio.create_task(auto_reject())

    req = HandoffRequest(
        from_agent_id=from_id, to_agent_id=to_id,
        task_description="delegate", context_snapshot={}, reason="capacity",
    )
    response = await manager.request_handoff(req)
    assert response.accepted is False
    assert "Too busy" in response.message
    await task


@pytest.mark.asyncio
async def test_handoff_manager_get_pending():
    router = MailboxRouter()
    from_id, to_id, other_id = uuid4(), uuid4(), uuid4()
    for aid in [from_id, to_id, other_id]:
        router.register(aid, AgentMailbox(aid))

    manager = HandoffManager(router)
    req = HandoffRequest(
        from_agent_id=from_id, to_agent_id=to_id,
        task_description="task 1", context_snapshot={}, reason="expertise",
    )
    await manager.request_handoff(req, wait_for_response=False)

    pending = await manager.get_pending_handoffs(to_id)
    assert len(pending) == 1
    assert pending[0].task_description == "task 1"

    pending_other = await manager.get_pending_handoffs(other_id)
    assert len(pending_other) == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_handoff.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/handoff.py
from __future__ import annotations

import asyncio
import logging
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from cabinet.agents.mailbox import AgentMessage, MailboxRouter

logger = logging.getLogger(__name__)

HandoffReason = Literal["expertise", "capacity", "escalation", "delegation"]
HandoffPriority = Literal["low", "normal", "high", "urgent"]


class HandoffRequest(BaseModel):
    id: UUID = Field(default_factory=uuid4)
    from_agent_id: UUID
    to_agent_id: UUID
    task_description: str
    context_snapshot: dict
    reason: HandoffReason
    priority: HandoffPriority = "normal"
    deadline: str | None = None


class HandoffResponse(BaseModel):
    request_id: UUID
    accepted: bool
    message: str = ""
    estimated_completion: str | None = None


class HandoffManager:
    def __init__(self, mailbox_router: MailboxRouter):
        self._router = mailbox_router
        self._pending: dict[UUID, HandoffRequest] = {}
        self._resolved: dict[UUID, HandoffResponse] = {}
        self._waiters: dict[UUID, asyncio.Future[HandoffResponse]] = {}

    async def request_handoff(
        self, request: HandoffRequest, wait_for_response: bool = True
    ) -> HandoffResponse | None:
        self._pending[request.id] = request

        msg = AgentMessage(
            sender_id=request.from_agent_id,
            recipient_id=request.to_agent_id,
            msg_type="handoff",
            content=request.task_description,
            metadata={
                "request_id": str(request.id),
                "reason": request.reason,
                "priority": request.priority,
                "context_snapshot": request.context_snapshot,
            },
        )
        await self._router.route(msg)

        if not wait_for_response:
            return None

        if request.id in self._resolved:
            return self._resolved.pop(request.id)

        loop = asyncio.get_event_loop()
        future: asyncio.Future[HandoffResponse] = loop.create_future()
        self._waiters[request.id] = future

        try:
            return await asyncio.wait_for(future, timeout=30.0)
        except asyncio.TimeoutError:
            self._waiters.pop(request.id, None)
            return HandoffResponse(request_id=request.id, accepted=False, message="Handoff timed out")

    async def accept_handoff(self, request_id: UUID, agent_id: UUID) -> None:
        request = self._pending.pop(request_id, None)
        if request is None:
            return
        response = HandoffResponse(request_id=request_id, accepted=True, message="Accepted")
        self._resolved[request_id] = response
        waiter = self._waiters.pop(request_id, None)
        if waiter and not waiter.done():
            waiter.set_result(response)

        reply = AgentMessage(
            sender_id=agent_id,
            recipient_id=request.from_agent_id,
            msg_type="response",
            content=f"Handoff accepted: {request.task_description}",
            metadata={"request_id": str(request_id), "accepted": "true"},
            reply_to=request_id,
        )
        await self._router.route(reply)

    async def reject_handoff(self, request_id: UUID, reason: str) -> None:
        request = self._pending.pop(request_id, None)
        if request is None:
            return
        response = HandoffResponse(request_id=request_id, accepted=False, message=reason)
        self._resolved[request_id] = response
        waiter = self._waiters.pop(request_id, None)
        if waiter and not waiter.done():
            waiter.set_result(response)

    async def get_pending_handoffs(self, agent_id: UUID) -> list[HandoffRequest]:
        return [req for req in self._pending.values() if req.to_agent_id == agent_id]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_handoff.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/handoff.py tests/unit/agents/test_handoff.py
git commit -m "feat(agents): add HandoffManager for inter-agent task handoff"
```

---

### Task 3: SharedWorkspace

**Files:**
- Create: `src/cabinet/agents/workspace.py`
- Create: `tests/unit/agents/test_workspace.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_workspace.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_workspace.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/workspace.py
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_workspace.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/workspace.py tests/unit/agents/test_workspace.py
git commit -m "feat(agents): add SharedWorkspace for team-level shared context"
```

---

### Task 4: AgentOutput 增强

**Files:**
- Modify: `src/cabinet/agents/context.py`
- Modify: `tests/unit/agents/test_protocols.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/agents/test_protocols.py`:

```python
def test_agent_output_enhanced_fields():
    emp_id = uuid.uuid4()
    output = AgentOutput(content="Task completed", employee_id=emp_id)
    assert output.status == "completed"
    assert output.structured_data is None
    assert output.artifacts == []
    assert output.token_usage is None
    assert output.duration_ms is None


def test_agent_output_with_structured_data():
    emp_id = uuid.uuid4()
    output = AgentOutput(
        content="result", employee_id=emp_id,
        status="completed",
        structured_data={"key": "value"},
        token_usage={"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        duration_ms=150.5,
    )
    assert output.structured_data == {"key": "value"}
    assert output.token_usage["total_tokens"] == 30
    assert output.duration_ms == 150.5


def test_agent_output_backward_compatible():
    emp_id = uuid.uuid4()
    output = AgentOutput(content="hello", employee_id=emp_id)
    assert output.content == "hello"
    assert output.employee_id == emp_id
    assert output.status == "completed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_protocols.py::test_agent_output_enhanced_fields -v`
Expected: FAIL — `AttributeError`

- [ ] **Step 3: Modify `src/cabinet/agents/context.py`**

Replace the `AgentOutput` class with:

```python
class AgentOutput(BaseModel):
    content: str
    employee_id: UUID
    status: str = "completed"
    structured_data: dict | None = None
    artifacts: list[dict] = []
    token_usage: dict | None = None
    duration_ms: float | None = None
```

- [ ] **Step 4: Run all agent context-related tests**

Run: `python -m pytest tests/unit/agents/test_protocols.py tests/unit/agents/test_llm_agent.py tests/unit/agents/test_stub_factory.py tests/unit/agents/test_llm_factory.py -v`
Expected: All PASS (new fields have defaults, backward compatible)

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/context.py tests/unit/agents/test_protocols.py
git commit -m "feat(agents): enhance AgentOutput with status, structured_data, token_usage, duration_ms"
```

---

### Task 5: DialogueOrchestrator

**Files:**
- Create: `src/cabinet/agents/dialogue.py`
- Create: `tests/unit/agents/test_dialogue.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_dialogue.py
from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.dialogue import DialogueConfig, DialogueOrchestrator, DialogueResult, DialogueTurn
from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.agents.mailbox import MailboxRouter


class MockAgent:
    def __init__(self, employee_id: UUID, responses: list[str] | None = None):
        self._employee_id = employee_id
        self._responses = responses or ["I agree"]
        self._call_index = 0

    @property
    def employee(self):
        from cabinet.models.primitives import Employee
        return Employee(id=self._employee_id, team_id=uuid4(), name="mock", role="advisor", kind="ai")

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        content = self._responses[self._call_index % len(self._responses)]
        self._call_index += 1
        return AgentOutput(content=content, employee_id=self._employee_id)


@pytest.mark.asyncio
async def test_dialogue_round_robin():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["First perspective"]),
        p2: MockAgent(p2, responses=["Second perspective"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(participants=[p1, p2], mode="round_robin", max_rounds=1)
    result = await orchestrator.start_dialogue(config, "Test topic", {})
    assert isinstance(result, DialogueResult)
    assert len(result.turns) == 2
    assert result.total_rounds == 1


@pytest.mark.asyncio
async def test_dialogue_multiple_rounds():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["A1", "A2"]),
        p2: MockAgent(p2, responses=["B1", "B2"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(participants=[p1, p2], mode="round_robin", max_rounds=2)
    result = await orchestrator.start_dialogue(config, "Topic", {})
    assert result.total_rounds == 2
    assert len(result.turns) == 4


@pytest.mark.asyncio
async def test_dialogue_convergence():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["I agree with the proposal"]),
        p2: MockAgent(p2, responses=["I also agree with the proposal"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(
        participants=[p1, p2], mode="round_robin", max_rounds=3,
        convergence_check="consensus",
    )
    result = await orchestrator.start_dialogue(config, "Topic", {})
    assert result.converged is True


@pytest.mark.asyncio
async def test_dialogue_no_convergence():
    router = MailboxRouter()
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["I strongly oppose this"]),
        p2: MockAgent(p2, responses=["I strongly support this"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(
        participants=[p1, p2], mode="round_robin", max_rounds=2,
        convergence_check="consensus",
    )
    result = await orchestrator.start_dialogue(config, "Topic", {})
    assert result.converged is False


@pytest.mark.asyncio
async def test_dialogue_turn_order():
    router = MailboxRouter()
    p1, p2, p3 = uuid4(), uuid4(), uuid4()
    agents = {
        p1: MockAgent(p1, responses=["P1"]),
        p2: MockAgent(p2, responses=["P2"]),
        p3: MockAgent(p3, responses=["P3"]),
    }
    orchestrator = DialogueOrchestrator(agents=agents, mailbox_router=router)
    config = DialogueConfig(participants=[p1, p2, p3], mode="round_robin", max_rounds=1)
    result = await orchestrator.start_dialogue(config, "Topic", {})
    assert result.turns[0].agent_id == p1
    assert result.turns[1].agent_id == p2
    assert result.turns[2].agent_id == p3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_dialogue.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/dialogue.py
from __future__ import annotations

import logging
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.agents.mailbox import MailboxRouter

logger = logging.getLogger(__name__)

DialogueMode = Literal["round_robin", "moderator", "free_form"]


class DialogueTurn(BaseModel):
    agent_id: UUID
    content: str
    turn_number: int
    metadata: dict = {}


class DialogueConfig(BaseModel):
    participants: list[UUID]
    mode: DialogueMode = "round_robin"
    max_rounds: int = 5
    convergence_check: str | None = None
    moderator_id: UUID | None = None


class DialogueResult(BaseModel):
    topic: str
    turns: list[DialogueTurn]
    total_rounds: int
    converged: bool
    summary: str | None = None


class DialogueOrchestrator:
    def __init__(self, agents: dict[UUID, object], mailbox_router: MailboxRouter):
        self._agents = agents
        self._router = mailbox_router

    async def start_dialogue(
        self, config: DialogueConfig, topic: str, context: dict
    ) -> DialogueResult:
        all_turns: list[DialogueTurn] = []
        turn_counter = 0
        converged = False
        round_num = 0

        for round_num in range(1, config.max_rounds + 1):
            round_turns = await self._run_round(config, topic, context, round_num, turn_counter)
            all_turns.extend(round_turns)
            turn_counter += len(round_turns)

            if config.convergence_check and self._check_convergence(all_turns, config.convergence_check):
                converged = True
                break

        return DialogueResult(
            topic=topic, turns=all_turns,
            total_rounds=round_num if all_turns else 0,
            converged=converged,
        )

    async def _run_round(
        self, config: DialogueConfig, topic: str, context: dict,
        round_num: int, turn_offset: int,
    ) -> list[DialogueTurn]:
        turns = []
        if config.mode == "round_robin":
            for i, pid in enumerate(config.participants):
                agent = self._agents.get(pid)
                if agent is None:
                    continue
                prompt = f"Round {round_num}, speaker {i+1}/{len(config.participants)}. Topic: {topic}"
                if context:
                    prompt += f"\nContext: {context}"
                output = await agent.execute(prompt, AgentContext())
                turns.append(DialogueTurn(
                    agent_id=pid, content=output.content,
                    turn_number=turn_offset + i + 1,
                ))
        elif config.mode == "moderator" and config.moderator_id:
            moderator = self._agents.get(config.moderator_id)
            if moderator:
                prompt = f"As moderator, decide who should speak in round {round_num} on topic: {topic}"
                mod_output = await moderator.execute(prompt, AgentContext())
                for pid in config.participants:
                    if pid != config.moderator_id:
                        agent = self._agents.get(pid)
                        if agent:
                            p_output = await agent.execute(
                                f"Respond to discussion on: {topic}. Context: {mod_output.content}",
                                AgentContext(),
                            )
                            turns.append(DialogueTurn(
                                agent_id=pid, content=p_output.content,
                                turn_number=turn_offset + len(turns) + 1,
                            ))
        return turns

    def _check_convergence(self, turns: list[DialogueTurn], check_type: str) -> bool:
        if check_type == "consensus":
            if len(turns) < 2:
                return False
            disagree_kw = {"disagree", "oppose", "reject", "against", "object"}
            agree_kw = {"agree", "support", "consensus", "accept", "approve"}
            for turn in turns:
                lower = turn.content.lower()
                has_disagree = any(kw in lower for kw in disagree_kw)
                has_agree = any(kw in lower for kw in agree_kw)
                if has_disagree and not has_agree:
                    return False
            return True
        return False
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_dialogue.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/dialogue.py tests/unit/agents/test_dialogue.py
git commit -m "feat(agents): add DialogueOrchestrator for multi-agent dialogue"
```

---

## 🔍 L1 Checkpoint

```bash
python -m pytest tests/unit/agents/test_mailbox.py tests/unit/agents/test_handoff.py tests/unit/agents/test_workspace.py tests/unit/agents/test_protocols.py tests/unit/agents/test_dialogue.py -v
python -m pytest tests/unit/agents/ -v
```

- [ ] All L1 tests pass
- [ ] Existing agent tests still pass

---

## L2 工具调用 + 结构化输出层

### Task 6: ToolDefinition + ToolRegistryAdapter

**Files:**
- Create: `src/cabinet/agents/tools.py`
- Create: `tests/unit/agents/test_tools.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_tools.py
from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.tools import ToolDefinition, ToolRegistryAdapter
from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.models.primitives import SkillDefinition


def test_tool_definition_creation():
    td = ToolDefinition(
        name="search", description="Search the knowledge base",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
    )
    assert td.name == "search"
    assert td.source == "skill"


def test_tool_definition_to_openai_schema():
    td = ToolDefinition(
        name="search", description="Search",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
    )
    schema = td.to_openai_schema()
    assert schema["type"] == "function"
    assert schema["function"]["name"] == "search"
    assert "query" in schema["function"]["parameters"]["properties"]


@pytest.mark.asyncio
async def test_tool_registry_adapter_get_definitions():
    registry = LocalToolRegistry()
    skill = SkillDefinition(
        id=uuid4(), name="search", description="Search knowledge", kind="tool",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
    )
    await registry.register(skill)
    adapter = ToolRegistryAdapter(registry)
    defs = adapter.get_tool_definitions()
    assert len(defs) == 1
    assert defs[0].name == "search"


@pytest.mark.asyncio
async def test_tool_registry_adapter_filter_by_skill_ids():
    registry = LocalToolRegistry()
    s1 = SkillDefinition(id=uuid4(), name="search", description="Search", kind="tool")
    s2 = SkillDefinition(id=uuid4(), name="analyze", description="Analyze", kind="tool")
    await registry.register(s1)
    await registry.register(s2)
    adapter = ToolRegistryAdapter(registry)
    defs = adapter.get_tool_definitions(skill_ids=[s1.id])
    assert len(defs) == 1
    assert defs[0].name == "search"


@pytest.mark.asyncio
async def test_tool_registry_adapter_execute_tool():
    registry = LocalToolRegistry()
    skill = SkillDefinition(id=uuid4(), name="search", description="Search", kind="tool")
    await registry.register(skill)
    adapter = ToolRegistryAdapter(registry)
    result = await adapter.execute_tool("search", {"query": "test"})
    assert result is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_tools.py -v`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/tools.py
from __future__ import annotations

import logging
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel

from cabinet.core.tools.registry import LocalToolRegistry

logger = logging.getLogger(__name__)

ToolSource = Literal["skill", "mcp", "builtin"]


class ToolDefinition(BaseModel):
    name: str
    description: str
    input_schema: dict = {"type": "object", "properties": {}}
    output_schema: dict | None = None
    handler: str | None = None
    source: ToolSource = "skill"

    def to_openai_schema(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema,
            },
        }


class ToolRegistryAdapter:
    def __init__(self, tool_registry: LocalToolRegistry):
        self._registry = tool_registry

    def get_tool_definitions(self, skill_ids: list[UUID] | None = None) -> list[ToolDefinition]:
        skills = list(self._registry._skills.values())
        if skill_ids:
            skills = [s for s in skills if s.id in skill_ids]
        return [
            ToolDefinition(
                name=s.name, description=s.description,
                input_schema=s.input_schema or {"type": "object", "properties": {}},
                output_schema=s.output_schema, handler=str(s.id), source="skill",
            )
            for s in skills
        ]

    async def execute_tool(self, name: str, arguments: dict) -> Any:
        return await self._registry.execute(name, arguments)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_tools.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/tools.py tests/unit/agents/test_tools.py
git commit -m "feat(agents): add ToolDefinition and ToolRegistryAdapter for function calling"
```

---

### Task 7: StructuredOutputParser

**Files:**
- Create: `src/cabinet/agents/structured.py`
- Create: `tests/unit/agents/test_structured.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_structured.py
from __future__ import annotations

import pytest

from cabinet.agents.structured import StructuredOutputConfig, StructuredOutputParser


def test_parse_direct_json():
    parser = StructuredOutputParser()
    result = parser.parse('{"name": "test", "value": 42}', StructuredOutputConfig())
    assert result == {"name": "test", "value": 42}


def test_parse_json_in_code_block():
    parser = StructuredOutputParser()
    content = '```json\n{"name": "test", "value": 42}\n```'
    result = parser.parse(content, StructuredOutputConfig())
    assert result == {"name": "test", "value": 42}


def test_parse_json_without_language_tag():
    parser = StructuredOutputParser()
    content = '```\n{"name": "test"}\n```'
    result = parser.parse(content, StructuredOutputConfig())
    assert result == {"name": "test"}


def test_parse_embedded_json():
    parser = StructuredOutputParser()
    content = 'The result is {"name": "test", "value": 42} as shown'
    result = parser.parse(content, StructuredOutputConfig())
    assert result == {"name": "test", "value": 42}


def test_parse_fallback_to_raw_content():
    parser = StructuredOutputParser()
    result = parser.parse("Just plain text", StructuredOutputConfig())
    assert result == {"raw_content": "Just plain text"}


def test_validate_with_schema():
    parser = StructuredOutputParser()
    schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
    result = parser.validate({"name": "test"}, schema)
    assert result["name"] == "test"


def test_validate_missing_required():
    parser = StructuredOutputParser()
    schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
    result = parser.validate({"value": 42}, schema)
    assert "error" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_structured.py -v`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/structured.py
from __future__ import annotations

import json
import logging
import re
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class StructuredOutputConfig(BaseModel):
    schema_type: str = "json"
    schema_def: dict | None = None
    pydantic_model: str | None = None


class StructuredOutputParser:
    def parse(self, content: str, config: StructuredOutputConfig) -> dict:
        result = self._try_direct_json(content)
        if result is not None:
            return result
        result = self._try_code_block_json(content)
        if result is not None:
            return result
        result = self._try_embedded_json(content)
        if result is not None:
            return result
        return {"raw_content": content}

    def validate(self, data: dict, schema: dict) -> dict:
        try:
            import jsonschema
            jsonschema.validate(instance=data, schema=schema)
            return data
        except ImportError:
            required = schema.get("required", [])
            missing = [f for f in required if f not in data]
            if missing:
                return {"error": f"Missing required fields: {missing}", "data": data}
            return data
        except Exception as e:
            return {"error": str(e), "data": data}

    def _try_direct_json(self, content: str) -> dict | None:
        try:
            result = json.loads(content.strip())
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, TypeError):
            pass
        return None

    def _try_code_block_json(self, content: str) -> dict | None:
        pattern = r"```(?:json)?\s*\n?(.*?)\n?```"
        matches = re.findall(pattern, content, re.DOTALL)
        for match in matches:
            try:
                result = json.loads(match.strip())
                if isinstance(result, dict):
                    return result
            except (json.JSONDecodeError, TypeError):
                continue
        return None

    def _try_embedded_json(self, content: str) -> dict | None:
        pattern = r"\{[^{}]*\}"
        matches = re.finditer(pattern, content)
        for match in matches:
            try:
                result = json.loads(match.group())
                if isinstance(result, dict):
                    return result
            except (json.JSONDecodeError, TypeError):
                continue
        return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_structured.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/structured.py tests/unit/agents/test_structured.py
git commit -m "feat(agents): add StructuredOutputParser for LLM output parsing"
```

---

### Task 8: CapabilityRegistry

**Files:**
- Create: `src/cabinet/agents/capability.py`
- Create: `tests/unit/agents/test_capability.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_capability.py
from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.capability import AgentCapability, CapabilityRegistry
from cabinet.agents.employee_store import JsonEmployeeStore
from cabinet.core.tools.registry import LocalToolRegistry


@pytest.fixture
def registry(tmp_path):
    store = JsonEmployeeStore(path=str(tmp_path / "employees.json"))
    tool_reg = LocalToolRegistry()
    return CapabilityRegistry(employee_store=store, tool_registry=tool_reg)


@pytest.mark.asyncio
async def test_register_and_get_capability(registry, tmp_path):
    await registry._employee_store.initialize()
    agent_id = uuid4()
    cap = AgentCapability(agent_id=agent_id, role="advisor", skills=["analysis"])
    await registry.register(agent_id, cap)
    found = await registry.get_capability(agent_id)
    assert found is not None
    assert found.role == "advisor"


@pytest.mark.asyncio
async def test_get_capability_not_found(registry, tmp_path):
    await registry._employee_store.initialize()
    found = await registry.get_capability(uuid4())
    assert found is None


@pytest.mark.asyncio
async def test_discover_by_role(registry, tmp_path):
    await registry._employee_store.initialize()
    a1, a2, a3 = uuid4(), uuid4(), uuid4()
    await registry.register(a1, AgentCapability(agent_id=a1, role="advisor"))
    await registry.register(a2, AgentCapability(agent_id=a2, role="executor"))
    await registry.register(a3, AgentCapability(agent_id=a3, role="advisor"))
    results = await registry.discover(query="", role="advisor")
    assert len(results) == 2


@pytest.mark.asyncio
async def test_discover_by_skill(registry, tmp_path):
    await registry._employee_store.initialize()
    a1, a2 = uuid4(), uuid4()
    await registry.register(a1, AgentCapability(agent_id=a1, role="advisor", skills=["analysis"]))
    await registry.register(a2, AgentCapability(agent_id=a2, role="executor", skills=["coding"]))
    results = await registry.discover(query="", skill="analysis")
    assert len(results) == 1


@pytest.mark.asyncio
async def test_update_load(registry, tmp_path):
    await registry._employee_store.initialize()
    agent_id = uuid4()
    await registry.register(agent_id, AgentCapability(agent_id=agent_id, role="advisor"))
    await registry.update_load(agent_id, 1)
    cap = await registry.get_capability(agent_id)
    assert cap.current_load == 1
    await registry.update_load(agent_id, -1)
    cap = await registry.get_capability(agent_id)
    assert cap.current_load == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_capability.py -v`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/capability.py
from __future__ import annotations

import logging
from uuid import UUID

from pydantic import BaseModel

from cabinet.agents.employee_store import JsonEmployeeStore
from cabinet.core.tools.registry import LocalToolRegistry

logger = logging.getLogger(__name__)


class AgentCapability(BaseModel):
    agent_id: UUID
    role: str
    skills: list[str] = []
    specializations: list[str] = []
    max_concurrent_tasks: int = 1
    current_load: int = 0


class CapabilityRegistry:
    def __init__(self, employee_store: JsonEmployeeStore, tool_registry: LocalToolRegistry):
        self._employee_store = employee_store
        self._tool_registry = tool_registry
        self._capabilities: dict[UUID, AgentCapability] = {}

    async def register(self, agent_id: UUID, capability: AgentCapability) -> None:
        self._capabilities[agent_id] = capability

    async def discover(self, query: str = "", role: str | None = None, skill: str | None = None) -> list[AgentCapability]:
        results = list(self._capabilities.values())
        if role:
            results = [c for c in results if c.role == role]
        if skill:
            results = [c for c in results if skill in c.skills]
        if query:
            q = query.lower()
            results = [c for c in results if q in c.role.lower() or any(q in s.lower() for s in c.skills)]
        return results

    async def get_capability(self, agent_id: UUID) -> AgentCapability | None:
        return self._capabilities.get(agent_id)

    async def update_load(self, agent_id: UUID, delta: int) -> None:
        cap = self._capabilities.get(agent_id)
        if cap is None:
            return
        self._capabilities[agent_id] = cap.model_copy(
            update={"current_load": max(0, cap.current_load + delta)}
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_capability.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/capability.py tests/unit/agents/test_capability.py
git commit -m "feat(agents): add CapabilityRegistry for agent capability discovery"
```

---

### Task 9: LiteLLMAgent Function Calling 集成

**Files:**
- Modify: `src/cabinet/agents/llm_agent.py`
- Modify: `tests/unit/agents/test_llm_agent.py`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/agents/test_llm_agent.py`:

```python
@pytest.mark.asyncio
async def test_llm_agent_with_tools():
    from cabinet.agents.llm_agent import LiteLLMAgent
    from cabinet.agents.tools import ToolDefinition
    from unittest.mock import MagicMock

    class ToolCallGateway:
        def __init__(self):
            self.call_count = 0

        async def complete(self, messages, model, temperature=0.7, **kwargs):
            from cabinet.core.gateway.protocol import ModelResponse
            self.call_count += 1
            if self.call_count == 1:
                tc = MagicMock(id="tc_1")
                tc.function.name = "search"
                tc.function.arguments = '{"query": "test"}'
                return ModelResponse(content="", model=model, tool_calls=[tc])
            return ModelResponse(content="Search result: found 3 items", model=model)

        async def stream(self, messages, model, temperature=0.7, **kwargs):
            yield ModelChunk(content="result", model=model)

        def list_models(self):
            return []

    gateway = ToolCallGateway()
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    tools = [ToolDefinition(
        name="search", description="Search knowledge base",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
    )]
    agent = LiteLLMAgent(employee, gateway, tools=tools)
    output = await agent.execute("Search for test", AgentContext())
    assert output.content == "Search result: found 3 items"
    assert gateway.call_count == 2


@pytest.mark.asyncio
async def test_llm_agent_execute_structured():
    from cabinet.agents.llm_agent import LiteLLMAgent

    gateway = MockGateway(responses=['{"analysis": "positive", "confidence": 0.9}'])
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    agent = LiteLLMAgent(employee, gateway)
    output = await agent.execute_structured(
        "Analyze sentiment", AgentContext(),
        output_schema={"type": "object", "properties": {"analysis": {"type": "string"}}},
    )
    assert output.structured_data is not None
    assert output.structured_data.get("analysis") == "positive"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py::test_llm_agent_with_tools -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'tools'`

- [ ] **Step 3: Modify `src/cabinet/agents/llm_agent.py`**

Add imports at top:

```python
import json
import time

from cabinet.agents.structured import StructuredOutputConfig, StructuredOutputParser
from cabinet.agents.tools import ToolDefinition
```

Modify `__init__` to add `tools` and `tool_registry` parameters:

```python
    def __init__(
        self,
        employee: Employee,
        gateway: ModelGateway,
        system_prompt: str = "",
        memory_store: MemoryStore | None = None,
        max_history: int = 20,
        tools: list[ToolDefinition] | None = None,
        tool_registry: object | None = None,
    ):
        self._employee = employee
        self._gateway = gateway
        self._system_prompt = system_prompt or (
            f"You are a {employee.role}. {employee.personality or ''}"
        )
        self._memory_store = memory_store
        self._max_history = max_history
        self._history: list[dict] = []
        self._tools = tools or []
        self._tool_registry = tool_registry
        self._tool_schemas = self._build_tool_schemas()
        self._output_parser = StructuredOutputParser()
```

Add `_build_tool_schemas` method:

```python
    def _build_tool_schemas(self) -> list[dict]:
        return [t.to_openai_schema() for t in self._tools]
```

Modify `execute` to support tool calling — add after `messages = await self._build_messages(task)` and before the existing gateway call:

```python
        start = time.monotonic()

        if self._tool_schemas:
            return await self._execute_with_tools(task, context, messages, start)
```

Add `_execute_with_tools` method:

```python
    async def _execute_with_tools(
        self, task: str, context: AgentContext, messages: list[dict], start: float,
    ) -> AgentOutput:
        self._history.append({"role": "user", "content": task})

        for _ in range(10):
            kwargs = {
                "messages": messages, "model": context.model,
                "temperature": context.temperature,
            }
            if self._tool_schemas:
                kwargs["tools"] = self._tool_schemas
                kwargs["tool_choice"] = "auto"

            response = await self._gateway.complete(**kwargs)
            tool_calls = getattr(response, "tool_calls", None)

            if not tool_calls:
                elapsed = (time.monotonic() - start) * 1000
                self._history.append({"role": "assistant", "content": response.content})
                self._trim_history()
                return AgentOutput(
                    content=response.content, employee_id=self._employee.id,
                    duration_ms=elapsed,
                )

            assistant_msg = {"role": "assistant", "content": response.content or ""}
            assistant_msg["tool_calls"] = [
                {"id": tc.id, "type": "function",
                 "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                for tc in tool_calls
            ]
            messages.append(assistant_msg)

            for tool_call in tool_calls:
                result = await self._execute_tool_call(tool_call)
                messages.append({
                    "role": "tool", "tool_call_id": tool_call.id,
                    "content": json.dumps(result),
                })

        elapsed = (time.monotonic() - start) * 1000
        self._history.append({"role": "assistant", "content": "Max tool calls reached"})
        self._trim_history()
        return AgentOutput(
            content="Max tool calls reached", employee_id=self._employee.id,
            status="partial", duration_ms=elapsed,
        )

    async def _execute_tool_call(self, tool_call) -> dict:
        tool_name = tool_call.function.name
        try:
            tool_args = json.loads(tool_call.function.arguments)
        except (json.JSONDecodeError, TypeError):
            tool_args = {}

        if self._tool_registry is not None:
            try:
                from cabinet.agents.tools import ToolRegistryAdapter
                if isinstance(self._tool_registry, ToolRegistryAdapter):
                    result = await self._tool_registry.execute_tool(tool_name, tool_args)
                    return {"result": str(result), "status": "success"}
            except Exception as e:
                return {"error": str(e), "status": "error"}

        return {"result": f"Tool {tool_name} executed with {tool_args}", "status": "simulated"}
```

Add `execute_structured` method:

```python
    async def execute_structured(
        self, task: str, context: AgentContext, output_schema: dict,
    ) -> AgentOutput:
        messages = await self._build_messages(task)
        start = time.monotonic()

        kwargs = {
            "messages": messages, "model": context.model,
            "temperature": context.temperature,
            "response_format": {"type": "json_object"},
        }
        response = await self._gateway.complete(**kwargs)
        elapsed = (time.monotonic() - start) * 1000

        parsed = self._output_parser.parse(
            response.content, StructuredOutputConfig(schema_def=output_schema),
        )

        self._history.append({"role": "user", "content": task})
        self._history.append({"role": "assistant", "content": response.content})
        self._trim_history()

        return AgentOutput(
            content=response.content, employee_id=self._employee.id,
            structured_data=parsed, duration_ms=elapsed,
        )
```

Also update the existing `execute` method to add `start = time.monotonic()` and `duration_ms` to the return value.

- [ ] **Step 4: Run all agent tests**

Run: `python -m pytest tests/unit/agents/test_llm_agent.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/llm_agent.py tests/unit/agents/test_llm_agent.py
git commit -m "feat(agents): add function calling and structured output to LiteLLMAgent"
```

---

## 🔍 L2 Checkpoint

```bash
python -m pytest tests/unit/agents/ -v
```

- [ ] All agent tests pass
- [ ] Function calling integration works
- [ ] Backward compatibility maintained

---

## L3 生命周期 + 动态组队层

### Task 10: AgentPool

**Files:**
- Create: `src/cabinet/agents/pool.py`
- Create: `tests/unit/agents/test_pool.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_pool.py
from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.pool import AgentPool, AgentState, PooledAgent, PoolExhaustedError
from cabinet.agents.mailbox import AgentMailbox, MailboxRouter
from cabinet.agents.stub_factory import StubAgentFactory


@pytest.fixture
def pool():
    router = MailboxRouter()
    factory = StubAgentFactory()
    return AgentPool(factory=factory, mailbox_router=router, max_per_role=2)


@pytest.mark.asyncio
async def test_pool_acquire_creates_agent(pool):
    agent = await pool.acquire("advisor")
    assert isinstance(agent, PooledAgent)
    assert agent.state == AgentState.BUSY
    assert agent.employee.role == "advisor"


@pytest.mark.asyncio
async def test_pool_acquire_reuses_idle(pool):
    agent1 = await pool.acquire("advisor")
    await pool.release(agent1.agent_id)
    agent2 = await pool.acquire("advisor")
    assert agent2.agent_id == agent1.agent_id


@pytest.mark.asyncio
async def test_pool_release_sets_idle(pool):
    agent = await pool.acquire("advisor")
    assert agent.state == AgentState.BUSY
    await pool.release(agent.agent_id)
    state = await pool.get_state(agent.agent_id)
    assert state == AgentState.IDLE


@pytest.mark.asyncio
async def test_pool_list_by_role(pool):
    await pool.acquire("advisor")
    await pool.acquire("executor")
    advisors = await pool.list_by_role("advisor")
    assert len(advisors) == 1


@pytest.mark.asyncio
async def test_pool_list_idle(pool):
    agent = await pool.acquire("advisor")
    idle = await pool.list_idle()
    assert len(idle) == 0
    await pool.release(agent.agent_id)
    idle = await pool.list_idle()
    assert len(idle) == 1


@pytest.mark.asyncio
async def test_pool_max_per_role_exhausted(pool):
    await pool.acquire("advisor")
    await pool.acquire("advisor")
    with pytest.raises(PoolExhaustedError):
        await pool.acquire("advisor", timeout=0.2)


@pytest.mark.asyncio
async def test_pool_terminate(pool):
    agent = await pool.acquire("advisor")
    await pool.terminate(agent.agent_id)
    state = await pool.get_state(agent.agent_id)
    assert state == AgentState.TERMINATED


@pytest.mark.asyncio
async def test_pool_health_check(pool):
    await pool.acquire("advisor")
    health = await pool.health_check()
    assert health["total"] == 1
    assert health["by_state"]["busy"] == 1


@pytest.mark.asyncio
async def test_pool_get_mailbox(pool):
    agent = await pool.acquire("advisor")
    mb = pool.get_mailbox(agent.agent_id)
    assert isinstance(mb, AgentMailbox)
    assert mb.agent_id == agent.agent_id
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_pool.py -v`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/pool.py
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from cabinet.agents.mailbox import AgentMailbox, MailboxRouter
from cabinet.agents.protocol import AgentFactory
from cabinet.models.primitives import Employee

logger = logging.getLogger(__name__)


class AgentState(str, Enum):
    IDLE = "idle"
    BUSY = "busy"
    WAITING = "waiting"
    ERROR = "error"
    TERMINATED = "terminated"


class PooledAgent(BaseModel):
    agent_id: UUID
    employee: Employee
    state: AgentState = AgentState.IDLE
    current_task: str | None = None
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    last_active_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    total_tasks: int = 0
    error_count: int = 0


class PoolExhaustedError(Exception):
    pass


class AgentPool:
    def __init__(
        self,
        factory: AgentFactory,
        mailbox_router: MailboxRouter,
        max_per_role: int = 3,
    ):
        self._factory = factory
        self._router = mailbox_router
        self._max_per_role = max_per_role
        self._pool: dict[UUID, PooledAgent] = {}
        self._role_index: dict[str, list[UUID]] = {}
        self._mailboxes: dict[UUID, AgentMailbox] = {}
        self._release_events: dict[str, asyncio.Event] = {}

    async def acquire(
        self, role: str, employee_id: UUID | None = None, timeout: float = 30.0,
    ) -> PooledAgent:
        idle_agents = [
            a for a in self._pool.values()
            if a.employee.role == role and a.state == AgentState.IDLE
        ]
        if idle_agents:
            agent = idle_agents[0]
            agent = agent.model_copy(update={
                "state": AgentState.BUSY,
                "last_active_at": datetime.now(timezone.utc).isoformat(),
            })
            self._pool[agent.agent_id] = agent
            return agent

        role_count = len(self._role_index.get(role, []))
        if role_count < self._max_per_role:
            return await self._create_new(role, employee_id)

        key = f"release:{role}"
        event = asyncio.Event()
        self._release_events[key] = event
        try:
            await asyncio.wait_for(event.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            raise PoolExhaustedError(f"No available agent for role '{role}' after {timeout}s")
        finally:
            self._release_events.pop(key, None)

        idle_agents = [
            a for a in self._pool.values()
            if a.employee.role == role and a.state == AgentState.IDLE
        ]
        if idle_agents:
            agent = idle_agents[0]
            agent = agent.model_copy(update={"state": AgentState.BUSY})
            self._pool[agent.agent_id] = agent
            return agent
        raise PoolExhaustedError(f"No available agent for role '{role}'")

    async def _create_new(self, role: str, employee_id: UUID | None = None) -> PooledAgent:
        agent_id = employee_id or uuid4()
        base_agent = await self._factory.create_agent(agent_id, role)
        pooled = PooledAgent(agent_id=agent_id, employee=base_agent.employee, state=AgentState.BUSY)
        self._pool[agent_id] = pooled
        self._role_index.setdefault(role, []).append(agent_id)

        mailbox = AgentMailbox(agent_id)
        self._mailboxes[agent_id] = mailbox
        self._router.register(agent_id, mailbox)
        return pooled

    async def release(self, agent_id: UUID) -> None:
        agent = self._pool.get(agent_id)
        if agent is None:
            return
        self._pool[agent_id] = agent.model_copy(update={
            "state": AgentState.IDLE, "current_task": None,
            "total_tasks": agent.total_tasks + 1,
            "last_active_at": datetime.now(timezone.utc).isoformat(),
        })
        key = f"release:{agent.employee.role}"
        event = self._release_events.get(key)
        if event and not event.is_set():
            event.set()

    async def get_state(self, agent_id: UUID) -> AgentState | None:
        agent = self._pool.get(agent_id)
        return agent.state if agent else None

    async def set_state(self, agent_id: UUID, state: AgentState, task: str | None = None) -> None:
        agent = self._pool.get(agent_id)
        if agent is None:
            return
        self._pool[agent_id] = agent.model_copy(update={"state": state, "current_task": task})

    async def terminate(self, agent_id: UUID) -> None:
        agent = self._pool.get(agent_id)
        if agent is None:
            return
        self._pool[agent_id] = agent.model_copy(update={"state": AgentState.TERMINATED})
        self._router.unregister(agent_id)
        self._mailboxes.pop(agent_id, None)

    async def list_by_role(self, role: str) -> list[PooledAgent]:
        ids = self._role_index.get(role, [])
        return [self._pool[aid] for aid in ids if aid in self._pool]

    async def list_idle(self, role: str | None = None) -> list[PooledAgent]:
        agents = [a for a in self._pool.values() if a.state == AgentState.IDLE]
        if role:
            agents = [a for a in agents if a.employee.role == role]
        return agents

    async def health_check(self) -> dict:
        by_state: dict[str, int] = {}
        by_role: dict[str, int] = {}
        for agent in self._pool.values():
            by_state[agent.state.value] = by_state.get(agent.state.value, 0) + 1
            by_role[agent.employee.role] = by_role.get(agent.employee.role, 0) + 1
        return {"total": len(self._pool), "by_state": by_state, "by_role": by_role}

    def get_mailbox(self, agent_id: UUID) -> AgentMailbox | None:
        return self._mailboxes.get(agent_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_pool.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/pool.py tests/unit/agents/test_pool.py
git commit -m "feat(agents): add AgentPool for agent lifecycle management"
```

---

### Task 11: TeamComposer

**Files:**
- Create: `src/cabinet/agents/composer.py`
- Create: `tests/unit/agents/test_composer.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_composer.py
from __future__ import annotations

import pytest
from uuid import uuid4
from unittest.mock import AsyncMock

from cabinet.agents.composer import TeamRequirement, ComposedTeam, TeamComposer
from cabinet.agents.pool import AgentPool
from cabinet.agents.capability import CapabilityRegistry, AgentCapability
from cabinet.agents.mailbox import MailboxRouter
from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.agents.employee_store import JsonEmployeeStore
from cabinet.agents.workspace import SharedWorkspace
from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.core.memory.protocol import MemoryStore


@pytest.fixture
def composer(tmp_path):
    router = MailboxRouter()
    factory = StubAgentFactory()
    pool = AgentPool(factory=factory, mailbox_router=router, max_per_role=5)
    store = JsonEmployeeStore(path=str(tmp_path / "employees.json"))
    tool_reg = LocalToolRegistry()
    cap_reg = CapabilityRegistry(employee_store=store, tool_registry=tool_reg)
    ms = AsyncMock(spec=MemoryStore)
    ms.search = AsyncMock(return_value=[])
    ms.store = AsyncMock()

    def ws_factory(team_id):
        return SharedWorkspace(team_id, ms)

    return TeamComposer(agent_pool=pool, capability_registry=cap_reg, workspace_factory=ws_factory)


@pytest.mark.asyncio
async def test_compose_team(composer, tmp_path):
    await composer._capability_registry._employee_store.initialize()
    req = TeamRequirement(roles=["advisor", "executor"], min_members=2)
    team = await composer.compose(req)
    assert isinstance(team, ComposedTeam)
    assert len(team.members) >= 2


@pytest.mark.asyncio
async def test_dissolve_team(composer, tmp_path):
    await composer._capability_registry._employee_store.initialize()
    req = TeamRequirement(roles=["advisor"], min_members=1)
    team = await composer.compose(req)
    await composer.dissolve(team.team_id)
    assert team.team_id not in composer._active_teams


@pytest.mark.asyncio
async def test_compose_respects_max_members(composer, tmp_path):
    await composer._capability_registry._employee_store.initialize()
    req = TeamRequirement(roles=["advisor", "executor", "strategist"], max_members=2)
    team = await composer.compose(req)
    assert len(team.members) <= 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_composer.py -v`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/composer.py
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Callable
from uuid import UUID, uuid4

from pydantic import BaseModel, Field

from cabinet.agents.capability import CapabilityRegistry
from cabinet.agents.pool import AgentPool, PooledAgent
from cabinet.agents.workspace import SharedWorkspace

logger = logging.getLogger(__name__)


class TeamRequirement(BaseModel):
    roles: list[str] = []
    skills: list[str] = []
    min_members: int = 2
    max_members: int = 5
    expertise_areas: list[str] = []


class ComposedTeam(BaseModel):
    team_id: UUID = Field(default_factory=uuid4)
    members: list[PooledAgent]
    workspace: SharedWorkspace | None = None
    requirement: TeamRequirement
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class TeamComposer:
    def __init__(
        self,
        agent_pool: AgentPool,
        capability_registry: CapabilityRegistry,
        workspace_factory: Callable[[UUID], SharedWorkspace],
    ):
        self._pool = agent_pool
        self._capabilities = capability_registry
        self._workspace_factory = workspace_factory
        self._active_teams: dict[UUID, ComposedTeam] = {}

    async def compose(self, requirement: TeamRequirement) -> ComposedTeam:
        members: list[PooledAgent] = []
        member_ids: set[UUID] = set()

        for role in requirement.roles:
            if len(members) >= requirement.max_members:
                break
            try:
                agent = await self._pool.acquire(role)
                members.append(agent)
                member_ids.add(agent.agent_id)
            except Exception:
                logger.warning("Failed to acquire agent for role: %s", role)

        for skill in requirement.skills:
            if len(members) >= requirement.max_members:
                break
            existing_skills = set()
            for m in members:
                cap = await self._capabilities.get_capability(m.agent_id)
                if cap:
                    existing_skills.update(cap.skills)
            if skill in existing_skills:
                continue
            candidates = await self._capabilities.discover(skill=skill)
            for cap in candidates:
                if cap.agent_id not in member_ids and len(members) < requirement.max_members:
                    try:
                        agent = await self._pool.acquire(cap.role)
                        members.append(agent)
                        member_ids.add(agent.agent_id)
                        break
                    except Exception:
                        continue

        workspace = self._workspace_factory(uuid4())
        team = ComposedTeam(members=members, workspace=workspace, requirement=requirement)
        self._active_teams[team.team_id] = team
        return team

    async def dissolve(self, team_id: UUID) -> None:
        team = self._active_teams.pop(team_id, None)
        if team is None:
            return
        for member in team.members:
            await self._pool.release(member.agent_id)

    async def add_member(self, team_id: UUID, role: str) -> PooledAgent | None:
        team = self._active_teams.get(team_id)
        if team is None or len(team.members) >= team.requirement.max_members:
            return None
        try:
            agent = await self._pool.acquire(role)
            team.members.append(agent)
            return agent
        except Exception:
            return None

    async def remove_member(self, team_id: UUID, agent_id: UUID) -> None:
        team = self._active_teams.get(team_id)
        if team is None:
            return
        team.members = [m for m in team.members if m.agent_id != agent_id]
        await self._pool.release(agent_id)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_composer.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/composer.py tests/unit/agents/test_composer.py
git commit -m "feat(agents): add TeamComposer for dynamic team formation"
```

---

### Task 12: DebateProtocol

**Files:**
- Create: `src/cabinet/agents/debate.py`
- Create: `tests/unit/agents/test_debate.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_debate.py
from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.debate import DebateConfig, DebateProtocol, DebateResult
from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.models.primitives import Employee


class MockDebateAgent:
    def __init__(self, agent_id, responses=None):
        self._id = agent_id
        self._responses = responses or ["I support this proposal"]
        self._idx = 0

    @property
    def employee(self):
        return Employee(id=self._id, team_id=uuid4(), name="mock", role="debater", kind="ai")

    async def execute(self, task: str, context: AgentContext) -> AgentOutput:
        content = self._responses[self._idx % len(self._responses)]
        self._idx += 1
        return AgentOutput(content=content, employee_id=self._id)


@pytest.mark.asyncio
async def test_debate_basic():
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockDebateAgent(p1, ["I support this"]),
        p2: MockDebateAgent(p2, ["I also support this"]),
    }
    protocol = DebateProtocol()
    config = DebateConfig(topic="Should we proceed?", participants=[p1, p2], max_rounds=1)
    result = await protocol.run_debate(config, {}, agents)
    assert isinstance(result, DebateResult)
    assert len(result.rounds) == 1
    assert len(result.rounds[0].positions) == 2


@pytest.mark.asyncio
async def test_debate_consensus():
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockDebateAgent(p1, ["I agree with the proposal"]),
        p2: MockDebateAgent(p2, ["I support this completely"]),
    }
    protocol = DebateProtocol()
    config = DebateConfig(topic="Test", participants=[p1, p2], max_rounds=3, require_consensus=True)
    result = await protocol.run_debate(config, {}, agents)
    assert result.consensus_reached is True


@pytest.mark.asyncio
async def test_debate_no_consensus():
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockDebateAgent(p1, ["I strongly oppose this idea"]),
        p2: MockDebateAgent(p2, ["I strongly support this idea"]),
    }
    protocol = DebateProtocol()
    config = DebateConfig(topic="Test", participants=[p1, p2], max_rounds=2, require_consensus=True)
    result = await protocol.run_debate(config, {}, agents)
    assert result.consensus_reached is False


@pytest.mark.asyncio
async def test_debate_with_judge():
    p1, p2, judge = uuid4(), uuid4(), uuid4()
    agents = {
        p1: MockDebateAgent(p1, ["I oppose"]),
        p2: MockDebateAgent(p2, ["I support"]),
        judge: MockDebateAgent(judge, ["After review, proceed with caution"]),
    }
    protocol = DebateProtocol()
    config = DebateConfig(topic="Test", participants=[p1, p2], max_rounds=1, judge_id=judge)
    result = await protocol.run_debate(config, {}, agents)
    assert result.final_decision is not None
    assert "proceed" in result.final_decision.lower()


@pytest.mark.asyncio
async def test_debate_dissenting_opinions():
    p1, p2 = uuid4(), uuid4()
    agents = {
        p1: MockDebateAgent(p1, ["I oppose this completely"]),
        p2: MockDebateAgent(p2, ["I support this fully"]),
    }
    protocol = DebateProtocol()
    config = DebateConfig(topic="Test", participants=[p1, p2], max_rounds=1)
    result = await protocol.run_debate(config, {}, agents)
    assert len(result.dissenting_opinions) > 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_debate.py -v`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/debate.py
from __future__ import annotations

import logging
from uuid import UUID

from pydantic import BaseModel

from cabinet.agents.context import AgentContext

logger = logging.getLogger(__name__)


class DebatePosition(BaseModel):
    agent_id: UUID
    stance: str
    argument: str
    evidence: list[str] = []


class DebateRound(BaseModel):
    round_number: int
    positions: list[DebatePosition]
    summary: str | None = None


class DebateConfig(BaseModel):
    topic: str
    participants: list[UUID]
    max_rounds: int = 3
    require_consensus: bool = False
    judge_id: UUID | None = None


class DebateResult(BaseModel):
    topic: str
    rounds: list[DebateRound]
    consensus_reached: bool
    final_decision: str | None = None
    dissenting_opinions: list[str] = []


class DebateProtocol:
    async def run_debate(
        self, config: DebateConfig, context: dict, agents: dict[UUID, object],
    ) -> DebateResult:
        rounds: list[DebateRound] = []

        for round_num in range(1, config.max_rounds + 1):
            positions = []
            for pid in config.participants:
                agent = agents.get(pid)
                if agent is None:
                    continue
                prompt = (
                    f"Debate topic: {config.topic}\n"
                    f"Round {round_num} of {config.max_rounds}\n"
                    f"State your position (support/oppose/neutral) and argument."
                )
                output = await agent.execute(prompt, AgentContext())
                stance = self._extract_stance(output.content)
                positions.append(DebatePosition(agent_id=pid, stance=stance, argument=output.content))

            rounds.append(DebateRound(round_number=round_num, positions=positions))

            if self._check_consensus(positions):
                return DebateResult(
                    topic=config.topic, rounds=rounds, consensus_reached=True,
                    final_decision=self._synthesize(rounds),
                )

        if config.judge_id and config.judge_id in agents:
            judge = agents[config.judge_id]
            summary = self._build_judge_summary(config.topic, rounds)
            judge_output = await judge.execute(summary, AgentContext())
            return DebateResult(
                topic=config.topic, rounds=rounds, consensus_reached=False,
                final_decision=judge_output.content,
                dissenting_opinions=self._collect_dissent(rounds),
            )

        return DebateResult(
            topic=config.topic, rounds=rounds, consensus_reached=False,
            dissenting_opinions=self._collect_dissent(rounds),
        )

    def _extract_stance(self, content: str) -> str:
        lower = content.lower()
        for kw in ["oppose", "against", "reject", "disagree", "object"]:
            if kw in lower:
                return "oppose"
        for kw in ["support", "agree", "favor", "approve", "endorse"]:
            if kw in lower:
                return "support"
        return "neutral"

    def _check_consensus(self, positions: list[DebatePosition]) -> bool:
        if len(positions) < 2:
            return True
        stances = {p.stance for p in positions}
        return stances == {"support"} or stances == {"neutral", "support"}

    def _synthesize(self, rounds: list[DebateRound]) -> str:
        args = [p.argument for r in rounds for p in r.positions]
        return "Consensus: " + " | ".join(args[:3])

    def _build_judge_summary(self, topic: str, rounds: list[DebateRound]) -> str:
        parts = [f"Debate topic: {topic}"]
        for r in rounds:
            for p in r.positions:
                parts.append(f"Agent {p.agent_id} ({p.stance}): {p.argument[:200]}")
        parts.append("As the judge, make a final decision.")
        return "\n".join(parts)

    def _collect_dissent(self, rounds: list[DebateRound]) -> list[str]:
        return [p.argument for r in rounds for p in r.positions if p.stance == "oppose"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_debate.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/debate.py tests/unit/agents/test_debate.py
git commit -m "feat(agents): add DebateProtocol for structured multi-agent debate"
```

---

### Task 13: AgentRecovery

**Files:**
- Create: `src/cabinet/agents/recovery.py`
- Create: `tests/unit/agents/test_recovery.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/agents/test_recovery.py
from __future__ import annotations

import pytest
from uuid import uuid4
from unittest.mock import AsyncMock

from cabinet.agents.recovery import AgentRecovery, RecoveryConfig, RecoveryStrategy
from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.models.primitives import Employee


class FailingAgent:
    def __init__(self, employee, fail_count=1):
        self._employee = employee
        self._fail_count = fail_count
        self._call_count = 0

    @property
    def employee(self):
        return self._employee

    async def execute(self, task, context):
        self._call_count += 1
        if self._call_count <= self._fail_count:
            raise RuntimeError(f"Agent failed (attempt {self._call_count})")
        return AgentOutput(content="Success after retry", employee_id=self._employee.id)


@pytest.mark.asyncio
async def test_recovery_retry_success():
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    agent = FailingAgent(employee, fail_count=1)
    recovery = AgentRecovery(agent_pool=AsyncMock(), capability_registry=AsyncMock())
    config = RecoveryConfig(max_retries=2, strategies=[RecoveryStrategy.RETRY])
    result = await recovery.execute_with_recovery(agent, "test task", AgentContext(), config)
    assert result.status == "completed"
    assert result.content == "Success after retry"


@pytest.mark.asyncio
async def test_recovery_all_strategies_fail():
    employee = Employee(id=uuid4(), team_id=uuid4(), name="test", role="advisor", kind="ai")
    agent = FailingAgent(employee, fail_count=100)
    recovery = AgentRecovery(agent_pool=AsyncMock(), capability_registry=AsyncMock())
    config = RecoveryConfig(max_retries=1, strategies=[RecoveryStrategy.RETRY, RecoveryStrategy.ESCALATE])
    result = await recovery.execute_with_recovery(agent, "test task", AgentContext(), config)
    assert result.status == "failed"


@pytest.mark.asyncio
async def test_recovery_config_defaults():
    config = RecoveryConfig()
    assert config.max_retries == 2
    assert RecoveryStrategy.RETRY in config.strategies
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/unit/agents/test_recovery.py -v`
Expected: FAIL

- [ ] **Step 3: Write implementation**

```python
# src/cabinet/agents/recovery.py
from __future__ import annotations

import asyncio
import logging
from enum import Enum
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.agents.capability import CapabilityRegistry
from cabinet.agents.context import AgentContext, AgentOutput
from cabinet.agents.pool import AgentPool

logger = logging.getLogger(__name__)


class RecoveryStrategy(str, Enum):
    RETRY = "retry"
    FALLBACK_AGENT = "fallback_agent"
    FALLBACK_MODEL = "fallback_model"
    SIMPLIFY_TASK = "simplify_task"
    ESCALATE = "escalate"


class RecoveryConfig(BaseModel):
    max_retries: int = 2
    retry_delay_base: float = 1.0
    strategies: list[RecoveryStrategy] = [
        RecoveryStrategy.RETRY,
        RecoveryStrategy.FALLBACK_MODEL,
        RecoveryStrategy.FALLBACK_AGENT,
        RecoveryStrategy.ESCALATE,
    ]


class AgentRecovery:
    def __init__(
        self,
        agent_pool: AgentPool,
        capability_registry: CapabilityRegistry,
        dead_letter_queue: object | None = None,
    ):
        self._pool = agent_pool
        self._capabilities = capability_registry
        self._dlq = dead_letter_queue

    async def execute_with_recovery(
        self,
        agent: object,
        task: str,
        context: AgentContext,
        config: RecoveryConfig = RecoveryConfig(),
    ) -> AgentOutput:
        last_error: Exception | None = None

        for strategy in config.strategies:
            try:
                if strategy == RecoveryStrategy.RETRY:
                    result = await self._retry(agent, task, context, config)
                    if result:
                        return result
                elif strategy == RecoveryStrategy.FALLBACK_AGENT:
                    result = await self._fallback_agent(agent, task, context)
                    if result:
                        return result
                elif strategy == RecoveryStrategy.FALLBACK_MODEL:
                    fallback_ctx = context.model_copy(update={"model": "default"})
                    result = await self._retry(agent, task, fallback_ctx, config)
                    if result:
                        return result
                elif strategy == RecoveryStrategy.SIMPLIFY_TASK:
                    result = await self._retry(agent, f"(simplified) {task[:100]}", context, config)
                    if result:
                        return result
                elif strategy == RecoveryStrategy.ESCALATE:
                    emp = getattr(agent, "_employee", getattr(agent, "employee", None))
                    eid = emp.id if emp else uuid4()
                    return AgentOutput(
                        content=f"Task escalated: {last_error}",
                        employee_id=eid, status="failed",
                    )
            except Exception as e:
                last_error = e
                logger.warning("Recovery strategy %s failed: %s", strategy.value, e)

        emp = getattr(agent, "_employee", getattr(agent, "employee", None))
        eid = emp.id if emp else uuid4()
        return AgentOutput(
            content=f"All recovery strategies failed: {last_error}",
            employee_id=eid, status="failed",
        )

    async def _retry(self, agent, task, context, config):
        for attempt in range(config.max_retries + 1):
            try:
                return await agent.execute(task, context)
            except Exception as e:
                logger.warning("Retry attempt %d failed: %s", attempt + 1, e)
                if attempt < config.max_retries:
                    delay = min(config.retry_delay_base * (2 ** attempt), 30.0)
                    await asyncio.sleep(delay)
        return None

    async def _fallback_agent(self, original_agent, task, context):
        emp = getattr(original_agent, "_employee", getattr(original_agent, "employee", None))
        if emp is None:
            return None
        try:
            pooled = await self._pool.acquire(emp.role)
            base_agent = await self._pool._factory.create_agent(pooled.agent_id, emp.role)
            output = await base_agent.execute(task, context)
            await self._pool.release(pooled.agent_id)
            return output
        except Exception as e:
            logger.warning("Fallback agent failed: %s", e)
            return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/unit/agents/test_recovery.py -v`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/agents/recovery.py tests/unit/agents/test_recovery.py
git commit -m "feat(agents): add AgentRecovery for agent-level error recovery"
```

---

## 🔍 L3 Checkpoint

```bash
python -m pytest tests/unit/agents/ -v
```

- [ ] All agent tests pass
- [ ] AgentPool, TeamComposer, DebateProtocol, AgentRecovery all work

---

## L4 集成打通层

### Task 14: 数据库迁移 v006

**Files:**
- Create: `src/cabinet/core/events/migrations/v006_multi_agent.py`
- Modify: `src/cabinet/core/events/migrations/runner.py`

- [ ] **Step 1: Create migration file**

```python
# src/cabinet/core/events/migrations/v006_multi_agent.py
from __future__ import annotations

import aiosqlite


class V006MultiAgent:
    version = 6
    description = "add multi-agent tables"

    async def up(self, db: aiosqlite.Connection) -> None:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS agent_messages (
                id TEXT PRIMARY KEY,
                sender_id TEXT NOT NULL,
                recipient_id TEXT NOT NULL,
                msg_type TEXT NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                reply_to TEXT,
                created_at TEXT NOT NULL
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_agent_messages_recipient ON agent_messages(recipient_id, created_at)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_agent_messages_sender ON agent_messages(sender_id, created_at)")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS handoff_requests (
                id TEXT PRIMARY KEY,
                from_agent_id TEXT NOT NULL,
                to_agent_id TEXT NOT NULL,
                task_description TEXT NOT NULL,
                context_snapshot TEXT DEFAULT '{}',
                reason TEXT NOT NULL,
                priority TEXT DEFAULT 'normal',
                deadline TEXT,
                status TEXT DEFAULT 'pending',
                response_message TEXT,
                created_at TEXT NOT NULL,
                resolved_at TEXT
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_handoff_to_agent ON handoff_requests(to_agent_id, status)")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS composed_teams (
                id TEXT PRIMARY KEY,
                requirement TEXT NOT NULL,
                member_ids TEXT NOT NULL,
                workspace_snapshot TEXT DEFAULT '{}',
                status TEXT DEFAULT 'active',
                created_at TEXT NOT NULL,
                dissolved_at TEXT
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS debates (
                id TEXT PRIMARY KEY,
                topic TEXT NOT NULL,
                config TEXT NOT NULL,
                rounds TEXT NOT NULL,
                consensus_reached INTEGER DEFAULT 0,
                final_decision TEXT,
                dissenting_opinions TEXT DEFAULT '[]',
                created_at TEXT NOT NULL
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS agent_capabilities (
                agent_id TEXT PRIMARY KEY,
                role TEXT NOT NULL,
                skills TEXT DEFAULT '[]',
                specializations TEXT DEFAULT '[]',
                max_concurrent_tasks INTEGER DEFAULT 1,
                current_load INTEGER DEFAULT 0,
                updated_at TEXT NOT NULL
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_agent_capabilities_role ON agent_capabilities(role)")

    async def down(self, db: aiosqlite.Connection) -> None:
        await db.execute("DROP INDEX IF EXISTS idx_agent_capabilities_role")
        await db.execute("DROP TABLE IF EXISTS agent_capabilities")
        await db.execute("DROP TABLE IF EXISTS debates")
        await db.execute("DROP TABLE IF EXISTS composed_teams")
        await db.execute("DROP INDEX IF EXISTS idx_handoff_to_agent")
        await db.execute("DROP TABLE IF EXISTS handoff_requests")
        await db.execute("DROP INDEX IF EXISTS idx_agent_messages_sender")
        await db.execute("DROP INDEX IF EXISTS idx_agent_messages_recipient")
        await db.execute("DROP TABLE IF EXISTS agent_messages")
```

- [ ] **Step 2: Register in runner.py**

Add import and append `V006MultiAgent()` to the migrations list in `runner.py`.

- [ ] **Step 3: Run migration tests**

Run: `python -m pytest tests/unit/core/events/ -v -k migration`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/events/migrations/v006_multi_agent.py src/cabinet/core/events/migrations/runner.py
git commit -m "feat(db): add v006 multi-agent migration"
```

---

### Task 15: CrewAI 适配器完善

**Files:**
- Modify: `src/cabinet/agents/crewai_adapter/agent.py`
- Modify: `src/cabinet/agents/crewai_adapter/team.py`

- [ ] **Step 1: Update agent.py**

Key changes:
- Add `tool_registry_adapter` and `shared_workspace` constructor params
- `_ensure_agent()`: use `ToolRegistryAdapter.get_tool_definitions()` + `CrewAISkillAdapter.to_crewai_tool()` for tools, set `memory=True`
- Add `get_crewai_agent()` public method (replace direct `_crewai_agent` access)
- Implement `reflect()` using CrewAI Task

- [ ] **Step 2: Update team.py**

Key changes:
- Add `shared_workspace` and `process` constructor params
- `dispatch()`: create one Task per agent (not single Task), use `Process.sequential`/`Process.hierarchical`, set `memory=True`
- Use `agent.get_crewai_agent()` instead of `agent._crewai_agent`

- [ ] **Step 3: Run CrewAI adapter tests**

Run: `python -m pytest tests/unit/agents/crewai_adapter/ -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/agents/crewai_adapter/
git commit -m "feat(agents): improve CrewAI adapter with tool injection, reflect, multi-task"
```

---

### Task 16: WorkflowEngine _execute_skill 真正执行

**Files:**
- Modify: `src/cabinet/core/workflow/engine.py`

- [ ] **Step 1: Add constructor params**

Add `agent_pool: object | None = None` and `tool_registry: object | None = None` to `__init__`.

- [ ] **Step 2: Rewrite _execute_skill**

Three-tier execution:
1. If `agent_pool` available: acquire agent → execute skill → release
2. If `tool_registry` available: find skill by ID → execute directly
3. Fallback: existing LLM description approach

- [ ] **Step 3: Run workflow tests**

Run: `python -m pytest tests/unit/core/workflow/ -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/core/workflow/engine.py
git commit -m "feat(workflow): rewrite _execute_skill to use AgentPool and ToolRegistry"
```

---

### Task 17: Decision 委派真正实现

**Files:**
- Modify: `src/cabinet/rooms/decision/service.py`

- [ ] **Step 1: Add HandoffManager integration**

Add `handoff_manager` and `agent_pool` constructor params.

- [ ] **Step 2: Rewrite delegate method**

When `handoff_manager` and `agent_pool` are available:
- Acquire target agent from pool
- Create `HandoffRequest`
- Call `handoff_manager.request_handoff()`
- If accepted, apply `DecisionDelegated` event
- Fallback: existing behavior (just change status)

- [ ] **Step 3: Run decision room tests**

Run: `python -m pytest tests/unit/rooms/decision/ -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/rooms/decision/service.py
git commit -m "feat(decision): implement real delegation via HandoffManager"
```

---

### Task 18: Runtime 组装更新

**Files:**
- Modify: `src/cabinet/runtime.py`

- [ ] **Step 1: Add imports**

```python
from cabinet.agents.mailbox import MailboxRouter
from cabinet.agents.pool import AgentPool
from cabinet.agents.handoff import HandoffManager
from cabinet.agents.capability import CapabilityRegistry
from cabinet.agents.composer import TeamComposer
from cabinet.agents.recovery import AgentRecovery
from cabinet.agents.workspace import SharedWorkspace
```

- [ ] **Step 2: Add constructor params and initialization**

Add optional params: `agent_pool`, `mailbox_router`, `handoff_manager`, `capability_registry`, `team_composer`, `agent_recovery`.

Initialize with defaults if not provided:
```python
self._mailbox_router = mailbox_router or MailboxRouter()
self._agent_pool = agent_pool or AgentPool(factory=agent_factory, mailbox_router=self._mailbox_router)
self._handoff_manager = handoff_manager or HandoffManager(self._mailbox_router)
self._capability_registry = capability_registry or CapabilityRegistry(employee_store=employee_store, tool_registry=tool_registry)
self._team_composer = team_composer or TeamComposer(
    agent_pool=self._agent_pool, capability_registry=self._capability_registry,
    workspace_factory=lambda tid: SharedWorkspace(tid, memory_store),
)
self._agent_recovery = agent_recovery or AgentRecovery(
    agent_pool=self._agent_pool, capability_registry=self._capability_registry,
    dead_letter_queue=dead_letter_queue,
)
```

Inject into WorkflowEngine:
```python
self._workflow_engine._agent_pool = self._agent_pool
self._workflow_engine._tool_registry = tool_registry
```

- [ ] **Step 3: Run runtime tests**

Run: `python -m pytest tests/integration/test_runtime.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/runtime.py
git commit -m "feat(runtime): assemble multi-agent orchestration components"
```

---

### Task 19: CLI 命令

**Files:**
- Modify: `src/cabinet/cli/main.py`

- [ ] **Step 1: Add team and agent subcommand groups**

```python
team_app = typer.Typer(help="Team management")
app.add_typer(team_app, name="team")

agent_app = typer.Typer(help="Agent management")
app.add_typer(agent_app, name="agent")
```

- [ ] **Step 2: Add team commands**

- `team compose --roles --skills --max`: Compose dynamic team
- `team list`: List active teams
- `team dissolve <team_id>`: Dissolve team

- [ ] **Step 3: Add agent commands**

- `agent pool-status`: Show agent pool status

- [ ] **Step 4: Run CLI smoke test**

Run: `python -m cabinet.cli.main --help`
Expected: Shows team and agent commands

- [ ] **Step 5: Commit**

```bash
git add src/cabinet/cli/main.py
git commit -m "feat(cli): add team and agent pool CLI commands"
```

---

### Task 20: API 端点

**Files:**
- Create: `src/cabinet/api/routes/agents.py`
- Modify: `src/cabinet/api/routes/__init__.py`

- [ ] **Step 1: Create agents API routes**

Endpoints:
- `POST /api/v1/agents/teams/compose` — Compose team
- `GET /api/v1/agents/teams` — List teams
- `DELETE /api/v1/agents/teams/{team_id}` — Dissolve team
- `GET /api/v1/agents/pool/status` — Pool status
- `POST /api/v1/agents/{id}/message` — Send message
- `POST /api/v1/agents/handoffs` — Initiate handoff
- `POST /api/v1/agents/debates` — Start debate

- [ ] **Step 2: Register route in __init__.py**

Add the agents router to the FastAPI app.

- [ ] **Step 3: Run API tests**

Run: `python -m pytest tests/unit/api/ -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/cabinet/api/routes/agents.py src/cabinet/api/routes/__init__.py
git commit -m "feat(api): add multi-agent orchestration API endpoints"
```

---

## 🔍 L4 Final Checkpoint

```bash
python -m pytest tests/unit/agents/ -v
python -m pytest tests/unit/core/workflow/ -v
python -m pytest tests/unit/rooms/decision/ -v
python -m pytest tests/integration/ -v
python -m ruff check src/cabinet/agents/
python -m mypy src/cabinet/agents/ --ignore-missing-imports
```

- [ ] All tests pass
- [ ] Lint clean
- [ ] Type check clean
- [ ] Integration tests pass
