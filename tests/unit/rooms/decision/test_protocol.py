import uuid

import pytest

from cabinet.models.decisions import Decision, DecisionType
from cabinet.rooms.decision.models import (
    AuthorizationVerdict,
    DecisionDashboard,
)
from cabinet.rooms.decision.protocol import DecisionRoom


def _make_decision(**kwargs):
    defaults = dict(
        project_id=uuid.uuid4(),
        decision_type=DecisionType.STRATEGIC,
        title="Test Decision",
        description="Test",
        captain_id="captain-1",
    )
    defaults.update(kwargs)
    return Decision(**defaults)


def test_decision_room_protocol_runtime_checkable():
    class MockDecisionRoom:
        async def submit(self, request):
            return _make_decision(title=request.title)

        async def approve(self, decision_id, option):
            return _make_decision(status="approved")

        async def reject(self, decision_id, reason):
            return _make_decision(status="rejected")

        async def delegate(self, decision_id, delegate_to):
            return _make_decision(status="delegated")

        async def get_dashboard(self, project_id):
            return DecisionDashboard(
                project_id=project_id,
                red_cards=[], yellow_cards=[], blue_cards=[], white_cards=[],
                total_pending=0,
            )

        async def set_authorization(self, rule):
            pass

        async def check_authorization(self, decision):
            return AuthorizationVerdict(
                auto_process=False, requires_captain=True, reason="Strategic decision"
            )

        async def cascade(self, decision):
            return []

    mock = MockDecisionRoom()
    assert isinstance(mock, DecisionRoom)


@pytest.mark.asyncio
async def test_decision_room_submit_contract():
    class MockDecisionRoom:
        async def submit(self, request):
            return _make_decision(title=request.title, decision_type=DecisionType(request.decision_type))

        async def approve(self, decision_id, option):
            return _make_decision()

        async def reject(self, decision_id, reason):
            return _make_decision()

        async def delegate(self, decision_id, delegate_to):
            return _make_decision()

        async def get_dashboard(self, project_id):
            return DecisionDashboard(project_id=project_id, red_cards=[], yellow_cards=[], blue_cards=[], white_cards=[], total_pending=0)

        async def set_authorization(self, rule):
            pass

        async def check_authorization(self, decision):
            return AuthorizationVerdict(auto_process=False, requires_captain=True, reason="test")

        async def cascade(self, decision):
            return []

    from cabinet.models.events import DecisionRequest
    room = MockDecisionRoom()
    request = DecisionRequest(
        decision_id=uuid.uuid4(),
        decision_type="strategic",
        title="Should we expand?",
    )
    decision = await room.submit(request)
    assert isinstance(decision, Decision)
    assert decision.title == "Should we expand?"


@pytest.mark.asyncio
async def test_decision_room_cascade_contract():
    class MockDecisionRoom:
        async def submit(self, request):
            return _make_decision()

        async def approve(self, decision_id, option):
            return _make_decision()

        async def reject(self, decision_id, reason):
            return _make_decision()

        async def delegate(self, decision_id, delegate_to):
            return _make_decision()

        async def get_dashboard(self, project_id):
            return DecisionDashboard(project_id=project_id, red_cards=[], yellow_cards=[], blue_cards=[], white_cards=[], total_pending=0)

        async def set_authorization(self, rule):
            pass

        async def check_authorization(self, decision):
            return AuthorizationVerdict(auto_process=False, requires_captain=True, reason="test")

        async def cascade(self, decision):
            if decision.decision_type == DecisionType.STRATEGIC:
                return [_make_decision(decision_type=DecisionType.ACTION, title="Action from strategy")]
            return []

    room = MockDecisionRoom()
    strategic = _make_decision(decision_type=DecisionType.STRATEGIC)
    cascaded = await room.cascade(strategic)
    assert len(cascaded) == 1
    assert cascaded[0].decision_type == DecisionType.ACTION
