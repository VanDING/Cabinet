import uuid

import pytest

from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    AutonomyAudit,
    DecisionTree,
    DecisionTreeNode,
    Insight,
    MemoryMatch,
    RehearsalReport,
    ReviewSession,
    ReviewType,
    ScenarioResult,
)
from cabinet.rooms.summary.protocol import SummaryRoom


def test_summary_room_protocol_runtime_checkable():
    class MockSummaryRoom:
        async def start_review(self, project_id, review_type):
            return ReviewSession(project_id=project_id, review_type=review_type)

        async def generate_insights(self, session_id):
            return []

        async def build_decision_tree(self, project_id):
            root = DecisionTreeNode(node_type="root", label="Start")
            return DecisionTree(project_id=project_id, root_node_id=root.id, nodes={root.id: root})

        async def suggest_improvements(self, session_id):
            return []

        async def audit_authorization_usage(self, captain_id):
            return AuthorizationAudit(
                captain_id=captain_id,
                period="2026-05",
                total_decisions=0,
                manually_approved=0,
                could_auto_process=0,
            )

        async def rehearse_decision(self, decision_id):
            optimistic = ScenarioResult(
                scenario_type="optimistic", description="optimistic",
                key_assumptions=[], expected_outcome="good", risks=[], probability=0.3,
            )
            pessimistic = ScenarioResult(
                scenario_type="pessimistic", description="pessimistic",
                key_assumptions=[], expected_outcome="bad", risks=[], probability=0.3,
            )
            baseline = ScenarioResult(
                scenario_type="baseline", description="baseline",
                key_assumptions=[], expected_outcome="ok", risks=[], probability=0.4,
            )
            return RehearsalReport(
                decision_id=decision_id,
                similar_cases=[],
                matched_risk_patterns=[],
                optimistic_scenario=optimistic,
                pessimistic_scenario=pessimistic,
                baseline_scenario=baseline,
                risk_level="medium",
                recommendations=[],
            )

        async def retrieve_organizational_memory(self, project_description):
            return []

        async def audit_autonomous_decisions(self, captain_id, period="all"):
            return AutonomyAudit(captain_id=captain_id, period=period)

    mock = MockSummaryRoom()
    assert isinstance(mock, SummaryRoom)


@pytest.mark.asyncio
async def test_summary_room_start_review_contract():
    class MockSummaryRoom:
        async def start_review(self, project_id, review_type):
            return ReviewSession(project_id=project_id, review_type=review_type)

        async def generate_insights(self, session_id):
            return []

        async def build_decision_tree(self, project_id):
            root = DecisionTreeNode(node_type="root", label="Start")
            return DecisionTree(project_id=project_id, root_node_id=root.id, nodes={root.id: root})

        async def suggest_improvements(self, session_id):
            return []

        async def audit_authorization_usage(self, captain_id):
            return AuthorizationAudit(captain_id=captain_id, period="2026-05", total_decisions=0, manually_approved=0, could_auto_process=0)

        async def rehearse_decision(self, decision_id):
            optimistic = ScenarioResult(
                scenario_type="optimistic", description="optimistic",
                key_assumptions=[], expected_outcome="good", risks=[], probability=0.3,
            )
            pessimistic = ScenarioResult(
                scenario_type="pessimistic", description="pessimistic",
                key_assumptions=[], expected_outcome="bad", risks=[], probability=0.3,
            )
            baseline = ScenarioResult(
                scenario_type="baseline", description="baseline",
                key_assumptions=[], expected_outcome="ok", risks=[], probability=0.4,
            )
            return RehearsalReport(
                decision_id=decision_id,
                similar_cases=[],
                matched_risk_patterns=[],
                optimistic_scenario=optimistic,
                pessimistic_scenario=pessimistic,
                baseline_scenario=baseline,
                risk_level="medium",
                recommendations=[],
            )

        async def retrieve_organizational_memory(self, project_description):
            return []

        async def audit_autonomous_decisions(self, captain_id, period="all"):
            return AutonomyAudit(captain_id=captain_id, period=period)

    room = MockSummaryRoom()
    proj_id = uuid.uuid4()
    session = await room.start_review(proj_id, ReviewType.PROJECT_REVIEW)
    assert isinstance(session, ReviewSession)
    assert session.review_type == ReviewType.PROJECT_REVIEW


@pytest.mark.asyncio
async def test_summary_room_generate_insights_contract():
    class MockSummaryRoom:
        async def start_review(self, project_id, review_type):
            return ReviewSession(project_id=project_id, review_type=review_type)

        async def generate_insights(self, session_id):
            return [
                Insight(
                    session_id=session_id,
                    insight_type="prompt_optimization",
                    content="Improve prompt",
                    confidence=0.8,
                    auto_applicable=True,
                    requires_captain=False,
                )
            ]

        async def build_decision_tree(self, project_id):
            root = DecisionTreeNode(node_type="root", label="Start")
            return DecisionTree(project_id=project_id, root_node_id=root.id, nodes={root.id: root})

        async def suggest_improvements(self, session_id):
            return []

        async def audit_authorization_usage(self, captain_id):
            return AuthorizationAudit(captain_id=captain_id, period="2026-05", total_decisions=0, manually_approved=0, could_auto_process=0)

        async def rehearse_decision(self, decision_id):
            optimistic = ScenarioResult(
                scenario_type="optimistic", description="optimistic",
                key_assumptions=[], expected_outcome="good", risks=[], probability=0.3,
            )
            pessimistic = ScenarioResult(
                scenario_type="pessimistic", description="pessimistic",
                key_assumptions=[], expected_outcome="bad", risks=[], probability=0.3,
            )
            baseline = ScenarioResult(
                scenario_type="baseline", description="baseline",
                key_assumptions=[], expected_outcome="ok", risks=[], probability=0.4,
            )
            return RehearsalReport(
                decision_id=decision_id,
                similar_cases=[],
                matched_risk_patterns=[],
                optimistic_scenario=optimistic,
                pessimistic_scenario=pessimistic,
                baseline_scenario=baseline,
                risk_level="medium",
                recommendations=[],
            )

        async def retrieve_organizational_memory(self, project_description):
            return []

        async def audit_autonomous_decisions(self, captain_id, period="all"):
            return AutonomyAudit(captain_id=captain_id, period=period)

    room = MockSummaryRoom()
    session_id = uuid.uuid4()
    insights = await room.generate_insights(session_id)
    assert len(insights) == 1
    assert insights[0].auto_applicable is True


@pytest.mark.asyncio
async def test_summary_room_audit_contract():
    class MockSummaryRoom:
        async def start_review(self, project_id, review_type):
            return ReviewSession(project_id=project_id, review_type=review_type)

        async def generate_insights(self, session_id):
            return []

        async def build_decision_tree(self, project_id):
            root = DecisionTreeNode(node_type="root", label="Start")
            return DecisionTree(project_id=project_id, root_node_id=root.id, nodes={root.id: root})

        async def suggest_improvements(self, session_id):
            return []

        async def audit_authorization_usage(self, captain_id):
            return AuthorizationAudit(
                captain_id=captain_id,
                period="2026-05",
                total_decisions=50,
                manually_approved=35,
                could_auto_process=15,
                suggestion="Consider adjusting authorization rules",
            )

        async def rehearse_decision(self, decision_id):
            optimistic = ScenarioResult(
                scenario_type="optimistic", description="optimistic",
                key_assumptions=[], expected_outcome="good", risks=[], probability=0.3,
            )
            pessimistic = ScenarioResult(
                scenario_type="pessimistic", description="pessimistic",
                key_assumptions=[], expected_outcome="bad", risks=[], probability=0.3,
            )
            baseline = ScenarioResult(
                scenario_type="baseline", description="baseline",
                key_assumptions=[], expected_outcome="ok", risks=[], probability=0.4,
            )
            return RehearsalReport(
                decision_id=decision_id,
                similar_cases=[],
                matched_risk_patterns=[],
                optimistic_scenario=optimistic,
                pessimistic_scenario=pessimistic,
                baseline_scenario=baseline,
                risk_level="medium",
                recommendations=[],
            )

        async def retrieve_organizational_memory(self, project_description):
            return []

        async def audit_autonomous_decisions(self, captain_id, period="all"):
            return AutonomyAudit(captain_id=captain_id, period=period)

    room = MockSummaryRoom()
    audit = await room.audit_authorization_usage("captain-1")
    assert isinstance(audit, AuthorizationAudit)
    assert audit.could_auto_process == 15
    assert audit.suggestion is not None
