import pytest
from uuid import uuid4

from cabinet.agents.stub_factory import StubAgentFactory
from cabinet.core.events.event_sourced import RoomEventStore
from cabinet.models.events import StrategyDecodeResult
from cabinet.rooms.meeting.models import (
    ConvergenceResult,
    DeliberationOutput,
    DeliberationResult,
)
from cabinet.rooms.strategy.models import (
    ActionBlueprint,
    BlueprintValidation,
    DecodeContext,
)
from cabinet.rooms.strategy.service import StrategyDecoderService


class StubPublisher:
    def __init__(self):
        self.published: list[tuple[str, str, object, object]] = []

    async def publish(self, room_name: str, message_type: str,
                      payload: object, causation_id: object = None) -> None:
        self.published.append((room_name, message_type, payload, causation_id))


@pytest.fixture
def publisher():
    return StubPublisher()


@pytest.fixture
def service(publisher):
    store = RoomEventStore("strategy")
    return StrategyDecoderService(store, publisher, StubAgentFactory())


def _make_proposal() -> DeliberationOutput:
    return DeliberationOutput(
        session_id=uuid4(),
        proposal=DeliberationResult(
            session_id=uuid4(),
            proposal_text="expand market",
            confidence=0.85,
            reasoning_summary="strong signal",
            convergence=ConvergenceResult(consensus="go", dissent=[], unresolved=[]),
            rounds_used=2,
            rumination_detected=False,
        ),
    )


@pytest.mark.asyncio
async def test_decode(service, publisher):
    proposal = _make_proposal()
    context = DecodeContext(project_id=uuid4(), captain_id="cap1")
    blueprint = await service.decode(proposal, context)
    assert isinstance(blueprint, ActionBlueprint)
    assert blueprint.project_id == context.project_id
    assert len(publisher.published) == 1
    assert publisher.published[0][1] == "strategy.decode_result"
    assert isinstance(publisher.published[0][2], StrategyDecodeResult)


@pytest.mark.asyncio
async def test_validate_blueprint(service):
    proposal = _make_proposal()
    context = DecodeContext(project_id=uuid4(), captain_id="cap1")
    blueprint = await service.decode(proposal, context)
    validation = await service.validate_blueprint(blueprint)
    assert isinstance(validation, BlueprintValidation)


@pytest.mark.asyncio
async def test_restore_from_events(service, publisher):
    proposal = _make_proposal()
    context = DecodeContext(project_id=uuid4(), captain_id="cap1")
    blueprint = await service.decode(proposal, context)
    new_service = StrategyDecoderService(service._store, publisher, StubAgentFactory())
    await new_service.restore_from_events()
    assert blueprint.id in new_service._blueprints
