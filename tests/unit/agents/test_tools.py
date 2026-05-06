from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.tools import ToolDefinition, ToolRegistryAdapter
from cabinet.core.tools.registry import LocalToolRegistry
from cabinet.models.primitives import SkillDefinition

_DEFAULT_IN = {"type": "object", "properties": {}}
_DEFAULT_OUT = {"type": "object", "properties": {}}


def test_tool_definition_creation():
    td = ToolDefinition(
        name="search", description="Search the knowledge base",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
    )
    assert td.name == "search"
    assert td.source == "skill"


def test_tool_definition_to_openai_schema():
    td = ToolDefinition(
        name="search", description="Search",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
    )
    schema = td.to_openai_schema()
    assert schema["type"] == "function"
    assert schema["function"]["name"] == "search"
    assert "query" in schema["function"]["parameters"]["properties"]


@pytest.mark.asyncio
async def test_tool_registry_adapter_get_definitions():
    registry = LocalToolRegistry()
    skill = SkillDefinition(
        id=uuid4(), name="search", description="Search knowledge", kind="tool",
        input_schema={"type": "object", "properties": {"query": {"type": "string"}}},
        output_schema=_DEFAULT_OUT,
    )
    await registry.register(skill)
    adapter = ToolRegistryAdapter(registry)
    defs = adapter.get_tool_definitions()
    assert len(defs) == 1
    assert defs[0].name == "search"


@pytest.mark.asyncio
async def test_tool_registry_adapter_filter_by_skill_ids():
    registry = LocalToolRegistry()
    s1 = SkillDefinition(id=uuid4(), name="search", description="Search", kind="tool", input_schema=_DEFAULT_IN, output_schema=_DEFAULT_OUT)
    s2 = SkillDefinition(id=uuid4(), name="analyze", description="Analyze", kind="tool", input_schema=_DEFAULT_IN, output_schema=_DEFAULT_OUT)
    await registry.register(s1)
    await registry.register(s2)
    adapter = ToolRegistryAdapter(registry)
    defs = adapter.get_tool_definitions(skill_ids=[s1.id])
    assert len(defs) == 1
    assert defs[0].name == "search"


@pytest.mark.asyncio
async def test_tool_registry_adapter_execute_tool():
    registry = LocalToolRegistry()
    skill = SkillDefinition(id=uuid4(), name="search", description="Search", kind="tool", input_schema=_DEFAULT_IN, output_schema=_DEFAULT_OUT)
    await registry.register(skill)
    adapter = ToolRegistryAdapter(registry)
    result = await adapter.execute_tool("search", {"query": "test"})
    assert result is not None
