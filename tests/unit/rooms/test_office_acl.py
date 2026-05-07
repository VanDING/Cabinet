from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.auth import (
    AccessControlList,
    ConfirmationRequired,
    Decision,
    PermissionRule,
)
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.rooms.office.models import PermissionVerdict
from cabinet.rooms.office.service import OfficeSchedulerService


@pytest.fixture
def publisher():
    class Stub:
        def __init__(self):
            self.published: list = []

        async def publish(self, room_name, message_type, payload, causation_id=None):
            self.published.append((room_name, message_type, payload, causation_id))

    return Stub()


@pytest.fixture
def acl():
    return AccessControlList(
        rules=[
            PermissionRule("captain", "*", "*", Decision.ALLOW, "captain ok", 100),
            PermissionRule("viewer", "*", "write", Decision.DENY, "viewer deny", 30),
            PermissionRule("editor", "tool:bash", "execute", Decision.ASK, "confirm", 50),
        ]
    )


@pytest.fixture
def service(publisher, acl):
    store = RoomEventStore("office")
    return OfficeSchedulerService(store, publisher, StubAgentFactory(), acl=acl)


@pytest.mark.asyncio
async def test_office_acl_allows_captain(service):
    verdict = await service.check_permission(
        uuid4(), "read", role="captain", resource="room:meeting"
    )
    assert verdict.allowed is True
    assert "captain ok" in (verdict.reason or "")


@pytest.mark.asyncio
async def test_office_acl_denies_viewer_write(service):
    verdict = await service.check_permission(
        uuid4(), "write", role="viewer", resource="room:meeting"
    )
    assert verdict.allowed is False
    assert "viewer deny" in (verdict.reason or "")


@pytest.mark.asyncio
async def test_office_acl_asks_editor_bash(service):
    with pytest.raises(ConfirmationRequired) as exc_info:
        await service.check_permission(
            uuid4(), "execute", role="editor", resource="tool:bash"
        )
    assert "confirm" in str(exc_info.value)


@pytest.mark.asyncio
async def test_office_acl_fallback_to_llm_when_no_match(service):
    verdict = await service.check_permission(
        uuid4(), "read", role="editor", resource="room:strategy"
    )
    assert isinstance(verdict, PermissionVerdict)


@pytest.mark.asyncio
async def test_office_acl_fallback_when_no_role(service):
    verdict = await service.check_permission(uuid4(), "read")
    assert isinstance(verdict, PermissionVerdict)


@pytest.mark.asyncio
async def test_office_no_acl_uses_llm(publisher):
    store = RoomEventStore("office")
    svc = OfficeSchedulerService(store, publisher, StubAgentFactory())
    verdict = await svc.check_permission(uuid4(), "read")
    assert isinstance(verdict, PermissionVerdict)
