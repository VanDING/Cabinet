from __future__ import annotations

import logging
from typing import Any

from cabinet.gateway.models import GatewayMessage, Platform
from cabinet.gateway.platforms.base import BasePlatformAdapter

logger = logging.getLogger(__name__)

SLASH_ROUTES: dict[str, str] = {
    "/meeting": "meeting",
    "/strategy": "strategy",
    "/decide": "decision",
    "/task": "office",
    "/review": "office",
    "/summary": "summary",
    "/status": "secretary",
    "/help": "secretary",
    "/skills": "secretary",
    "/employees": "secretary",
}


class MessageRouter:
    def __init__(self):
        self._adapters: dict[Platform, BasePlatformAdapter] = {}

    def register_adapter(self, platform: Platform, adapter: BasePlatformAdapter) -> None:
        self._adapters[platform] = adapter
        logger.info("Registered adapter for platform: %s", platform.value)

    def route(self, message: GatewayMessage) -> dict[str, Any]:
        content = message.content.strip()

        for command, room in SLASH_ROUTES.items():
            if content.startswith(command):
                payload = content[len(command):].strip()
                return {"room": room, "content": payload, "command": command}

        return {"room": "secretary", "content": content}

    async def distribute(self, message: GatewayMessage) -> None:
        platform = message.context.source_platform
        adapter = self._adapters.get(platform)
        if adapter is None:
            logger.warning("No adapter for platform: %s", platform.value)
            return
        await adapter.send_message(message)
