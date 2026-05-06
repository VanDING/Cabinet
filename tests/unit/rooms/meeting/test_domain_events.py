from uuid import uuid4

from cabinet.rooms.meeting.domain_events import (
    SessionStarted,
    PerspectiveAdded,
    CrossValidationCompleted,
    ConvergenceAchieved,
    ExpertWoken,
    SessionClosed,
)
from cabinet.rooms.meeting.models import DissentItem, MeetingLevel


def test_session_started_creation():
    sid = uuid4()
    pid = uuid4()
    p1 = uuid4()
    event = SessionStarted(
        session_id=sid, project_id=pid, topic="test",
        level=MeetingLevel.MULTI_PARTY, participants=[p1],
    )
    assert event.session_id == sid
    assert event.topic == "test"
    assert event.level == MeetingLevel.MULTI_PARTY


def test_perspective_added_creation():
    event = PerspectiveAdded(
        perspective_id=uuid4(), session_id=uuid4(),
        agent_id=uuid4(), content="view", round=1,
    )
    assert event.content == "view"
    assert event.round == 1


def test_cross_validation_completed_creation():
    d = DissentItem(agent_id=uuid4(), content="no", reasoning="risk")
    event = CrossValidationCompleted(
        session_id=uuid4(), consensus="agree",
        dissent=[d], unresolved=["x"],
    )
    assert event.consensus == "agree"
    assert len(event.dissent) == 1


def test_convergence_achieved_creation():
    from cabinet.rooms.meeting.models import ConvergenceResult
    conv = ConvergenceResult(consensus="ok", dissent=[], unresolved=[])
    event = ConvergenceAchieved(
        session_id=uuid4(), proposal_text="plan",
        confidence=0.9, reasoning_summary="solid",
        convergence=conv, rounds_used=2, rumination_detected=False,
    )
    assert event.proposal_text == "plan"
    assert event.confidence == 0.9


def test_expert_woken_creation():
    event = ExpertWoken(session_id=uuid4(), expert_id=uuid4())
    assert event.expert_id is not None


def test_session_closed_creation():
    sid = uuid4()
    event = SessionClosed(session_id=sid)
    assert event.session_id == sid
