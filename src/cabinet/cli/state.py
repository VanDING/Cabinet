from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class CockpitState:
    """Reactive cockpit state for CockpitScreen."""

    mode: str = "decision"
    token_count: int = 0
    session_start: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    secretary_message: str = ""
    secretary_urgent: bool = False
    captain_id: str = ""
    api_connected: bool = True

    # Conversation
    conversation: list[dict] = field(default_factory=list)
    streaming_content: str = ""

    # Thinking chain
    thinking_steps: list[str] = field(default_factory=list)
    thinking_expanded: bool = False

    # Right panel data
    meeting_topic: str = ""
    meeting_advisors: int = 0
    meeting_round: int = 0
    decision_red: int = 0
    decision_yellow: int = 0
    decision_blue: int = 0
    office_workflow: str = ""
    office_progress: float = 0.0
    office_current_node: str = ""
