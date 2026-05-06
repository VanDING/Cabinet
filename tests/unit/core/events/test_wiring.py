import uuid

import pytest

from cabinet.core.events.asyncio_bus import AsyncIOEventBus
from cabinet.core.events.wiring import EventContract, RoomEventPublisher, RoomEventWiring
from cabinet.models.events import (
    DecisionResponse,
    DeliberationProposal,
    MessageEnvelope,
)


def test_event_contract_creation():
    contract = EventContract(
        room_name="meeting",
        produces=["deliberation.proposal", "deliberation.dissent"],
        consumes=[],
    )
    assert contract.room_name == "meeting"
    assert len(contract.produces) == 2
    assert len(contract.consumes) == 0


def test_event_contract_pure_producer():
    contract = EventContract(
        room_name="meeting",
        produces=["deliberation.proposal"],
        consumes=[],
    )
    assert contract.consumes == []
    assert "deliberation.proposal" in contract.produces


def test_event_contract_consumer():
    contract = EventContract(
        room_name="decision",
        produces=["decision.response"],
        consumes=["deliberation.proposal", "deliberation.dissent"],
    )
    assert "deliberation.proposal" in contract.consumes
    assert len(contract.produces) == 1


@pytest.fixture
def bus():
    return AsyncIOEventBus()


@pytest.fixture
def wiring(bus):
    return RoomEventWiring(bus)


def test_wiring_satisfies_publisher_protocol(wiring):
    assert isinstance(wiring, RoomEventPublisher)


@pytest.mark.asyncio
async def test_wiring_publish_creates_envelope(wiring, bus):
    received = []

    async def handler(envelope: MessageEnvelope):
        received.append(envelope)

    await bus.subscribe("deliberation.proposal", handler)

    payload = DeliberationProposal(
        proposal_text="expand market",
        confidence=0.85,
        reasoning_summary="strong signal",
    )
    await wiring.publish("meeting", "deliberation.proposal", payload)

    assert len(received) == 1
    assert received[0].sender == "room:meeting"
    assert received[0].message_type == "deliberation.proposal"
    assert received[0].payload["proposal_text"] == "expand market"


@pytest.mark.asyncio
async def test_wiring_publish_with_causation_id(wiring, bus):
    received = []

    async def handler(envelope: MessageEnvelope):
        received.append(envelope)

    await bus.subscribe("decision.response", handler)

    cause_id = uuid.uuid4()
    payload = DecisionResponse(
        decision_id=uuid.uuid4(),
        chosen_option={"action": "approve"},
        captain_id="captain-1",
    )
    await wiring.publish("decision", "decision.response", payload, causation_id=cause_id)

    assert len(received) == 1
    assert received[0].causation_id == cause_id


@pytest.mark.asyncio
async def test_wiring_register_subscribes_handler(bus):
    wiring = RoomEventWiring(bus)
    handled = []

    class FakeHandler:
        @property
        def contract(self):
            return EventContract(
                room_name="decision",
                produces=["decision.response"],
                consumes=["deliberation.proposal"],
            )

        async def handle(self, envelope: MessageEnvelope) -> None:
            handled.append(envelope)

    handler = FakeHandler()
    await wiring.register(handler)

    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "test"},
    )
    await bus.publish(env)

    assert len(handled) == 1
    assert handled[0].message_type == "deliberation.proposal"


@pytest.mark.asyncio
async def test_wiring_resolve_recipients(wiring):
    class FakeDecisionHandler:
        @property
        def contract(self):
            return EventContract(
                room_name="decision",
                produces=["decision.response"],
                consumes=["deliberation.proposal"],
            )

        async def handle(self, envelope: MessageEnvelope) -> None:
            pass

    class FakeOfficeHandler:
        @property
        def contract(self):
            return EventContract(
                room_name="office",
                produces=["task.status_update"],
                consumes=["decision.response", "task.order"],
            )

        async def handle(self, envelope: MessageEnvelope) -> None:
            pass

    await wiring.register(FakeDecisionHandler())
    await wiring.register(FakeOfficeHandler())

    recipients = wiring.resolve_recipients("deliberation.proposal")
    assert "room:decision" in recipients

    recipients = wiring.resolve_recipients("decision.response")
    assert "room:office" in recipients

    recipients = wiring.resolve_recipients("task.order")
    assert "room:office" in recipients

    recipients = wiring.resolve_recipients("unknown.event")
    assert recipients == []


@pytest.mark.asyncio
async def test_wiring_unregister_all(bus):
    wiring = RoomEventWiring(bus)
    handled = []

    class FakeHandler:
        @property
        def contract(self):
            return EventContract(
                room_name="decision",
                produces=["decision.response"],
                consumes=["deliberation.proposal"],
            )

        async def handle(self, envelope: MessageEnvelope) -> None:
            handled.append(envelope)

    handler = FakeHandler()
    await wiring.register(handler)
    assert "decision" in wiring._handlers

    await wiring.unregister_all()
    assert len(wiring._handlers) == 0

    env = MessageEnvelope(
        sender="room:meeting",
        recipients=["room:decision"],
        message_type="deliberation.proposal",
        payload={"proposal_text": "test"},
    )
    await bus.publish(env)
    assert len(handled) == 0
