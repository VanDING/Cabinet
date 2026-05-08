from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from cabinet.core.events.event_registry import register_event_type
from cabinet.rooms.secretary.models import FilterResult


class CaptainGreeted(BaseModel):
    captain_id: str
    greeting_text: str


class InputProcessed(BaseModel):
    captain_id: str
    input_text: str
    response_text: str


class PendingSummarized(BaseModel):
    captain_id: str
    summary_text: str


class NotificationSent(BaseModel):
    captain_id: str
    notification_type: str
    content: str
    severity: str


class DecisionFiltered(BaseModel):
    decision_id: UUID
    filter_result: FilterResult | None


register_event_type(CaptainGreeted)
register_event_type(InputProcessed)
register_event_type(PendingSummarized)
register_event_type(NotificationSent)
register_event_type(DecisionFiltered)
