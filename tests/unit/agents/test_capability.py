from __future__ import annotations

import pytest
from uuid import uuid4

from cabinet.agents.capability import AgentCapability, CapabilityRegistry
from cabinet.agents.employee_store import JsonEmployeeStore
from cabinet.core.tools.registry import LocalToolRegistry


@pytest.fixture
def registry(tmp_path):
    store = JsonEmployeeStore(path=str(tmp_path / "employees.json"))
    tool_reg = LocalToolRegistry()
    return CapabilityRegistry(employee_store=store, tool_registry=tool_reg)


@pytest.mark.asyncio
async def test_register_and_get_capability(registry, tmp_path):
    await registry._employee_store.initialize()
    agent_id = uuid4()
    cap = AgentCapability(agent_id=agent_id, role="advisor", skills=["analysis"])
    await registry.register(agent_id, cap)
    found = await registry.get_capability(agent_id)
    assert found is not None
    assert found.role == "advisor"


@pytest.mark.asyncio
async def test_get_capability_not_found(registry, tmp_path):
    await registry._employee_store.initialize()
    found = await registry.get_capability(uuid4())
    assert found is None


@pytest.mark.asyncio
async def test_discover_by_role(registry, tmp_path):
    await registry._employee_store.initialize()
    a1, a2, a3 = uuid4(), uuid4(), uuid4()
    await registry.register(a1, AgentCapability(agent_id=a1, role="advisor"))
    await registry.register(a2, AgentCapability(agent_id=a2, role="executor"))
    await registry.register(a3, AgentCapability(agent_id=a3, role="advisor"))
    results = await registry.discover(query="", role="advisor")
    assert len(results) == 2


@pytest.mark.asyncio
async def test_discover_by_skill(registry, tmp_path):
    await registry._employee_store.initialize()
    a1, a2 = uuid4(), uuid4()
    await registry.register(a1, AgentCapability(agent_id=a1, role="advisor", skills=["analysis"]))
    await registry.register(a2, AgentCapability(agent_id=a2, role="executor", skills=["coding"]))
    results = await registry.discover(query="", skill="analysis")
    assert len(results) == 1


@pytest.mark.asyncio
async def test_update_load(registry, tmp_path):
    await registry._employee_store.initialize()
    agent_id = uuid4()
    await registry.register(agent_id, AgentCapability(agent_id=agent_id, role="advisor"))
    await registry.update_load(agent_id, 1)
    cap = await registry.get_capability(agent_id)
    assert cap.current_load == 1
    await registry.update_load(agent_id, -1)
    cap = await registry.get_capability(agent_id)
    assert cap.current_load == 0
