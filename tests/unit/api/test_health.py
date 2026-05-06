from __future__ import annotations


async def test_liveness(client):
    response = await client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["version"] == "0.1.0"


async def test_readiness(client, mock_runtime):
    response = await client.get("/ready")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    mock_runtime.health_check.assert_awaited_once()
