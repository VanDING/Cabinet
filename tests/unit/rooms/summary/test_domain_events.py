from uuid import uuid4

from cabinet.rooms.summary.domain_events import (
    AuthorizationAudited,
    DecisionTreeBuilt,
    ImprovementsSuggested,
    InsightsGenerated,
    ReviewStarted,
)
from cabinet.rooms.summary.models import ReviewType


def test_review_started_creation():
    event = ReviewStarted(
        session_id=uuid4(), project_id=uuid4(),
        review_type=ReviewType.PROJECT_REVIEW,
    )
    assert event.review_type == ReviewType.PROJECT_REVIEW


def test_insights_generated_creation():
    event = InsightsGenerated(session_id=uuid4(), insights=[])
    assert event.insights == []


def test_decision_tree_built_creation():
    event = DecisionTreeBuilt(project_id=uuid4(), tree=None)
    assert event.project_id is not None


def test_improvements_suggested_creation():
    event = ImprovementsSuggested(session_id=uuid4(), suggestions=[])
    assert event.suggestions == []


def test_authorization_audited_creation():
    event = AuthorizationAudited(captain_id="cap1", audit=None)
    assert event.captain_id == "cap1"
