from __future__ import annotations

import logging

from cabinet.gateway.models import GatewayMessage, Platform
from cabinet.gateway.platforms.base import BasePlatformAdapter

logger = logging.getLogger(__name__)


class TelegramAdapter(BasePlatformAdapter):
    def __init__(self, token: str):
        self._token = token

    @property
    def platform(self) -> Platform:
        return Platform.TELEGRAM

    async def start(self) -> None:
        try:
            from telegram.ext import ApplicationBuilder
            self._app = ApplicationBuilder().token(self._token).build()
            logger.info("Telegram bot initialized")
        except ImportError:
            logger.warning("python-telegram-bot not installed; Telegram disabled")

    async def stop(self) -> None:
        pass

    async def send_message(self, message: GatewayMessage) -> None:
        logger.debug("Telegram send: %s", message.content[:80])
