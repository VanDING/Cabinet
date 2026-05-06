from __future__ import annotations

from typing import AsyncIterator, Protocol, runtime_checkable

from pydantic import BaseModel


class ModelResponse(BaseModel):
    content: str
    model: str
    usage: dict = {}
    tool_calls: list | None = None


class ModelChunk(BaseModel):
    content: str
    model: str


class ModelInfo(BaseModel):
    id: str
    provider: str
    context_window: int | None = None


@runtime_checkable
class ModelGateway(Protocol):
    async def complete(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> ModelResponse: ...

    async def stream(
        self, messages: list[dict], model: str, temperature: float = 0.7, **kwargs
    ) -> AsyncIterator[ModelChunk]: ...

    def list_models(self) -> list[ModelInfo]: ...
