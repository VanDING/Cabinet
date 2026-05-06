from __future__ import annotations

from typing import Protocol, runtime_checkable

from pydantic import BaseModel


class DocumentChunk(BaseModel):
    content: str
    source: str = ""
    metadata: dict = {}


@runtime_checkable
class KnowledgeBase(Protocol):
    async def index(self, documents: list[dict]) -> None: ...
    async def query(self, question: str, top_k: int = 5) -> list[DocumentChunk]: ...
