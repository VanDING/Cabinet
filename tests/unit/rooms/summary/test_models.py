import uuid

from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    DecisionTree,
    DecisionTreeNode,
    ImprovementSuggestion,
    Insight,
    ReviewSession,
    ReviewType,
)


def test_review_type_values():
    assert ReviewType.PROJECT_REVIEW == "project_review"
    assert ReviewType.ORG_OPTIMIZATION == "org_optimization"
    assert ReviewType.CAPTAIN_INSIGHT == "captain_insight"


def test_review_session_creation():
    proj_id = uuid.uuid4()
    session = ReviewSession(
        project_id=proj_id,
        review_type=ReviewType.PROJECT_REVIEW,
    )
    assert session.status == "in_progress"
    assert session.completed_at is None


def test_review_session_completed():
    from datetime import datetime, timezone
    proj_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    session = ReviewSession(
        project_id=proj_id,
        review_type=ReviewType.ORG_OPTIMIZATION,
        status="completed",
        completed_at=now,
    )
    assert session.status == "completed"
    assert session.completed_at is not None


def test_insight_auto_applicable():
    session_id = uuid.uuid4()
    insight = Insight(
        session_id=session_id,
        insight_type="prompt_optimization",
        content="Improve the resume parsing prompt",
        confidence=0.85,
        auto_applicable=True,
        requires_captain=False,
    )
    assert insight.auto_applicable is True
    assert insight.requires_captain is False


def test_insight_requires_captain():
    session_id = uuid.uuid4()
    insight = Insight(
        session_id=session_id,
        insight_type="skill_suggestion",
        content="Consider adding email drafting skill",
        confidence=0.7,
        auto_applicable=False,
        requires_captain=True,
    )
    assert insight.auto_applicable is False
    assert insight.requires_captain is True


def test_decision_tree_node_root():
    node = DecisionTreeNode(
        node_type="root",
        label="Project Start",
    )
    assert node.node_type == "root"
    assert node.decision_id is None
    assert node.outcome is None
    assert node.children == []


def test_decision_tree_node_decision():
    decision_id = uuid.uuid4()
    child_id = uuid.uuid4()
    node = DecisionTreeNode(
        node_type="decision",
        label="Market Expansion",
        decision_id=decision_id,
        outcome="approved",
        children=[child_id],
    )
    assert node.outcome == "approved"
    assert len(node.children) == 1


def test_decision_tree():
    proj_id = uuid.uuid4()
    root = DecisionTreeNode(node_type="root", label="Start")
    child = DecisionTreeNode(node_type="decision", label="Decide", children=[])
    root.children.append(child.id)
    tree = DecisionTree(
        project_id=proj_id,
        root_node_id=root.id,
        nodes={root.id: root, child.id: child},
    )
    assert tree.root_node_id == root.id
    assert len(tree.nodes) == 2


def test_improvement_suggestion():
    session_id = uuid.uuid4()
    suggestion = ImprovementSuggestion(
        session_id=session_id,
        category="workflow",
        description="Parallelize resume screening steps",
        impact="high",
        effort="medium",
        auto_applicable=False,
    )
    assert suggestion.category == "workflow"
    assert suggestion.impact == "high"
    assert suggestion.auto_applicable is False


def test_authorization_audit():
    audit = AuthorizationAudit(
        captain_id="captain-1",
        period="2026-05",
        total_decisions=45,
        manually_approved=30,
        could_auto_process=12,
        suggestion="Consider adjusting authorization rules for execution decisions",
    )
    assert audit.total_decisions == 45
    assert audit.manually_approved == 30
    assert audit.could_auto_process == 12
    assert audit.suggestion is not None


def test_authorization_audit_no_suggestion():
    audit = AuthorizationAudit(
        captain_id="captain-1",
        period="2026-05",
        total_decisions=10,
        manually_approved=2,
        could_auto_process=0,
    )
    assert audit.suggestion is None
