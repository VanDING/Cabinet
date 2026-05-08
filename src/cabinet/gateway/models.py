from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from uuid import uuid4


class Platform(str, Enum):
    CLI = "cli"
    API = "api"
    TELEGRAM = "telegram"
    DISCORD = "discord"


@dataclass
class GatewayContext:
    captain_id: str
    session_id: str = field(default_factory=lambda: uuid4().hex[:12])
    source_platform: Platform = Platform.CLI


@dataclass
class GatewayMessage:
    content: str
    context: GatewayContext
    message_id: str = field(default_factory=lambda: uuid4().hex[:16])
