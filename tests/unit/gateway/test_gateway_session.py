from __future__ import annotations

from cabinet.gateway.session import SessionStore
from cabinet.gateway.models import Platform, GatewayContext


class TestSessionStore:
    def test_get_or_create_returns_same_session(self):
        store = SessionStore()
        ctx1 = GatewayContext(captain_id="captain", source_platform=Platform.TELEGRAM)
        session1 = store.get_or_create(ctx1)
        session2 = store.get_or_create(ctx1)
        assert session1.session_id == session2.session_id

    def test_different_platforms_different_sessions(self):
        store = SessionStore()
        ctx_tg = GatewayContext(captain_id="captain", source_platform=Platform.TELEGRAM)
        ctx_dc = GatewayContext(captain_id="captain", source_platform=Platform.DISCORD)
        s_tg = store.get_or_create(ctx_tg)
        s_dc = store.get_or_create(ctx_dc)
        assert s_tg.session_id != s_dc.session_id

    def test_cross_platform_session_linking(self):
        store = SessionStore()
        ctx_tg = GatewayContext(captain_id="captain", source_platform=Platform.TELEGRAM)
        store.get_or_create(ctx_tg)
        linked = store.get_linked_session("captain")
        assert linked is not None
        assert linked.captain_id == "captain"

    def test_expire_stale_sessions(self):
        store = SessionStore(ttl_seconds=-1)
        ctx = GatewayContext(captain_id="captain", source_platform=Platform.TELEGRAM)
        store.get_or_create(ctx)
        store.expire_stale()
        assert store.get_linked_session("captain") is None
