from __future__ import annotations

from pydantic import BaseModel

_EVENT_REGISTRY: dict[str, type[BaseModel]] = {}


def register_event_type(event_type: type[BaseModel]) -> None:
    _EVENT_REGISTRY[event_type.__name__] = event_type


def deserialize_event(type_name: str, data: str) -> BaseModel:
    cls = _EVENT_REGISTRY[type_name]
    return cls.model_validate_json(data)
