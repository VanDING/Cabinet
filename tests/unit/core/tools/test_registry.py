import uuid

import pytest

from cabinet.core.tools.protocol import ToolRegistry
from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.models.primitives import SkillDefinition


@pytest.fixture
async def registry():
    r = LocalToolRegistry()
    return r


def test_registry_satisfies_protocol(registry):
    assert isinstance(registry, ToolRegistry)


@pytest.mark.asyncio
async def test_register_and_list(registry):
    skill = SkillDefinition(
        name="test_skill",
        description="A test skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)
    skills = await registry.list_skills()
    assert len(skills) == 1
    assert skills[0].name == "test_skill"


@pytest.mark.asyncio
async def test_get_skill_by_id(registry):
    skill = SkillDefinition(
        name="test_skill",
        description="A test skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)
    found = await registry.get_skill(skill.id)
    assert found is not None
    assert found.name == "test_skill"


@pytest.mark.asyncio
async def test_get_skill_not_found(registry):
    result = await registry.get_skill(uuid.uuid4())
    assert result is None


@pytest.mark.asyncio
async def test_execute_skill(registry):
    skill = SkillDefinition(
        name="test_skill",
        description="A test skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)
    output = await registry.execute("test_skill", {"key": "value"})
    assert output.skill_id == skill.id


@pytest.mark.asyncio
async def test_execute_skill_not_found(registry):
    with pytest.raises(ValueError, match="Skill not found"):
        await registry.execute("nonexistent", {})


@pytest.mark.asyncio
async def test_execute_with_executor_delegates():
    from unittest.mock import AsyncMock

    from cabinet.agents.context import SkillOutput as ExecSkillOutput

    registry = LocalToolRegistry()
    mock_executor = AsyncMock()
    mock_executor.run.return_value = ExecSkillOutput(content="AI result", skill_id=uuid.uuid4())

    skill = SkillDefinition(
        name="ai_skill",
        description="An AI skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        prompt_template="Process: {input}",
    )
    await registry.register(skill)
    registry.set_executor(mock_executor)

    output = await registry.execute("ai_skill", {"input": "test"})
    assert output.content == "AI result"
    mock_executor.run.assert_called_once()


@pytest.mark.asyncio
async def test_execute_without_executor_returns_placeholder():
    registry = LocalToolRegistry()
    skill = SkillDefinition(
        name="placeholder_skill",
        description="A placeholder skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
        prompt_template="Process: {input}",
    )
    await registry.register(skill)

    output = await registry.execute("placeholder_skill", {"input": "test"})
    assert output.content == "Executed placeholder_skill"


@pytest.mark.asyncio
async def test_execute_no_prompt_without_executor_returns_placeholder():
    registry = LocalToolRegistry()
    skill = SkillDefinition(
        name="tool_skill",
        description="A tool skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)

    output = await registry.execute("tool_skill", {"key": "value"})
    assert output.content == "Executed tool_skill"


@pytest.mark.asyncio
async def test_set_mcp_connector():
    from unittest.mock import AsyncMock

    from cabinet.core.tools.mcp_connector import MCPConnector

    registry = LocalToolRegistry()
    connector = AsyncMock(spec=MCPConnector)
    registry.set_mcp_connector(connector)
    assert registry._mcp_connector is connector


@pytest.mark.asyncio
async def test_execute_mcp_skill_delegates_to_connector():
    from unittest.mock import AsyncMock

    from cabinet.core.tools.mcp_connector import MCPConnector

    registry = LocalToolRegistry()
    connector = AsyncMock(spec=MCPConnector)
    connector.call_tool = AsyncMock(return_value={"content": "MCP result"})
    registry.set_mcp_connector(connector)

    skill = SkillDefinition(
        name="mcp_tool",
        description="An MCP tool",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)
    registry._mcp_skill_names.add("mcp_tool")

    output = await registry.execute("mcp_tool", {"arg": "value"})
    assert output.content == "MCP result"
    connector.call_tool.assert_called_once_with("mcp_tool", {"arg": "value"})


@pytest.mark.asyncio
async def test_execute_local_skill_does_not_delegate_to_mcp():
    from unittest.mock import AsyncMock

    from cabinet.core.tools.mcp_connector import MCPConnector

    registry = LocalToolRegistry()
    connector = AsyncMock(spec=MCPConnector)
    connector.call_tool = AsyncMock(return_value={"content": "should not be called"})
    registry.set_mcp_connector(connector)

    skill = SkillDefinition(
        name="local_skill",
        description="A local skill",
        kind="atomic",
        input_schema={"type": "object"},
        output_schema={"type": "object"},
    )
    await registry.register(skill)

    output = await registry.execute("local_skill", {"key": "value"})
    assert output.content == "Executed local_skill"
    connector.call_tool.assert_not_called()
