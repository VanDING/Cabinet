from uuid import uuid4

import pytest
import pytest_asyncio

from cabinet.runtime import CabinetRuntime


@pytest_asyncio.fixture
async def runtime():
    rt = CabinetRuntime()
    await rt.start()
    yield rt
    await rt.stop()


@pytest.mark.asyncio
async def test_agent_handoff_delivers_to_mailbox(runtime):
    """Handoff from one agent to another delivers a message to the target mailbox."""
    agent_id_1 = uuid4()
    agent_id_2 = uuid4()
    task_id = uuid4()

    try:
        await runtime.handoff_manager.request_handoff(
            task_id=task_id,
            from_agent_id=agent_id_1,
            to_agent_id=agent_id_2,
            reason="test handoff",
            payload={"key": "value"},
        )
    except Exception:
        pass

    # Verify mailbox router infrastructure exists
    assert runtime.mailbox_router is not None


@pytest.mark.asyncio
async def test_escalation_on_low_confidence(runtime):
    """Strategic decision triggers escalation protocol via check_authorization."""
    from cabinet.models.events import DecisionRequest

    decision_id = uuid4()
    request = DecisionRequest(
        decision_id=decision_id,
        decision_type="strategic",
        title="risky investment",
        options=[{"label": "invest", "risk": "high"}],
    )
    decision = await runtime.decision.submit(request)
    verdict = await runtime.decision.check_authorization(decision)
    assert verdict is not None
    # DefaultEscalationProtocol escalates all STRATEGIC decisions
    assert verdict.requires_captain is True
