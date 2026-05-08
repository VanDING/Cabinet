from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel

from cabinet.core.events.event_registry import register_event_type


class BlueprintDecoded(BaseModel):
    blueprint_id: UUID
    proposal_session_id: UUID
    action_domains: list[str]
    constraints: list[str]
    success_criteria: list[str]


class BlueprintValidated(BaseModel):
    blueprint_id: UUID
    is_valid: bool
    validation_notes: list[str]


register_event_type(BlueprintDecoded)
register_event_type(BlueprintValidated)
