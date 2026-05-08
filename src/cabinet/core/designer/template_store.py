from __future__ import annotations

import json
import os
from uuid import UUID

from cabinet.core.pipes.registry import PipeRegistry
from cabinet.models.pipes import Pipe


class TemplateStore:
    def __init__(self, pipe_registry: PipeRegistry):
        self._registry = pipe_registry

    async def search(self, description: str, top_k: int = 5) -> list[Pipe]:
        keywords = set(description.lower().split())
        matches: list[tuple[Pipe, int]] = []
        all_pipes = await self._registry.list()
        for pipe in all_pipes:
            score = self._relevance_score(pipe, keywords)
            if score > 0:
                matches.append((pipe, score))
        matches.sort(key=lambda x: x[1], reverse=True)
        return [m[0] for m in matches[:top_k]]

    async def load_builtin_templates(self, directory: str) -> list[UUID]:
        loaded_ids: list[UUID] = []
        if not os.path.isdir(directory):
            return loaded_ids
        for filename in os.listdir(directory):
            if not filename.endswith(".json"):
                continue
            filepath = os.path.join(directory, filename)
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                pipe = await self._registry.import_from_dict(data)
                loaded_ids.append(pipe.id)
            except Exception:
                continue
        return loaded_ids

    @staticmethod
    def _relevance_score(pipe: Pipe, keywords: set[str]) -> int:
        text = f"{pipe.name} {pipe.description} {' '.join(pipe.metadata.get('tags', []))}"
        text_lower = text.lower()
        score = 0
        for kw in keywords:
            if kw in text_lower:
                score += 1
            for word in text_lower.split():
                if kw in word or word in kw:
                    score += 0.5
        return int(score)
