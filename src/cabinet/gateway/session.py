from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from uuid import uuid4

from cabinet.gateway.models import GatewayContext, Platform

logger = logging.getLogger(__name__)


@dataclass
class GatewaySession:
    captain_id: str
    session_id: str = field(default_factory=lambda: uuid4().hex[:12])
    platforms: set[Platform] = field(default_factory=set)
    last_active: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        self.last_active = time.monotonic()


class SessionStore:
    def __init__(self, ttl_seconds: float = 3600.0):
        self._sessions: dict[str, GatewaySession] = {}
        self._captain_link: dict[str, str] = {}
        self._ttl = ttl_seconds

    def get_or_create(self, ctx: GatewayContext) -> GatewaySession:
        key = self._make_key(ctx)
        session = self._sessions.get(key)
        if session is None:
            session = GatewaySession(
                captain_id=ctx.captain_id,
                session_id=ctx.session_id or uuid4().hex[:12],
                platforms={ctx.source_platform},
            )
            self._sessions[key] = session
            if ctx.captain_id not in self._captain_link:
                self._captain_link[ctx.captain_id] = key
            logger.info("New session: %s for captain=%s", session.session_id, ctx.captain_id)
        session.touch()
        session.platforms.add(ctx.source_platform)
        return session

    def get_linked_session(self, captain_id: str) -> GatewaySession | None:
        key = self._captain_link.get(captain_id)
        if key is None:
            return None
        return self._sessions.get(key)

    def expire_stale(self) -> int:
        now = time.monotonic()
        stale = [
            k for k, s in self._sessions.items()
            if now - s.last_active > self._ttl
        ]
        for k in stale:
            session = self._sessions.pop(k)
            for cid, key in list(self._captain_link.items()):
                if key == k:
                    del self._captain_link[cid]
            logger.info("Expired session: %s", session.session_id)
        return len(stale)

    @staticmethod
    def _make_key(ctx: GatewayContext) -> str:
        return f"{ctx.captain_id}:{ctx.source_platform.value}"
