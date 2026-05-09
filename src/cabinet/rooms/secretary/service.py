from __future__ import annotations

import logging
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.agents.context import AgentContext
from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.decisions import Decision, DecisionType
from cabinet.models.events import SecretaryNotification
from cabinet.rooms.secretary.domain_events import (
    CaptainGreeted,
    DecisionFiltered,
    InputProcessed,
    NotificationSent,
    PendingSummarized,
)
from cabinet.rooms.secretary.models import (
    ConflictAlert,
    DailyBrief,
    FilterResult,
    Greeting,
    InteractionContext,
    NotificationEvent,
    NotificationResult,
    PendingSummary,
    PipeCalibration,
    PipeTemplate,
    SecretaryLevel,
    SecretaryResponse,
)

try:
    from cabinet.core.observability import ROOM_OPERATION, get_tracer

    _tracer = get_tracer("cabinet.secretary")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False

if TYPE_CHECKING:
    from cabinet.core.knowledge.protocol import KnowledgeBase
    from cabinet.core.memory.protocol import MemoryStore
    from cabinet.rooms.secretary.conversation import ConversationStore

logger = logging.getLogger(__name__)


class StreamingSecretaryResponse:
    def __init__(self, stream, finalize):
        self.stream = stream
        self._finalize = finalize
        self._finalized = False

    async def finalize(self):
        if self._finalized:
            return
        self._finalized = True
        try:
            await self._finalize()
        except Exception:
            pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.finalize()


class SecretaryAgentService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
        knowledge_base: KnowledgeBase | None = None,
        memory_store: MemoryStore | None = None,
        conversation_store: ConversationStore | None = None,
        pipe_registry: object | None = None,
        template_store: object | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._knowledge_base = knowledge_base
        self._memory_store = memory_store
        self._conversation_store = conversation_store
        self._pipe_registry = pipe_registry
        self._template_store = template_store
        self._greetings: dict[str, str] = {}
        self._notifications: list[NotificationEvent] = []
        self._inputs: dict[str, list[str]] = {}
        self._pending_summaries: dict[str, str] = {}
        self._filtered_decisions: dict[UUID, FilterResult] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, CaptainGreeted):
            self._greetings[event.captain_id] = event.greeting_text
        elif isinstance(event, InputProcessed):
            self._inputs.setdefault(event.captain_id, []).append(event.response_text)
        elif isinstance(event, PendingSummarized):
            self._pending_summaries[event.captain_id] = event.summary_text
        elif isinstance(event, NotificationSent):
            self._notifications.append(
                NotificationEvent(
                    event_type=event.notification_type,
                    severity=event.severity,
                    source="room:secretary",
                    content=event.content,
                )
            )
            cross_room.append(
                (
                    "secretary.notification",
                    SecretaryNotification(
                        captain_id=event.captain_id,
                        notification_type=event.notification_type,
                        content=event.content,
                        severity=event.severity,
                    ),
                    None,
                )
            )
        elif isinstance(event, DecisionFiltered):
            if event.filter_result is not None:
                self._filtered_decisions[event.decision_id] = event.filter_result
        return cross_room

    async def _build_context_prompt(self, captain_id: str, input_text: str) -> str:
        knowledge_context = ""
        if self._knowledge_base is not None:
            chunks = await self._knowledge_base.query(input_text, top_k=3)
            knowledge_context = "\n".join(c.content for c in chunks)

        memory_context = ""
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope

            items = await self._memory_store.search(
                captain_id,
                MemoryScope.LONG_TERM,
                limit=3,
            )
            memory_context = "\n".join(item.content for item in items)

        conversation_history = ""
        if self._conversation_store is not None:
            history = await self._conversation_store.get_history(captain_id)
            if history:
                lines = []
                for msg in history:
                    role = msg["role"].capitalize()
                    lines.append(f"{role}: {msg['content']}")
                conversation_history = "\n".join(lines)

        prompt = f"Captain says: {input_text}\n\n"
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
        return prompt

    async def greet(self, captain_id: str) -> Greeting:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="secretary", operation="greet").inc()
        memory_context = ""
        if self._memory_store is not None:
            from cabinet.models.primitives import MemoryScope

            items = await self._memory_store.search(
                captain_id,
                MemoryScope.LONG_TERM,
                limit=3,
            )
            memory_context = "\n".join(item.content for item in items)

        try:
            agent = await self._agent_factory.create_agent(uuid4(), "secretary")
            context = AgentContext(model="default", temperature=0.7)
            prompt = f"Generate a greeting for Captain {captain_id}."
            if memory_context:
                prompt += f"\n\nCaptain's preferences and history:\n{memory_context}"
            prompt += " Include a brief summary of what you can help with today."
            output = await agent.execute(prompt, context)
            greeting_text = output.content
        except Exception as exc:
            logger.exception("LLM call failed in secretary greet: %s", exc)
            greeting_text = f"Welcome back, Captain {captain_id}. How can I assist you today?"

        event = CaptainGreeted(captain_id=captain_id, greeting_text=greeting_text)
        await self._publish_and_apply(event)
        return Greeting(
            captain_id=captain_id,
            message=greeting_text,
            auto_processed_summary="",
            today_highlights=[],
            fallback="Welcome back" in greeting_text,
        )

    async def process_input(
        self,
        captain_input: str,
        context: InteractionContext,
    ) -> SecretaryResponse:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="secretary", operation="process_input").inc()
        fallback = False
        try:
            agent = await self._agent_factory.create_agent(uuid4(), "secretary")
            agent_context = AgentContext(model="default", temperature=0.7)
            prompt = await self._build_context_prompt(context.captain_id, captain_input)
            output = await agent.execute(prompt, agent_context)
            response_text = output.content
        except Exception as exc:
            logger.exception("LLM call failed in secretary process_input: %s", exc)
            response_text = "I encountered an error processing your request. Please try again."
            fallback = True
        event = InputProcessed(
            captain_id=context.captain_id,
            input_text=captain_input,
            response_text=response_text,
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
                    content=f"Captain: {captain_input}\nSecretary: {response_text}",
                    scope=MemoryScope.LONG_TERM,
                    metadata={"captain_id": context.captain_id, "type": "interaction"},
                ),
                MemoryScope.LONG_TERM,
            )

        if self._conversation_store is not None:
            await self._conversation_store.add_turn(
                context.captain_id, captain_input, response_text
            )

        return SecretaryResponse(message=response_text, level=SecretaryLevel.L1, fallback=fallback)

    async def process_input_stream(
        self,
        captain_input: str,
        context: InteractionContext,
    ) -> StreamingSecretaryResponse:
        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        agent_context = AgentContext(model="default", temperature=0.7)
        prompt = await self._build_context_prompt(context.captain_id, captain_input)

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

    async def summarize_pending(self, captain_id: str) -> PendingSummary:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="secretary", operation="summarize_pending").inc()
        agent = await self._agent_factory.create_agent(uuid4(), "secretary")
        context = AgentContext(model="default", temperature=0.7)
        output = await agent.execute(
            f"Captain {captain_id} has no pending items. "
            f"Generate a concise summary of what needs attention.",
            context,
        )
        event = PendingSummarized(captain_id=captain_id, summary_text=output.content)
        await self._publish_and_apply(event)
        return PendingSummary(
            captain_id=captain_id,
            urgent_count=0,
            strategic_count=0,
            execution_count=0,
            evolution_count=0,
            digest=output.content,
        )

    async def notify(self, event: NotificationEvent) -> NotificationResult:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="secretary", operation="notify").inc()
        domain_event = NotificationSent(
            captain_id="system",
            notification_type=event.event_type,
            content=event.content,
            severity=event.severity,
        )
        await self._publish_and_apply(domain_event)
        return NotificationResult(
            delivered=True,
            channel="terminal",
            captain_should_see=event.severity in ("warning", "critical"),
        )

    async def filter_decision(self, decision: Decision) -> FilterResult:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="secretary", operation="filter_decision").inc()
        auto_process = decision.decision_type == DecisionType.EXECUTION
        event = DecisionFiltered(
            decision_id=decision.id,
            filter_result=FilterResult(
                should_present=not auto_process,
                auto_action="auto_approve" if auto_process else None,
                reason="execution decisions can be auto-processed",
            ),
        )
        await self._publish_and_apply(event)
        return event.filter_result

    async def recommend_templates(self, description: str) -> list[PipeTemplate]:
        templates = await self._template_store.search(description) if self._template_store else []
        return [
            PipeTemplate(
                pipe_id=t.id,
                name=t.name,
                description=t.description,
                relevance_score=1.0,
                reason=f'与"{description[:20]}..."需求匹配',
            )
            for t in templates
        ]

    async def calibrate_pipe(self, pipe_id: UUID, history: list[dict]) -> PipeCalibration:
        pipe = await self._pipe_registry.get(pipe_id) if self._pipe_registry else None
        if pipe is None:
            raise ValueError(f"Pipe not found: {pipe_id}")
        from cabinet.models.pipes import ReasoningStrategy
        original = pipe.reasoning
        override_count = sum(1 for h in history if h.get("manual_override"))
        new_temp = max(0.1, original.temperature - 0.05 * override_count)
        adjusted = original.model_copy(update={"temperature": new_temp})
        changes = [f"temperature: {original.temperature} -> {new_temp}"] if new_temp != original.temperature else []
        return PipeCalibration(
            pipe_id=pipe_id,
            original_reasoning=original,
            adjusted_reasoning=adjusted,
            changes=changes,
            confidence=min(0.9, 0.5 + 0.1 * override_count),
        )

    async def generate_daily_brief(self, captain_id: str) -> DailyBrief:
        from datetime import datetime, timezone
        return DailyBrief(
            captain_id=captain_id,
            date=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            active_projects=0,
            pending_decisions=0,
            key_progress=[],
            risk_alerts=[],
            suggested_actions=[],
        )

    async def detect_cross_project_conflicts(self, captain_id: str) -> list[ConflictAlert]:
        return []
