import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import RoomEventHandler
from cabinet.models.events import DecisionResponse, MessageEnvelope, TaskOrder
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.protocol import OfficeScheduler


def test_office_handler_satisfies_protocol():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_office_handler_contract():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)
    contract = handler.contract
    assert contract.room_name == "office"
    assert "task.status_update" in contract.produces
    assert "task.failure" in contract.produces
    assert "decision.response" in contract.consumes
    assert "task.order" in contract.consumes


@pytest.mark.asyncio
async def test_office_handler_handles_task_order():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)

    order = TaskOrder(
        employee_id=uuid.uuid4(),
        skill_id=uuid.uuid4(),
        inputs={"key": "value"},
    )
    env = MessageEnvelope(
        sender="room:decision",
        recipients=["room:office"],
        message_type="task.order",
        payload=order.model_dump(),
    )
    await handler.handle(env)
    room.submit_task.assert_awaited_once()


@pytest.mark.asyncio
async def test_office_handler_handles_decision_response():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)

    emp_id = uuid.uuid4()
    skill_id = uuid.uuid4()
    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={
            "action": "approve",
            "employee_id": str(emp_id),
            "skill_id": str(skill_id),
            "inputs": {"task": "research"},
        },
        captain_id="captain-1",
    )
    env = MessageEnvelope(
        sender="room:decision",
        recipients=["room:office"],
        message_type="decision.response",
        payload=response.model_dump(),
    )
    await handler.handle(env)
    room.submit_task.assert_awaited_once()


@pytest.mark.asyncio
async def test_office_handler_ignores_unknown_event():
    room = AsyncMock(spec=OfficeScheduler)
    handler = OfficeEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:office"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.submit_task.assert_not_awaited()
