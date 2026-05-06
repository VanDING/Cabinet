from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.composer import TeamComposer
from cabinet.agents.capability import AgentCapability, CapabilityRegistry
from cabinet.agents.employee_store import JsonEmployeeStore
from cabinet.core.tools.registry import LocalToolRegistry


@pytest.fixture
def capability_registry(tmp_path):
    store = JsonEmployeeStore(path=str(tmp_path / "employees.json"))
    tool_reg = LocalToolRegistry()
    return CapabilityRegistry(employee_store=store, tool_registry=tool_reg)


@pytest.mark.asyncio
async def test_compose_basic_team(capability_registry, tmp_path):
    await capability_registry._employee_store.initialize()
    a1, a2 = uuid4(), uuid4()
    await capability_registry.register(a1, AgentCapability(agent_id=a1, role="advisor", skills=["analysis"]))
    await capability_registry.register(a2, AgentCapability(agent_id=a2, role="executor", skills=["coding"]))

    composer = TeamComposer(capability_registry)
    composition = await composer.compose("Build a data pipeline", required_roles=["advisor", "executor"])
    assert len(composition.members) == 2
    roles = {m.role for m in composition.members}
    assert "advisor" in roles
    assert "executor" in roles


@pytest.mark.asyncio
async def test_compose_with_skill_requirements(capability_registry, tmp_path):
    await capability_registry._employee_store.initialize()
    a1, a2 = uuid4(), uuid4()
    await capability_registry.register(a1, AgentCapability(agent_id=a1, role="advisor", skills=["analysis", "research"]))
    await capability_registry.register(a2, AgentCapability(agent_id=a2, role="executor", skills=["coding"]))

    composer = TeamComposer(capability_registry)
    composition = await composer.compose("Research task", required_skills=["research"])
    assert len(composition.members) >= 1
    assert any("research" in m.skills for m in composition.members)


@pytest.mark.asyncio
async def test_compose_no_available_agents(capability_registry, tmp_path):
    await capability_registry._employee_store.initialize()
    composer = TeamComposer(capability_registry)
    composition = await composer.compose("Task", required_roles=["nonexistent"])
    assert len(composition.members) == 0


@pytest.mark.asyncio
async def test_composition_has_leader(capability_registry, tmp_path):
    await capability_registry._employee_store.initialize()
    a1 = uuid4()
    await capability_registry.register(a1, AgentCapability(agent_id=a1, role="strategist", skills=["planning"]))

    composer = TeamComposer(capability_registry)
    composition = await composer.compose("Strategic task", required_roles=["strategist"])
    assert composition.leader_id is not None


@pytest.mark.asyncio
async def test_compose_prefers_lower_load(capability_registry, tmp_path):
    await capability_registry._employee_store.initialize()
    a1, a2 = uuid4(), uuid4()
    await capability_registry.register(a1, AgentCapability(agent_id=a1, role="advisor", skills=["analysis"], current_load=3))
    await capability_registry.register(a2, AgentCapability(agent_id=a2, role="advisor", skills=["analysis"], current_load=0))

    composer = TeamComposer(capability_registry)
    composition = await composer.compose("Analysis task", required_roles=["advisor"])
    assert len(composition.members) == 1
    assert composition.members[0].agent_id == a2
