from __future__ import annotations

from cabinet.gateway.models import GatewayMessage, GatewayContext, Platform
from cabinet.gateway.platforms.base import BasePlatformAdapter
from cabinet.gateway.router import MessageRouter


class _FakeAdapter(BasePlatformAdapter):
    def __init__(self):
        self.sent: list[GatewayMessage] = []

    @property
    def platform(self) -> Platform:
        return Platform.TELEGRAM

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        pass

    async def send_message(self, message: GatewayMessage) -> None:
        self.sent.append(message)


def test_router_routes_message_to_room():
    router = MessageRouter()
    ctx = GatewayContext(
        captain_id="captain",
        session_id="s1",
        source_platform=Platform.TELEGRAM,
    )
    msg = GatewayMessage(content="/meeting Q3 Strategy", context=ctx)
    result = router.route(msg)
    assert result["room"] == "meeting"
    assert result["content"] == "Q3 Strategy"


def test_router_routes_decision():
    router = MessageRouter()
    ctx = GatewayContext(captain_id="captain", session_id="s1", source_platform=Platform.CLI)
    msg = GatewayMessage(content="/decide Approve budget", context=ctx)
    result = router.route(msg)
    assert result["room"] == "decision"


def test_router_routes_task():
    router = MessageRouter()
    ctx = GatewayContext(captain_id="captain", session_id="s1", source_platform=Platform.DISCORD)
    msg = GatewayMessage(content="/task Prepare report", context=ctx)
    result = router.route(msg)
    assert result["room"] == "office"


def test_router_routes_plain_text_to_secretary():
    router = MessageRouter()
    ctx = GatewayContext(captain_id="captain", session_id="s1", source_platform=Platform.TELEGRAM)
    msg = GatewayMessage(content="Hello, how are you?", context=ctx)
    result = router.route(msg)
    assert result["room"] == "secretary"


def test_router_distributes_response_to_source_platform():
    router = MessageRouter()
    telegram_adapter = _FakeAdapter()
    discord_adapter = _FakeAdapter()
    router.register_adapter(Platform.TELEGRAM, telegram_adapter)
    router.register_adapter(Platform.DISCORD, discord_adapter)

    ctx = GatewayContext(captain_id="captain", session_id="s1", source_platform=Platform.TELEGRAM)
    response = GatewayMessage(content="Here is the meeting summary", context=ctx)

    import asyncio
    asyncio.run(router.distribute(response))
    assert len(telegram_adapter.sent) == 1
    assert len(discord_adapter.sent) == 0
