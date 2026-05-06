import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from cabinet.agents.context import SkillContext
from cabinet.agents.skill_executor import SkillExecutor
from cabinet.core.tools.protocol import SkillOutput as RegistrySkillOutput
from cabinet.models.primitives import SkillDefinition


@pytest.fixture
def mock_registry():
    registry = AsyncMock()
    return registry


@pytest.fixture
def mock_gateway():
    gateway = AsyncMock()
    return gateway


@pytest.fixture
def executor(mock_registry, mock_gateway):
    return SkillExecutor(registry=mock_registry, gateway=mock_gateway)


@pytest.mark.asyncio
async def test_execute_atomic_skill(executor, mock_registry, mock_gateway):
    skill = SkillDefinition(
        name="greet",
        description="Greet someone",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        prompt_template="Say hello to {name}",
    )
    mock_registry.get_skill.return_value = skill
    mock_gateway.complete.return_value = MagicMock(content="Hello, Alice!")

    ctx = SkillContext(model="default")
    result = await executor.run(skill.id, {"name": "Alice"}, ctx)
    assert result.content == "Hello, Alice!"
    assert result.skill_id == skill.id


@pytest.mark.asyncio
async def test_execute_skill_not_found(executor, mock_registry):
    mock_registry.get_skill.return_value = None
    ctx = SkillContext(model="default")
    with pytest.raises(ValueError, match="Skill not found"):
        await executor.run(uuid.uuid4(), {}, ctx)


@pytest.mark.asyncio
async def test_execute_skill_no_prompt_template(executor, mock_registry, mock_gateway):
    skill = SkillDefinition(
        name="tool_only",
        description="A tool-only skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    mock_registry.get_skill.return_value = skill
    mock_registry.execute.return_value = RegistrySkillOutput(content="Tool result", skill_id=skill.id)

    ctx = SkillContext(model="default")
    result = await executor.run(skill.id, {"key": "value"}, ctx)
    assert result.content == "Tool result"


def test_run_sync_calls_async_run(executor, mock_registry, mock_gateway):
    skill = SkillDefinition(
        name="greet",
        description="Greet someone",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        prompt_template="Say hello to {name}",
    )
    mock_registry.get_skill.return_value = skill
    mock_gateway.complete.return_value = MagicMock(content="Hello, Bob!")

    result = executor.run_sync(skill.id, {"name": "Bob"})
    assert result.content == "Hello, Bob!"
    assert result.skill_id == skill.id


def test_run_sync_not_found(executor, mock_registry):
    mock_registry.get_skill.return_value = None
    with pytest.raises(ValueError, match="Skill not found"):
        executor.run_sync(uuid.uuid4(), {})
