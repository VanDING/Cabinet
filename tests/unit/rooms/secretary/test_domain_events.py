from uuid import uuid4

from cabinet.rooms.secretary.domain_events import (
    CaptainGreeted,
    DecisionFiltered,
    InputProcessed,
    NotificationSent,
    PendingSummarized,
)


def test_captain_greeted_creation():
    event = CaptainGreeted(captain_id="cap1", greeting_text="hello")
    assert event.captain_id == "cap1"


def test_input_processed_creation():
    event = InputProcessed(
        captain_id="cap1", input_text="hi", response_text="hello",
    )
    assert event.input_text == "hi"


def test_pending_summarized_creation():
    event = PendingSummarized(captain_id="cap1", summary_text="3 pending")
    assert event.summary_text == "3 pending"


def test_notification_sent_creation():
    event = NotificationSent(
        captain_id="cap1", notification_type="decision",
        content="approved", severity="info",
    )
    assert event.severity == "info"


def test_decision_filtered_creation():
    event = DecisionFiltered(
        decision_id=uuid4(), filter_result=None,
    )
    assert event.decision_id is not None
