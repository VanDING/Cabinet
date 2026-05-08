from __future__ import annotations

import uuid

import pytest

from cabinet.core.pipes.persona_registry import PersonaRegistry
from cabinet.models.pipes import Persona


@pytest.fixture
def registry():
    return PersonaRegistry()


@pytest.mark.asyncio
async def test_create_and_get(registry):
    persona = await registry.create(
        name="财务小王",
        expertise=["财务报表分析", "税务筹划"],
    )
    assert persona.name == "财务小王"
    retrieved = await registry.get(persona.id)
    assert retrieved is not None
    assert retrieved.name == "财务小王"
    assert "财务报表分析" in retrieved.expertise


@pytest.mark.asyncio
async def test_get_nonexistent(registry):
    result = await registry.get(uuid.uuid4())
    assert result is None


@pytest.mark.asyncio
async def test_update_summary(registry):
    persona = await registry.create(name="分析员", expertise=["数据分析"])
    await registry.update_summary(persona.id, {"preferred_format": "bullet_points"})
    updated = await registry.get(persona.id)
    assert updated.collaboration_summary["preferred_format"] == "bullet_points"


@pytest.mark.asyncio
async def test_update_summary_nonexistent(registry):
    with pytest.raises(ValueError, match="Persona not found"):
        await registry.update_summary(uuid.uuid4(), {"key": "value"})


@pytest.mark.asyncio
async def test_add_memory_ref(registry):
    persona = await registry.create(name="研究员", expertise=["市场研究"])
    mem_id = uuid.uuid4()
    await registry.add_memory_ref(persona.id, mem_id)
    updated = await registry.get(persona.id)
    assert mem_id in updated.memory_refs


@pytest.mark.asyncio
async def test_add_memory_ref_nonexistent(registry):
    with pytest.raises(ValueError, match="Persona not found"):
        await registry.add_memory_ref(uuid.uuid4(), uuid.uuid4())
