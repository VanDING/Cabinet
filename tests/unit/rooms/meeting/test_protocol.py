import uuid

import pytest

from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
    DeliberationSession,
    MeetingLevel,
)
from cabinet.rooms.meeting.protocol import MeetingRoom


def test_meeting_room_protocol_runtime_checkable():
    class MockMeetingRoom:
        async def start_session(self, topic, level, participants):
            return DeliberationSession(
                project_id=uuid.uuid4(),
                topic=topic,
                level=level,
                participants=participants,
            )

        async def add_perspective(self, session_id, agent_id, content):
            from cabinet.rooms.meeting.models import Perspective
            return Perspective(session_id=session_id, agent_id=agent_id, content=content, round=1)

        async def cross_validate(self, session_id):
            return ConvergenceResult(consensus="ok", dissent=[], unresolved=[])

        async def converge(self, session_id, max_rounds=3):
            return DeliberationResult(
                session_id=session_id,
                proposal_text="proposal",
                confidence=0.8,
                reasoning_summary="summary",
                convergence=ConvergenceResult(consensus="ok", dissent=[], unresolved=[]),
                rounds_used=1,
                rumination_detected=False,
            )

        async def wake_expert(self, session_id, expert_id):
            pass

        async def close_session(self, session_id):
            convergence = ConvergenceResult(consensus="ok", dissent=[], unresolved=[])
            proposal = DeliberationResult(
                session_id=session_id,
                proposal_text="final",
                confidence=0.9,
                reasoning_summary="done",
                convergence=convergence,
                rounds_used=2,
                rumination_detected=False,
            )
            return DeliberationOutput(session_id=session_id, proposal=proposal)

    mock = MockMeetingRoom()
    assert isinstance(mock, MeetingRoom)


@pytest.mark.asyncio
async def test_meeting_room_start_session_contract():
    class MockMeetingRoom:
        async def start_session(self, topic, level, participants):
            return DeliberationSession(
                project_id=uuid.uuid4(),
                topic=topic,
                level=level,
                participants=participants,
            )

        async def add_perspective(self, session_id, agent_id, content):
            from cabinet.rooms.meeting.models import Perspective
            return Perspective(session_id=session_id, agent_id=agent_id, content=content, round=1)

        async def cross_validate(self, session_id):
            return ConvergenceResult(consensus="ok", dissent=[], unresolved=[])

        async def converge(self, session_id, max_rounds=3):
            return DeliberationResult(
                session_id=session_id,
                proposal_text="proposal",
                confidence=0.8,
                reasoning_summary="summary",
                convergence=ConvergenceResult(consensus="ok", dissent=[], unresolved=[]),
                rounds_used=1,
                rumination_detected=False,
            )

        async def wake_expert(self, session_id, expert_id):
            pass

        async def close_session(self, session_id):
            convergence = ConvergenceResult(consensus="ok", dissent=[], unresolved=[])
            proposal = DeliberationResult(
                session_id=session_id,
                proposal_text="final",
                confidence=0.9,
                reasoning_summary="done",
                convergence=convergence,
                rounds_used=2,
                rumination_detected=False,
            )
            return DeliberationOutput(session_id=session_id, proposal=proposal)

    room = MockMeetingRoom()
    participant = uuid.uuid4()
    session = await room.start_session("Test topic", MeetingLevel.MULTI_PARTY, [participant])
    assert isinstance(session, DeliberationSession)
    assert session.topic == "Test topic"


@pytest.mark.asyncio
async def test_meeting_room_converge_contract():
    class MockMeetingRoom:
        async def start_session(self, topic, level, participants):
            return DeliberationSession(
                project_id=uuid.uuid4(),
                topic=topic,
                level=level,
                participants=participants,
            )

        async def add_perspective(self, session_id, agent_id, content):
            from cabinet.rooms.meeting.models import Perspective
            return Perspective(session_id=session_id, agent_id=agent_id, content=content, round=1)

        async def cross_validate(self, session_id):
            return ConvergenceResult(consensus="ok", dissent=[], unresolved=[])

        async def converge(self, session_id, max_rounds=3):
            return DeliberationResult(
                session_id=session_id,
                proposal_text="proposal",
                confidence=0.8,
                reasoning_summary="summary",
                convergence=ConvergenceResult(consensus="ok", dissent=[], unresolved=[]),
                rounds_used=max_rounds,
                rumination_detected=False,
            )

        async def wake_expert(self, session_id, expert_id):
            pass

        async def close_session(self, session_id):
            convergence = ConvergenceResult(consensus="ok", dissent=[], unresolved=[])
            proposal = DeliberationResult(
                session_id=session_id,
                proposal_text="final",
                confidence=0.9,
                reasoning_summary="done",
                convergence=convergence,
                rounds_used=2,
                rumination_detected=False,
            )
            return DeliberationOutput(session_id=session_id, proposal=proposal)

    room = MockMeetingRoom()
    session_id = uuid.uuid4()
    result = await room.converge(session_id, max_rounds=2)
    assert isinstance(result, DeliberationResult)
    assert result.rounds_used == 2
