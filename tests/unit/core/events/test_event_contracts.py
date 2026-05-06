import pytest
from unittest.mock import AsyncMock

from cabinet.models.events import MessageType
from cabinet.rooms.decision.event_handler import DecisionEventHandler
from cabinet.rooms.decision.protocol import DecisionRoom
from cabinet.rooms.meeting.event_handler import MeetingEventHandler
from cabinet.rooms.office.event_handler import OfficeEventHandler
from cabinet.rooms.office.protocol import OfficeScheduler
from cabinet.rooms.secretary.event_handler import SecretaryEventHandler
from cabinet.rooms.secretary.protocol import SecretaryAgent
from cabinet.rooms.strategy.event_handler import StrategyEventHandler
from cabinet.rooms.strategy.protocol import StrategyDecoder
from cabinet.rooms.summary.event_handler import SummaryEventHandler
from cabinet.rooms.summary.protocol import SummaryRoom


@pytest.fixture(scope="module")
def all_contracts():
    contracts = []
    contracts.append(MeetingEventHandler().contract)
    contracts.append(StrategyEventHandler(AsyncMock(spec=StrategyDecoder)).contract)
    contracts.append(DecisionEventHandler(AsyncMock(spec=DecisionRoom)).contract)
    contracts.append(OfficeEventHandler(AsyncMock(spec=OfficeScheduler)).contract)
    contracts.append(SummaryEventHandler(AsyncMock(spec=SummaryRoom)).contract)
    contracts.append(SecretaryEventHandler(AsyncMock(spec=SecretaryAgent)).contract)
    return contracts


def test_all_produced_events_have_message_type(all_contracts):
    valid_types = {mt.value for mt in MessageType}
    for contract in all_contracts:
        for produced in contract.produces:
            assert produced in valid_types, (
                f"Room '{contract.room_name}' produces '{produced}' which is not in MessageType enum"
            )


def test_all_consumed_events_have_message_type(all_contracts):
    valid_types = {mt.value for mt in MessageType}
    for contract in all_contracts:
        for consumed in contract.consumes:
            assert consumed in valid_types, (
                f"Room '{contract.room_name}' consumes '{consumed}' which is not in MessageType enum"
            )


_EXTERNAL_EVENT_SOURCES = {
    "decision.request",
    "summary.review_request",
    "harness.evaluation_result",
}


def test_every_consumed_event_has_producer(all_contracts):
    all_produced = set()
    for contract in all_contracts:
        all_produced.update(contract.produces)

    for contract in all_contracts:
        for consumed in contract.consumes:
            assert consumed in all_produced or consumed in _EXTERNAL_EVENT_SOURCES, (
                f"Room '{contract.room_name}' consumes '{consumed}' but no room produces it"
            )


def test_room_names_are_unique(all_contracts):
    names = [c.room_name for c in all_contracts]
    assert len(names) == len(set(names)), f"Duplicate room names: {names}"


def test_six_rooms_registered(all_contracts):
    assert len(all_contracts) == 6
