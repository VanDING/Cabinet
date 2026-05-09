import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.events.wiring import RoomEventHandler
from cabinet.models.events import (
    DecisionResponse,
    HarnessEvaluationResult,
    MessageEnvelope,
    SummaryReviewRequest,
    TaskStatusUpdate,
)
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.protocol import SummaryRoom


def test_summary_handler_satisfies_protocol():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)
    assert isinstance(handler, RoomEventHandler)


def test_summary_handler_contract():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)
    contract = handler.contract
    assert contract.room_name == "summary"
    assert "summary.insight" in contract.produces
    assert "decision.response" in contract.consumes
    assert "task.status_update" in contract.consumes
    assert "summary.review_request" in contract.consumes
    assert "harness.evaluation_result" in contract.consumes


@pytest.mark.asyncio
async def test_summary_handler_handles_review_request():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    request = SummaryReviewRequest(
        project_id=uuid.uuid4(),
        review_type="project_review",
    )
    env = MessageEnvelope(
        sender="timer:system",
        recipients=["room:summary"],
        message_type="summary.review_request",
        payload=request.model_dump(),
    )
    await handler.handle(env)
    room.start_review.assert_awaited_once()


@pytest.mark.asyncio
async def test_summary_handler_handles_decision_response():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    response = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    env = MessageEnvelope(
        sender="room:decision",
        recipients=["room:summary"],
        message_type="decision.response",
        payload=response.model_dump(),
    )
    await handler.handle(env)
    room.start_review.assert_awaited_once()


@pytest.mark.asyncio
async def test_summary_handler_handles_task_status_update():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    update = TaskStatusUpdate(
        task_id=uuid.uuid4(),
        status="completed",
        progress=1.0,
    )
    env = MessageEnvelope(
        sender="room:office",
        recipients=["room:summary"],
        message_type="task.status_update",
        payload=update.model_dump(),
    )
    await handler.handle(env)
    room.generate_insights.assert_awaited_once()


@pytest.mark.asyncio
async def test_summary_handler_handles_evaluation_result():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    result = HarnessEvaluationResult(
        passed=True,
        evaluator_id=uuid.uuid4(),
        notes="All checks passed",
    )
    env = MessageEnvelope(
        sender="harness:evaluator",
        recipients=["room:summary"],
        message_type="harness.evaluation_result",
        payload=result.model_dump(),
    )
    await handler.handle(env)
    room.generate_insights.assert_awaited_once()


@pytest.mark.asyncio
async def test_summary_handler_ignores_unknown_event():
    room = AsyncMock(spec=SummaryRoom)
    handler = SummaryEventHandler(room)

    env = MessageEnvelope(
        sender="room:external",
        recipients=["room:summary"],
        message_type="unknown.event",
        payload={},
    )
    await handler.handle(env)
    room.start_review.assert_not_awaited()
    room.generate_insights.assert_not_awaited()


@pytest.mark.asyncio
async def test_handles_decision_created_l3():
    mock_room = AsyncMock()
    handler = SummaryEventHandler(mock_room)
    decision_id = str(uuid.uuid4())
    envelope = MessageEnvelope(
        sender="decision",
        recipients=["summary"],
        message_type="decision.created",
        payload={
            "decision_id": decision_id,
            "urgency": "red",
            "decision_type": "strategic",
        },
    )
    await handler.handle(envelope)
    mock_room.rehearse_decision.assert_called_once()


@pytest.mark.asyncio
async def test_handles_project_created():
    mock_room = AsyncMock()
    handler = SummaryEventHandler(mock_room)
    envelope = MessageEnvelope(
        sender="project",
        recipients=["summary"],
        message_type="project.created",
        payload={"description": "新数据分析项目"},
    )
    await handler.handle(envelope)
    mock_room.retrieve_organizational_memory.assert_called_once_with("新数据分析项目")


@pytest.mark.asyncio
async def test_handles_audit_request():
    mock_room = AsyncMock()
    handler = SummaryEventHandler(mock_room)
    envelope = MessageEnvelope(
        sender="secretary",
        recipients=["summary"],
        message_type="summary.audit_request",
        payload={"captain_id": "captain-1", "period": "2026-Q1"},
    )
    await handler.handle(envelope)
    mock_room.audit_autonomous_decisions.assert_called_once_with("captain-1", "2026-Q1")
