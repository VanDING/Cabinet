from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

from cabinet.gateway.models import GatewayMessage, Platform
from cabinet.gateway.router import MessageRouter
from cabinet.gateway.session import SessionStore

logger = logging.getLogger(__name__)


class GatewayProcess:
    def __init__(self, runtime=None):
        self._runtime = runtime
        self._router = MessageRouter()
        self._sessions = SessionStore()
        self._running = False
        self._cleanup_task: asyncio.Task | None = None

    async def start(self, platforms: list[str] | None = None) -> None:
        self._running = True
        platforms = platforms or []

        if "telegram" in platforms:
            from cabinet.gateway.platforms.telegram_adapter import TelegramAdapter

            token = os.getenv("CABINET_TELEGRAM_TOKEN", "")
            if token:
                tg = TelegramAdapter(token=token)
                self._router.register_adapter(Platform.TELEGRAM, tg)
                await tg.start()
                logger.info("Telegram adapter started")

        if "discord" in platforms:
            from cabinet.gateway.platforms.discord_adapter import DiscordAdapter

            token = os.getenv("CABINET_DISCORD_TOKEN", "")
            if token:
                dc = DiscordAdapter(token=token)
                self._router.register_adapter(Platform.DISCORD, dc)
                await dc.start()
                logger.info("Discord adapter started")

        self._cleanup_task = asyncio.create_task(self._cleanup_loop())
        logger.info("GatewayProcess started with platforms: %s", platforms)

    async def stop(self) -> None:
        self._running = False
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass

    async def handle_message(self, message: GatewayMessage) -> dict[str, Any]:
        route = self._router.route(message)
        return route

    async def _cleanup_loop(self) -> None:
        while self._running:
            await asyncio.sleep(300)
            expired = self._sessions.expire_stale()
            if expired > 0:
                logger.debug("Cleaned up %d expired sessions", expired)
