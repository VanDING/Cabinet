from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from uuid import uuid4


@pytest.mark.asyncio
async def test_meeting_endpoint(app, mock_runtime):
    from cabinet.rooms.meeting.models import DeliberationSession, MeetingLevel

    session = DeliberationSession(
        id=uuid4(), project_id=uuid4(), topic="growth", level=MeetingLevel.MULTI_PARTY, participants=[]
    )
    mock_runtime.meeting.start_session = AsyncMock(return_value=session)

    from cabinet.rooms.meeting.models import ConvergenceResult, DeliberationResult

    mock_runtime.meeting.converge = AsyncMock(
        return_value=DeliberationResult(
            session_id=session.id,
            proposal_text="proposal text",
            confidence=0.9,
            reasoning_summary="summary",
            convergence=ConvergenceResult(consensus="", dissent=[], unresolved=[]),
            rounds_used=1,
            rumination_detected=False,
        )
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rooms/meeting",
            json={"topic": "growth"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "session_id" in data


@pytest.mark.asyncio
async def test_decision_endpoint(app, mock_runtime):
    from cabinet.models.decisions import Decision, DecisionStatus, DecisionType

    decision = Decision(
        id=uuid4(),
        project_id=uuid4(),
        captain_id="cap1",
        title="hire",
        decision_type=DecisionType.STRATEGIC,
        status=DecisionStatus.PENDING,
        description="test decision",
        options=[],
    )
    mock_runtime.decision.submit = AsyncMock(return_value=decision)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rooms/decision",
            json={"title": "hire"},
        )
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_task_endpoint(app, mock_runtime):
    from cabinet.rooms.office.models import Task

    task = Task(
        id=uuid4(),
        project_id=uuid4(),
        employee_id=uuid4(),
        skill_id=uuid4(),
        status="queued",
        inputs={"description": "build API"},
    )
    mock_runtime.office.submit_task = AsyncMock(return_value=task)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rooms/task",
            json={"description": "build API"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "task_id" in data


@pytest.mark.asyncio
async def test_strategy_endpoint(app, mock_runtime):
    from cabinet.rooms.strategy.models import ActionBlueprint, ActionDomain

    blueprint = ActionBlueprint(
        id=uuid4(),
        project_id=uuid4(),
        source_proposal_id=uuid4(),
        domains=[ActionDomain(name="growth", goal="Expand market share")],
        execution_order=[["growth"]],
    )
    mock_runtime.strategy.decode = AsyncMock(return_value=blueprint)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rooms/strategy",
            json={"proposal": "Expand market"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "blueprint_id" in data


@pytest.mark.asyncio
async def test_review_endpoint(app, mock_runtime, mock_config):
    from cabinet.rooms.summary.models import Insight, ReviewSession, ReviewType

    session = ReviewSession(id=uuid4(), project_id=uuid4(), review_type=ReviewType.PROJECT_REVIEW)
    mock_runtime.summary.start_review = AsyncMock(return_value=session)
    mock_runtime.summary.generate_insights = AsyncMock(
        return_value=[Insight(
            session_id=session.id,
            insight_type="observation",
            content="Insight 1",
            confidence=0.9,
            auto_applicable=False,
            requires_captain=False,
        )]
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/rooms/review",
            json={"review_type": "project_review"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "session_id" in data
        assert len(data["insights"]) == 1
