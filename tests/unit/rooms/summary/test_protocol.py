import uuid

import pytest

from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    DecisionTreeNode,
    Insight,
    ReviewSession,
    ReviewType,
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

    room = MockSummaryRoom()
    audit = await room.audit_authorization_usage("captain-1")
    assert isinstance(audit, AuthorizationAudit)
    assert audit.could_auto_process == 15
    assert audit.suggestion is not None
