from __future__ import annotations

from uuid import UUID

from cabinet.models.pipes import Pipe


class PipeRegistry:
    def __init__(self):
        self._pipes: dict[UUID, Pipe] = {}

    async def register(self, pipe: Pipe) -> Pipe:
        self._pipes[pipe.id] = pipe
        return pipe

    async def list(self) -> list[Pipe]:
        return list(self._pipes.values())

    async def get(self, pipe_id: UUID) -> Pipe | None:
        return self._pipes.get(pipe_id)

    async def import_from_dict(self, data: dict) -> Pipe:
        pipe_data = data["pipe"]
        pipe = Pipe(**pipe_data)
        await self.register(pipe)
        return pipe
