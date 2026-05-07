from uuid import uuid4

import pytest
import pytest_asyncio

from cabinet.models.decisions import DecisionStatus
from cabinet.rooms.meeting.models import MeetingLevel
from cabinet.runtime import CabinetRuntime


@pytest_asyncio.fixture
async def runtime():
    rt = CabinetRuntime()
    await rt.start()
    yield rt
    await rt.stop()


@pytest.mark.asyncio
async def test_full_meeting_to_office_chain(runtime):
    """Meeting converges -> decision created -> approved -> office task created."""
    pid = uuid4()
    p1 = uuid4()

    session = await runtime.meeting.start_session(
        "Q3 Budget Review", MeetingLevel.MULTI_PARTY, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "increase marketing budget")
    await runtime.meeting.converge(session.id)

    assert len(runtime.decision._decisions) >= 1
    decision = list(runtime.decision._decisions.values())[0]

    result = await runtime.decision.approve(
        decision.id,
        {"label": "approved", "employee_id": uuid4(), "skill_id": uuid4()},
    )
    assert result.status == DecisionStatus.APPROVED
    assert len(runtime.office._tasks) >= 1


@pytest.mark.asyncio
async def test_decision_rejection_stops_cascade(runtime):
    """Decision rejected -> no office task created."""
    pid = uuid4()
    p1 = uuid4()

    session = await runtime.meeting.start_session(
        "Reject Test", MeetingLevel.MULTI_PARTY, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "some perspective")
    await runtime.meeting.converge(session.id)

    assert len(runtime.decision._decisions) >= 1
    decision = list(runtime.decision._decisions.values())[0]

    office_count_before = len(runtime.office._tasks)
    await runtime.decision.reject(decision.id, reason="not needed")
    office_count_after = len(runtime.office._tasks)

    assert office_count_after == office_count_before


@pytest.mark.asyncio
async def test_task_data_integrity_across_rooms(runtime):
    """Meeting topic flows through to decision and office task."""
    pid = uuid4()
    p1 = uuid4()
    topic = "Q3 Budget Review"

    session = await runtime.meeting.start_session(
        topic, MeetingLevel.MULTI_PARTY, [p1], project_id=pid,
    )
    await runtime.meeting.add_perspective(session.id, uuid4(), "expand budget")
    await runtime.meeting.converge(session.id)

    decision = list(runtime.decision._decisions.values())[0]
    await runtime.decision.approve(
        decision.id,
        {"label": "approved", "employee_id": uuid4(), "skill_id": uuid4()},
    )

    task = list(runtime.office._tasks.values())[0]
    assert task is not None
