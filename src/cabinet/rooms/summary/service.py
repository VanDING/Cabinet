from __future__ import annotations

import logging
import re
from uuid import UUID, uuid4

from pydantic import BaseModel

from cabinet.agents.context import AgentContext
from cabinet.core.events.event_sourced import EventSourcedRoom, RoomEventStore
from cabinet.core.events.wiring import RoomEventPublisher
from cabinet.core.parsing import (
    AuditOutput,
    DecisionTreeOutput,
    InsightsOutput,
    SuggestionsOutput,
    TreeNode,
    parse_llm_json,
)
from cabinet.models.events import SummaryInsight
from cabinet.rooms.summary.domain_events import (
    AuthorizationAudited,
    DecisionTreeBuilt,
    ImprovementsSuggested,
    InsightsGenerated,
    ReviewStarted,
)
from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    DecisionTreeNode,
    ImprovementSuggestion,
    Insight,
    ReviewSession,
    ReviewType,
)

try:
    from cabinet.core.observability import ROOM_OPERATION, get_tracer

    _tracer = get_tracer("cabinet.summary")
    _OBSERVABILITY_ENABLED = True
except ImportError:
    _OBSERVABILITY_ENABLED = False

logger = logging.getLogger(__name__)


class SummaryRoomService(EventSourcedRoom):
    def __init__(
        self,
        store: RoomEventStore,
        publisher: RoomEventPublisher,
        agent_factory: object,
    ):
        super().__init__(store, publisher)
        self._agent_factory = agent_factory
        self._sessions: dict[UUID, ReviewSession] = {}
        self._insights: dict[UUID, list[Insight]] = {}
        self._trees: dict[UUID, DecisionTree] = {}
        self._suggestions: dict[UUID, list[ImprovementSuggestion]] = {}
        self._audits: dict[str, AuthorizationAudit] = {}

    def _apply_event(self, event: BaseModel) -> list[tuple[str, BaseModel, UUID | None]]:
        cross_room: list[tuple[str, BaseModel, UUID | None]] = []
        if isinstance(event, ReviewStarted):
            self._sessions[event.session_id] = ReviewSession(
                id=event.session_id,
                project_id=event.project_id,
                review_type=event.review_type,
            )
        elif isinstance(event, InsightsGenerated):
            self._insights[event.session_id] = event.insights
            for insight in event.insights:
                cross_room.append(
                    (
                        "summary.insight",
                        SummaryInsight(
                            insight_type=insight.insight_type,
                            content=insight.content,
                        ),
                        None,
                    )
                )
        elif isinstance(event, DecisionTreeBuilt):
            if event.tree is not None:
                self._trees[event.project_id] = event.tree
        elif isinstance(event, ImprovementsSuggested):
            self._suggestions[event.session_id] = event.suggestions
        elif isinstance(event, AuthorizationAudited):
            if event.audit is not None:
                self._audits[event.captain_id] = event.audit
        return cross_room

    async def start_review(self, project_id: UUID, review_type: ReviewType) -> ReviewSession:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="summary", operation="start_review").inc()
        session_id = uuid4()
        event = ReviewStarted(
            session_id=session_id,
            project_id=project_id,
            review_type=review_type,
        )
        await self._publish_and_apply(event)
        return self._sessions[session_id]

    async def generate_insights(self, session_id: UUID) -> list[Insight]:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="summary", operation="generate_insights").inc()
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")
        session = self._sessions[session_id]

        try:
            agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
            context = AgentContext(model="default", temperature=0.7)
            output = await agent.execute(
                f"Generate insights for a {session.review_type.value} review session.\n\n"
                f"Session ID: {session_id}\n"
                f"Project: {session.project_id}\n\n"
                f"Provide 2-4 insights, each with: type, content, confidence (0-1), "
                f"whether auto-applicable, and whether it requires Captain's attention.",
                context,
            )
            insights = self._parse_insights_output(output.content, session_id)
        except Exception as exc:
            logger.exception("LLM call failed in summary generate_insights: %s", exc)
            insights = [Insight(
                session_id=session_id, insight_type="error",
                content=f"Failed to generate insights: {exc}",
                confidence=0.0, auto_applicable=False, requires_captain=True,
            )]
        event = InsightsGenerated(session_id=session_id, insights=insights)
        await self._publish_and_apply(event)
        return self._insights[session_id]

    async def build_decision_tree(self, project_id: UUID) -> DecisionTree:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="summary", operation="build_decision_tree").inc()
        agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
        context = AgentContext(model="default", temperature=0.5)
        output = await agent.execute(
            f"Build a decision tree for project {project_id}.\n\n"
            f"Describe the tree structure with nodes and their relationships. "
            f"Each node should have: type (root/branch/decision/execution/anomaly/external), "
            f"label, and children.",
            context,
        )
        tree = self._parse_tree_output(output.content, project_id)
        event = DecisionTreeBuilt(project_id=project_id, tree=tree)
        await self._publish_and_apply(event)
        return self._trees.get(project_id, tree)

    async def suggest_improvements(self, session_id: UUID) -> list[ImprovementSuggestion]:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="summary", operation="suggest_improvements").inc()
        if session_id not in self._sessions:
            raise KeyError(f"session {session_id} not found")

        agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
        context = AgentContext(model="default", temperature=0.7)
        output = await agent.execute(
            f"Based on review session {session_id}, suggest improvements.\n\n"
            f"Provide 2-4 suggestions, each with: category (skill/workflow/authorization/knowledge), "
            f"description, impact (low/medium/high), effort (low/medium/high), "
            f"and whether auto-applicable.",
            context,
        )
        suggestions = self._parse_suggestions_output(output.content, session_id)
        event = ImprovementsSuggested(session_id=session_id, suggestions=suggestions)
        await self._publish_and_apply(event)
        return self._suggestions[session_id]

    async def audit_authorization_usage(self, captain_id: str) -> AuthorizationAudit:
        if _OBSERVABILITY_ENABLED:
            ROOM_OPERATION.labels(room="summary", operation="audit_authorization").inc()
        agent = await self._agent_factory.create_agent(uuid4(), "evaluator")
        context = AgentContext(model="default", temperature=0.3)
        output = await agent.execute(
            f"Audit authorization usage for Captain {captain_id}.\n\n"
            f"Analyze: 1) Total decisions made 2) How many manually approved "
            f"3) How many could have been auto-processed 4) Suggestions for improvement.",
            context,
        )
        audit = self._parse_audit_output(output.content, captain_id)
        event = AuthorizationAudited(captain_id=captain_id, audit=audit)
        await self._publish_and_apply(event)
        return self._audits.get(captain_id, audit)

    @staticmethod
    def _parse_insights_output(content: str, session_id: UUID) -> list[Insight]:
        parsed = parse_llm_json(content, InsightsOutput)
        if parsed is not None and parsed.insights:
            return [
                Insight(
                    session_id=session_id,
                    insight_type=item.insight_type,
                    content=item.content,
                    confidence=item.confidence,
                    auto_applicable=True,
                    requires_captain=False,
                )
                for item in parsed.insights
            ]
        insights = []
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                insights.append(
                    Insight(
                        session_id=session_id,
                        insight_type="observation",
                        content=line,
                        confidence=0.7,
                        auto_applicable=True,
                        requires_captain=False,
                    )
                )
        if not insights:
            insights = [
                Insight(
                    session_id=session_id,
                    insight_type="observation",
                    content="auto-generated insight",
                    confidence=0.7,
                    auto_applicable=True,
                    requires_captain=False,
                )
            ]
        return insights

    @staticmethod
    def _parse_tree_output(content: str, project_id: UUID) -> DecisionTree:
        parsed = parse_llm_json(content, DecisionTreeOutput)
        if parsed is not None and parsed.children:
            root_id = uuid4()
            nodes: dict[UUID, DecisionTreeNode] = {
                root_id: DecisionTreeNode(
                    id=root_id,
                    node_type="root",
                    label=parsed.root_label,
                ),
            }

            def _add_tree_nodes(tree_children: list[TreeNode], parent_id: UUID) -> None:
                for child in tree_children:
                    child_id = uuid4()
                    nodes[child_id] = DecisionTreeNode(
                        id=child_id,
                        node_type=child.node_type,
                        label=child.label[:100],
                    )
                    nodes[parent_id].children.append(child_id)
                    if child.children:
                        _add_tree_nodes(child.children, child_id)

            _add_tree_nodes(parsed.children, root_id)
            return DecisionTree(
                project_id=project_id,
                root_node_id=root_id,
                nodes=nodes,
            )
        root_id = uuid4()
        nodes: dict[UUID, DecisionTreeNode] = {
            root_id: DecisionTreeNode(
                id=root_id,
                node_type="root",
                label="project root",
            ),
        }
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                child_id = uuid4()
                nodes[child_id] = DecisionTreeNode(
                    id=child_id,
                    node_type="branch",
                    label=line[:100],
                )
                nodes[root_id].children.append(child_id)
        return DecisionTree(
            project_id=project_id,
            root_node_id=root_id,
            nodes=nodes,
        )

    @staticmethod
    def _parse_suggestions_output(content: str, session_id: UUID) -> list[ImprovementSuggestion]:
        parsed = parse_llm_json(content, SuggestionsOutput)
        if parsed is not None and parsed.suggestions:
            return [
                ImprovementSuggestion(
                    session_id=session_id,
                    category=item.category,
                    description=item.description[:200],
                    impact=item.impact,
                    effort=item.effort,
                    auto_applicable=True,
                )
                for item in parsed.suggestions
            ]
        suggestions = []
        for line in content.split("\n"):
            line = line.strip().lstrip("- ").lstrip("0123456789. ")
            if line:
                suggestions.append(
                    ImprovementSuggestion(
                        session_id=session_id,
                        category="workflow",
                        description=line[:200],
                        impact="medium",
                        effort="low",
                        auto_applicable=True,
                    )
                )
        if not suggestions:
            suggestions = [
                ImprovementSuggestion(
                    session_id=session_id,
                    category="workflow",
                    description="optimize pipeline",
                    impact="medium",
                    effort="low",
                    auto_applicable=True,
                )
            ]
        return suggestions

    @staticmethod
    def _parse_audit_output(content: str, captain_id: str) -> AuthorizationAudit:
        parsed = parse_llm_json(content, AuditOutput)
        if parsed is not None:
            return AuthorizationAudit(
                captain_id=captain_id,
                period="all",
                total_decisions=parsed.total_decisions,
                manually_approved=parsed.manually_approved,
                could_auto_process=parsed.could_auto_process,
                suggestion=parsed.suggestion or content[:200] if content else None,
            )
        numbers = re.findall(r"\d+", content)
        total = int(numbers[0]) if len(numbers) > 0 else 0
        manual = int(numbers[1]) if len(numbers) > 1 else 0
        auto = int(numbers[2]) if len(numbers) > 2 else 0
        return AuthorizationAudit(
            captain_id=captain_id,
            period="all",
            total_decisions=total,
            manually_approved=manual,
            could_auto_process=auto,
            suggestion=content[:200] if content else None,
        )
