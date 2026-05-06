from __future__ import annotations

from unittest.mock import AsyncMock
from uuid import uuid4


async def test_agent_pool_status(client):
    response = await client.get("/api/agents/pool/status")
    assert response.status_code == 200
    data = response.json()
    assert "total" in data


async def test_agent_discover(client, mock_runtime):
    response = await client.post("/api/agents/discover", json={"role": "executor"})
    assert response.status_code == 200
    data = response.json()
    assert "agents" in data
    mock_runtime.capability_registry.discover.assert_awaited_once()


async def test_agent_compose_team(client, mock_runtime):
    mock_runtime.capability_registry.discover = AsyncMock(return_value=[])
    response = await client.post("/api/agents/compose-team", json={
        "task": "analyze data", "required_roles": ["executor"],
    })
    assert response.status_code == 200


async def test_agent_handoff_invalid_uuid(client):
    response = await client.post("/api/agents/handoff", json={
        "from_agent_id": "not-a-uuid",
        "to_agent_id": str(uuid4()),
        "task_description": "test",
    })
    assert response.status_code == 400


async def test_agent_mailbox_status(client, mock_runtime):
    agent_id = str(uuid4())
    response = await client.get(f"/api/agents/mailbox/{agent_id}")
    assert response.status_code == 200
