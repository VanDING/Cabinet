from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from cabinet.models.pipes import Persona


def _now() -> datetime:
    return datetime.now(timezone.utc)


class PersonaRegistry:
    def __init__(self):
        self._personas: dict[UUID, Persona] = {}

    async def create(self, name: str, expertise: list[str] | None = None) -> Persona:
        persona = Persona(
            name=name,
            expertise=expertise or [],
        )
        self._personas[persona.id] = persona
        return persona

    async def get(self, persona_id: UUID) -> Persona | None:
        return self._personas.get(persona_id)

    async def update_summary(self, persona_id: UUID, delta: dict) -> None:
        persona = self._personas.get(persona_id)
        if persona is None:
            raise ValueError(f"Persona not found: {persona_id}")
        persona.collaboration_summary.update(delta)
        persona.updated_at = _now()

    async def add_memory_ref(self, persona_id: UUID, memory_id: UUID) -> None:
        persona = self._personas.get(persona_id)
        if persona is None:
            raise ValueError(f"Persona not found: {persona_id}")
        if memory_id not in persona.memory_refs:
            persona.memory_refs.append(memory_id)
        persona.updated_at = _now()
