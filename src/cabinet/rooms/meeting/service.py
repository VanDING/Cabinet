from __future__ import annotations

import logging
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.agents.context import AgentContext
from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.models.events import DeliberationDissent, DeliberationProposal
from cabinet.rooms.meeting.domain_events import (
    ConvergenceAchieved,
    CrossValidationCompleted,
    ExpertWoken,
    PerspectiveAdded,
    SessionClosed,
    SessionStarted,
)
from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
    DeliberationSession,
    DissentItem,
    MeetingLevel,
    Perspective,
)

try:
    from cabinet.core.observability import ROOM_OPERATION, get_tracer

    _tracer = get_tracer("cabinet.meeting")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False

logger = logging.getLogger(__name__)


class MeetingRoomService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._sessions: dict[UUID, DeliberationSession] = {}
        self._perspectives: dict[UUID, list[Perspective]] = {}
        self._convergences: dict[UUID, ConvergenceResult] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, SessionStarted):
            self._sessions[event.session_id] = DeliberationSession(
                id=event.session_id,
                project_id=event.project_id,
                topic=event.topic,
                level=event.level,
                participants=event.participants,
            )
        elif isinstance(event, PerspectiveAdded):
            sid = event.session_id
            if sid not in self._perspectives:
                self._perspectives[sid] = []
            self._perspectives[sid].append(
                Perspective(
                    id=event.perspective_id,
                    session_id=sid,
                    agent_id=event.agent_id,
                    content=event.content,
                    round=event.round,
                )
            )
        elif isinstance(event, CrossValidationCompleted):
            self._convergences[event.session_id] = ConvergenceResult(
                consensus=event.consensus,
                dissent=event.dissent,
                unresolved=event.unresolved,
            )
            if event.dissent:
                cross_room.append(
                    (
                        "deliberation.dissent",
                        DeliberationDissent(
                            dissent_text=event.dissent[0].content,
                            source_agent_id=event.dissent[0].agent_id,
                        ),
                        None,
                    )
                )
        elif isinstance(event, ConvergenceAchieved):
            self._convergences[event.session_id] = ConvergenceResult(
                consensus=event.convergence.consensus,
                dissent=event.convergence.dissent,
                unresolved=event.convergence.unresolved,
            )
            cross_room.append(
                (
                    "deliberation.proposal",
                    DeliberationProposal(
                        proposal_text=event.proposal_text,
                        confidence=event.confidence,
                        reasoning_summary=event.reasoning_summary,
                    ),
                    None,
                )
            )
        elif isinstance(event, ExpertWoken):
            if event.session_id in self._sessions:
                session = self._sessions[event.session_id]
                if event.expert_id not in session.experts:
                    session.experts.append(event.expert_id)
        elif isinstance(event, SessionClosed):
            if event.session_id in self._sessions:
                self._sessions[event.session_id].status = "closed"
        return cross_room

    async def start_session(
        self,
        topic: str,
        level: MeetingLevel,
        participants: list[UUID],
        project_id: UUID | None = None,
    ) -> DeliberationSession:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="meeting", operation="start_session").inc()
        if not topic:
            raise ValueError("topic must not be empty")
        if not participants:
            raise ValueError("participants must not be empty")
        session_id = uuid4()
        pid = project_id or uuid4()
        event = SessionStarted(
            session_id=session_id,
            project_id=pid,
            topic=topic,
            level=level,
            participants=participants,
        )
        await self._publish_and_apply(event)
        return self._sessions[session_id]

    async def add_perspective(
        self,
        session_id: UUID,
        agent_id: UUID,
        content: str | None = None,
    ) -> Perspective:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")

        if content is None:
            try:
                agent = await self._agent_factory.create_agent(agent_id, "advisor")
                session = self._sessions[session_id]
                context = AgentContext(model="default", temperature=0.8)
                output = await agent.execute(
                    f"Analyze the following topic from your perspective:\n\n"
                    f"Topic: {session.topic}\n"
                    f"Meeting Level: {session.level}\n\n"
                    f"Provide your analysis, considering risks, opportunities, and trade-offs.",
                    context,
                )
                content = output.content
            except Exception as exc:
                logger.exception("LLM call failed in meeting add_perspective: %s", exc)
                content = f"[Error generating perspective: {exc}]"

        perspective_id = uuid4()
        session = self._sessions[session_id]
        event = PerspectiveAdded(
            perspective_id=perspective_id,
            session_id=session_id,
            agent_id=agent_id,
            content=content,
            round=session.round,
        )
        await self._publish_and_apply(event)
        return self._perspectives[session_id][-1]

    async def cross_validate(
        self,
        session_id: UUID,
        dissent_items: list[DissentItem] | None = None,
    ) -> ConvergenceResult:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="meeting", operation="cross_validate").inc()
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        dissent = dissent_items or []
        perspectives = self._perspectives.get(session_id, [])

        try:
            agent = await self._agent_factory.create_agent(uuid4(), "validator")
            context = AgentContext(model="default", temperature=0.3)
            perspectives_text = "\n".join(f"[{p.agent_id}]: {p.content}" for p in perspectives)
            output = await agent.execute(
                f"Cross-validate these perspectives:\n\n{perspectives_text}\n\n"
                f"Identify: 1) Consensus points 2) Dissent points 3) Unresolved issues",
                context,
            )
            consensus = output.content
        except Exception as exc:
            logger.exception("LLM call failed in meeting cross_validate: %s", exc)
            consensus = "[Cross-validation unavailable due to LLM error]"

        event = CrossValidationCompleted(
            session_id=session_id,
            consensus=consensus,
            dissent=dissent,
            unresolved=[] if not dissent else ["dissent unresolved"],
        )
        await self._publish_and_apply(event)
        return self._convergences[session_id]

    async def converge(
        self,
        session_id: UUID,
        max_rounds: int = 3,
    ) -> DeliberationResult:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="meeting", operation="converge").inc()
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        session = self._sessions[session_id]
        convergence = self._convergences.get(
            session_id,
            ConvergenceResult(consensus="auto", dissent=[], unresolved=[]),
        )
        perspectives = self._perspectives.get(session_id, [])

        try:
            agent = await self._agent_factory.create_agent(uuid4(), "advisor")
            context = AgentContext(model="default", temperature=0.5)
            perspectives_text = "\n".join(f"[{p.agent_id}]: {p.content}" for p in perspectives)
            output = await agent.execute(
                f"Based on these perspectives, formulate a final proposal:\n\n"
                f"{perspectives_text}\n\n"
                f"Provide a clear, actionable proposal with key recommendations.",
                context,
            )
            proposal_text = output.content
        except Exception as exc:
            logger.exception("LLM call failed in meeting converge: %s", exc)
            proposal_text = f"[Proposal generation failed: {exc}]"

        event = ConvergenceAchieved(
            session_id=session_id,
            proposal_text=proposal_text,
            confidence=0.8,
            reasoning_summary="converged",
            convergence=convergence,
            rounds_used=session.round,
            rumination_detected=False,
        )
        await self._publish_and_apply(event)
        return DeliberationResult(
            session_id=session_id,
            proposal_text=proposal_text,
            confidence=0.8,
            reasoning_summary="converged",
            convergence=convergence,
            rounds_used=session.round,
            rumination_detected=False,
        )

    async def wake_expert(self, session_id: UUID, expert_id: UUID) -> None:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        event = ExpertWoken(session_id=session_id, expert_id=expert_id)
        await self._publish_and_apply(event)

    async def close_session(self, session_id: UUID) -> DeliberationOutput:
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        session = self._sessions[session_id]
        convergence = self._convergences.get(session_id)
        proposal_text = ""
        confidence = 0.0
        reasoning_summary = ""
        if convergence:
            perspectives = self._perspectives.get(session_id, [])
            proposal_text = perspectives[0].content if perspectives else ""
            confidence = 0.8
            reasoning_summary = "converged"
        event = SessionClosed(session_id=session_id)
        await self._publish_and_apply(event)
        result = DeliberationResult(
            session_id=session_id,
            proposal_text=proposal_text,
            confidence=confidence,
            reasoning_summary=reasoning_summary,
            convergence=convergence
            or ConvergenceResult(
                consensus="",
                dissent=[],
                unresolved=[],
            ),
            rounds_used=session.round,
            rumination_detected=False,
        )
        return DeliberationOutput(session_id=session_id, proposal=result)
