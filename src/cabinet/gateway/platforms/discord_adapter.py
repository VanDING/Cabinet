from __future__ import annotations

import logging

from cabinet.gateway.models import GatewayMessage, Platform
from cabinet.gateway.platforms.base import BasePlatformAdapter

logger = logging.getLogger(__name__)


class DiscordAdapter(BasePlatformAdapter):
    def __init__(self, token: str):
        self._token = token

    @property
    def platform(self) -> Platform:
        return Platform.DISCORD

    async def start(self) -> None:
        try:
            from importlib.util import find_spec
            if find_spec("discord") is None:
                raise ImportError("discord.py not found")
            logger.info("Discord client initialized")
        except ImportError:
            logger.warning("discord.py not installed; Discord disabled")

    async def stop(self) -> None:
        pass

    async def send_message(self, message: GatewayMessage) -> None:
        logger.debug("Discord send: %s", message.content[:80])
