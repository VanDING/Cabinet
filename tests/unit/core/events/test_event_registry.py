import pytest
from pydantic import BaseModel
from uuid import UUID, uuid4

from cabinet.core.events.event_registry import deserialize_event, register_event_type


class SampleEvent(BaseModel):
    item_id: UUID
    name: str


def test_register_and_deserialize():
    register_event_type(SampleEvent)
    event = SampleEvent(item_id=uuid4(), name="test")
    data = event.model_dump_json()
    restored = deserialize_event("SampleEvent", data)
    assert isinstance(restored, SampleEvent)
    assert restored.name == "test"
    assert restored.item_id == event.item_id


def test_deserialize_unknown_type_raises():
    with pytest.raises(KeyError):
        deserialize_event("NonExistentEvent", "{}")
