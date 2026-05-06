from __future__ import annotations

import logging
from typing import TYPE_CHECKING
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.agents.context import AgentContext
from cabinet.agents.protocol import AgentFactory
from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.core.parsing import AuthorizationCheckResult, CascadeOutput, parse_llm_json
from cabinet.models.decisions import Decision, DecisionStatus, DecisionType
from cabinet.models.events import DecisionRequest, DecisionResponse, TaskOrder
from cabinet.rooms.decision.domain_events import (
    AuthorizationRuleSet,
    DecisionApproved,
    DecisionCascaded,
    DecisionDelegated,
    DecisionRejected,
    DecisionSubmitted,
)
from cabinet.rooms.decision.models import (
    AuthorizationRule,
    AuthorizationVerdict,
    DecisionCard,
    DecisionDashboard,
)

try:
    from cabinet.core.observability import ROOM_OPERATION, get_tracer

    _tracer = get_tracer("cabinet.decision")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False

if TYPE_CHECKING:
    from cabinet.agents.handoff import HandoffManager

logger = logging.getLogger(__name__)


class DecisionRoomService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: AgentFactory,
        escalation_protocol: object | None = None,
        handoff_manager: HandoffManager | None = None,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._escalation_protocol = escalation_protocol
        self._handoff_manager = handoff_manager
        self._decisions: dict[UUID, Decision] = {}
        self._rules: dict[UUID, AuthorizationRule] = {}
        self._dashboard_cache: DecisionDashboard | None = None

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, DecisionSubmitted):
            self._dashboard_cache = None
            self._decisions[event.decision_id] = Decision(
                id=event.decision_id,
                project_id=event.project_id,
                decision_type=event.decision_type,
                title=event.title,
                description=event.description,
                options=event.options,
                captain_id=event.captain_id,
                source_event_id=event.source_event_id,
            )
        elif isinstance(event, DecisionApproved):
            self._dashboard_cache = None
            if event.decision_id in self._decisions:
                d = self._decisions[event.decision_id]
                self._decisions[event.decision_id] = d.model_copy(
                    update={
                        "status": DecisionStatus.APPROVED,
                        "chosen_option": event.chosen_option,
                    }
                )
                cross_room.append(
                    (
                        "decision.response",
                        DecisionResponse(
                            decision_id=event.decision_id,
                            chosen_option=event.chosen_option,
                            captain_id=self._decisions[event.decision_id].captain_id,
                        ),
                        None,
                    )
                )
                if "employee_id" in event.chosen_option and "skill_id" in event.chosen_option:
                    cross_room.append(
                        (
                            "task.order",
                            TaskOrder(
                                employee_id=event.chosen_option["employee_id"],
                                skill_id=event.chosen_option["skill_id"],
                                inputs=event.chosen_option.get("inputs", {}),
                            ),
                            None,
                        )
                    )
        elif isinstance(event, DecisionRejected):
            self._dashboard_cache = None
            if event.decision_id in self._decisions:
                d = self._decisions[event.decision_id]
                self._decisions[event.decision_id] = d.model_copy(
                    update={
                        "status": DecisionStatus.REJECTED,
                    }
                )
                cross_room.append(
                    (
                        "decision.response",
                        DecisionResponse(
                            decision_id=event.decision_id,
                            chosen_option={},
                            captain_id=self._decisions[event.decision_id].captain_id,
                        ),
                        None,
                    )
                )
        elif isinstance(event, DecisionDelegated):
            if event.decision_id in self._decisions:
                d = self._decisions[event.decision_id]
                self._decisions[event.decision_id] = d.model_copy(
                    update={
                        "status": DecisionStatus.DELEGATED,
                    }
                )
                cross_room.append(
                    (
                        "decision.response",
                        DecisionResponse(
                            decision_id=event.decision_id,
                            chosen_option={"delegate_to": event.delegate_to},
                            captain_id=self._decisions[event.decision_id].captain_id,
                        ),
                        None,
                    )
                )
        elif isinstance(event, AuthorizationRuleSet):
            self._rules[event.rule_id] = AuthorizationRule(
                id=event.rule_id,
                captain_id=event.captain_id,
                decision_type=event.decision_type,
                auto_approve=event.auto_approve,
                conditions=event.conditions,
            )
        elif isinstance(event, DecisionCascaded):
            for child_id in event.child_decision_ids:
                if child_id not in self._decisions:
                    self._decisions[child_id] = Decision(
                        id=child_id,
                        project_id=uuid4(),
                        decision_type=DecisionType.ANOMALY,
                        title="cascaded decision",
                        description="auto-created by cascade",
                        captain_id="system",
                    )
            if event.parent_decision_id in self._decisions:
                cross_room.append(
                    (
                        "decision.response",
                        DecisionResponse(
                            decision_id=event.parent_decision_id,
                            chosen_option={"cascaded": True},
                            captain_id=self._decisions[event.parent_decision_id].captain_id,
                        ),
                        None,
                    )
                )
        return cross_room

    async def submit(self, request: DecisionRequest) -> Decision:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="decision", operation="submit").inc()
        description = request.options if isinstance(request.options, str) else str(request.options)
        try:
            agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
            context = AgentContext(model="default", temperature=0.3)
            output = await agent.execute(
                f"Analyze this decision request and provide an enriched description.\n\n"
                f"Title: {request.title}\n"
                f"Type: {request.decision_type}\n"
                f"Options: {request.options}\n\n"
                f"Provide a detailed description of this decision, its implications, and urgency.",
                context,
            )
            description = output.content
        except Exception as exc:
            logger.exception("LLM call failed in decision submit: %s", exc)
        event = DecisionSubmitted(
            decision_id=request.decision_id,
            project_id=uuid4(),
            decision_type=DecisionType(request.decision_type),
            title=request.title,
            description=description,
            options=request.options,
            captain_id="system",
            source_event_id=None,
        )
        await self._publish_and_apply(event)
        return self._decisions[request.decision_id]

    async def approve(self, decision_id: UUID, option: dict) -> Decision:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="decision", operation="approve").inc()
        if decision_id not in self._decisions:
            raise KeyError(f"decision {decision_id} not found")
        event = DecisionApproved(decision_id=decision_id, chosen_option=option)
        await self._publish_and_apply(event)
        return self._decisions[decision_id]

    async def reject(self, decision_id: UUID, reason: str) -> Decision:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="decision", operation="reject").inc()
        if decision_id not in self._decisions:
            raise KeyError(f"decision {decision_id} not found")
        event = DecisionRejected(decision_id=decision_id, reason=reason)
        await self._publish_and_apply(event)
        return self._decisions[decision_id]

    async def delegate(self, decision_id: UUID, delegate_to: str) -> Decision:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="decision", operation="delegate").inc()
        if decision_id not in self._decisions:
            raise KeyError(f"decision {decision_id} not found")
        decision = self._decisions[decision_id]

        if self._handoff_manager is not None:
            try:
                from uuid import UUID as _UUID
                from cabinet.agents.handoff import HandoffRequest
                target_id = _UUID(delegate_to)
                request = HandoffRequest(
                    from_agent_id=decision.captain_id if isinstance(decision.captain_id, _UUID) else uuid4(),
                    to_agent_id=target_id,
                    task_description=f"Delegated decision: {decision.title}",
                    context_snapshot={
                        "decision_id": str(decision_id),
                        "decision_type": decision.decision_type.value,
                        "description": decision.description[:500],
                    },
                    reason="delegation",
                    priority="high",
                )
                response = await self._handoff_manager.request_handoff(request)
                if response and not response.accepted:
                    pass
            except (ValueError, Exception):
                pass

        event = DecisionDelegated(decision_id=decision_id, delegate_to=delegate_to)
        await self._publish_and_apply(event)
        return self._decisions[decision_id]

    async def get_dashboard(self, project_id: UUID) -> DecisionDashboard:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="decision", operation="get_dashboard").inc()
        if self._dashboard_cache is not None:
            return self._dashboard_cache
        pending = [d for d in self._decisions.values() if d.status == DecisionStatus.PENDING]
        cards = [
            DecisionCard(
                decision=d,
                urgency_color=d.urgency,
                summary=d.title,
                options_summary=[str(o) for o in d.options],
                source_room="unknown",
                created_ago="just now",
            )
            for d in pending
        ]
        if pending:
            agent = await self._agent_factory.create_agent(uuid4(), "secretary")
            context = AgentContext(model="default", temperature=0.5)
            decisions_text = "\n".join(
                f"- [{d.urgency}] {d.title}: {d.description[:100]}" for d in pending
            )
            output = await agent.execute(
                f"Summarize these pending decisions for Captain's dashboard:\n\n{decisions_text}\n\n"
                f"For each decision, provide a one-line summary and identify the source room."
                f"\n\nRespond with a JSON object:\n```json\n{{\"cards\": [{{\"summary\": \"...\", \"source_room\": \"...\"}}]}}\n```",
                context,
            )
            cards = self._build_cards_with_summary(pending, output.content)
        dashboard = DecisionDashboard(
            project_id=project_id,
            red_cards=[c for c in cards if c.urgency_color == "red"],
            yellow_cards=[c for c in cards if c.urgency_color == "yellow"],
            blue_cards=[c for c in cards if c.urgency_color == "blue"],
            white_cards=[c for c in cards if c.urgency_color == "white"],
            total_pending=len(pending),
        )
        self._dashboard_cache = dashboard
        return dashboard

    async def set_authorization(self, rule: AuthorizationRule) -> None:
        event = AuthorizationRuleSet(
            rule_id=rule.id,
            captain_id=rule.captain_id,
            decision_type=rule.decision_type,
            auto_approve=rule.auto_approve,
            conditions=rule.conditions,
        )
        await self._publish_and_apply(event)

    async def check_authorization(self, decision: Decision) -> AuthorizationVerdict:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="decision", operation="check_authorization").inc()
        for rule in self._rules.values():
            if rule.decision_type == decision.decision_type and rule.auto_approve:
                return AuthorizationVerdict(
                    auto_process=True,
                    requires_captain=False,
                    reason="matched auto-approve rule",
                    matched_rule=rule.id,
                )

        if self._escalation_protocol is not None:
            verdict = await self._escalation_protocol.should_escalate(decision)
            if verdict.escalate:
                return AuthorizationVerdict(
                    auto_process=False,
                    requires_captain=True,
                    reason=verdict.reason,
                )
            return AuthorizationVerdict(
                auto_process=True,
                requires_captain=False,
                reason=verdict.reason,
            )

        agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
        context = AgentContext(model="default", temperature=0.2)
        rules_text = "\n".join(
            f"- {rule.decision_type.value}: auto_approve={rule.auto_approve}, conditions={rule.conditions}"
            for rule in self._rules.values()
        )
        output = await agent.execute(
            f"Evaluate authorization for this decision:\n\n"
            f"Decision Type: {decision.decision_type.value}\n"
            f"Title: {decision.title}\n"
            f"Description: {decision.description}\n\n"
            f"Existing Rules:\n{rules_text if rules_text else 'No rules defined'}\n\n"
            f"Should this be auto-processed or require Captain's attention?",
            context,
        )
        parsed = parse_llm_json(output.content, AuthorizationCheckResult)
        if parsed is not None:
            auto_process = parsed.auto_process
        else:
            auto_process = (
                "auto" in output.content.lower() and "captain" not in output.content.lower()[:100]
            )
        return AuthorizationVerdict(
            auto_process=auto_process,
            requires_captain=not auto_process,
            reason=output.content[:200],
        )

    async def cascade(self, decision: Decision) -> list[Decision]:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="decision", operation="cascade").inc()
        agent = await self._agent_factory.create_agent(uuid4(), "strategist")
        context = AgentContext(model="default", temperature=0.5)
        output = await agent.execute(
            f"This decision needs to be broken down into sub-decisions:\n\n"
            f"Title: {decision.title}\n"
            f"Type: {decision.decision_type.value}\n"
            f"Description: {decision.description}\n"
            f"Options: {decision.options}\n\n"
            f"Propose 2-4 sub-decisions, each with a title and type.",
            context,
        )
        child_titles = self._parse_cascade_output(output.content)
        child_ids = [uuid4() for _ in child_titles]
        parent_id = decision.id
        self._decisions[parent_id] = decision
        event = DecisionCascaded(
            parent_decision_id=parent_id,
            child_decision_ids=child_ids,
        )
        await self._publish_and_apply(event)
        return [self._decisions[cid] for cid in child_ids]

    @staticmethod
    def _build_cards_with_summary(
        pending: list[Decision],
        summary: str,
    ) -> list[DecisionCard]:
        from cabinet.core.parsing import parse_llm_json
        from pydantic import BaseModel

        class CardSummary(BaseModel):
            summary: str = ""
            source_room: str = "decision"

        class DashboardSummary(BaseModel):
            cards: list[CardSummary] = []

        parsed = parse_llm_json(summary, DashboardSummary)
        cards = []
        for i, d in enumerate(pending):
            if parsed is not None and i < len(parsed.cards):
                card_summary = parsed.cards[i].summary or d.title
                source_room = parsed.cards[i].source_room
            else:
                lines = [ln.strip() for ln in summary.split("\n") if ln.strip()]
                card_summary = lines[i] if i < len(lines) else d.title
                source_room = "decision"
            cards.append(
                DecisionCard(
                    decision=d,
                    urgency_color=d.urgency,
                    summary=card_summary,
                    options_summary=[str(o) for o in d.options],
                    source_room=source_room,
                    created_ago="just now",
                )
            )
        return cards

    @staticmethod
    def _parse_cascade_output(content: str) -> list[str]:
        parsed = parse_llm_json(content, CascadeOutput)
        if parsed is not None and parsed.titles:
            return parsed.titles
        titles = []
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                titles.append(line[:100])
        if not titles:
            titles = ["cascaded decision"]
        return titles
