from __future__ import annotations

from uuid import UUID

from cabinet.models.pipes import Pipe


class PipeRegistry:
    def __init__(self):
        self._pipes: dict[UUID, Pipe] = {}

    async def register(self, pipe: Pipe) -> None:
        self._pipes[pipe.id] = pipe

    async def get(self, pipe_id: UUID) -> Pipe | None:
        return self._pipes.get(pipe_id)

    async def list(self, kind: str | None = None) -> list[Pipe]:
        pipes = list(self._pipes.values())
        if kind is not None:
            pipes = [p for p in pipes if p.kind == kind]
        return pipes

    async def export(self, pipe_id: UUID) -> dict:
        pipe = self._pipes.get(pipe_id)
        if pipe is None:
            raise ValueError(f"Pipe not found: {pipe_id}")
        return {
            "format": "cabinet-pipe-v1",
            "pipe": {
                "name": pipe.name,
                "description": pipe.description,
                "kind": pipe.kind,
                "system_prompt": pipe.system_prompt,
                "tool_ids": [str(tid) for tid in pipe.tool_ids],
                "reasoning": pipe.reasoning.model_dump(),
                "input_schema": pipe.input_schema,
                "output_schema": pipe.output_schema,
                "metadata": pipe.metadata,
            },
        }

    async def import_from_dict(self, data: dict) -> Pipe:
        if data.get("format") != "cabinet-pipe-v1":
            raise ValueError(f"Unsupported format: {data.get('format')}")
        p = data["pipe"]
        pipe = Pipe(
            name=p["name"],
            description=p.get("description", ""),
            kind=p.get("kind", "atomic"),
            system_prompt=p.get("system_prompt", ""),
            tool_ids=[UUID(tid) if isinstance(tid, str) else tid for tid in p.get("tool_ids", [])],
            input_schema=p.get("input_schema", {}),
            output_schema=p.get("output_schema", {}),
            metadata=p.get("metadata", {}),
        )
        if "reasoning" in p:
            from cabinet.models.pipes import ReasoningStrategy
            pipe.reasoning = ReasoningStrategy(**p["reasoning"])
        await self.register(pipe)
        return pipe
