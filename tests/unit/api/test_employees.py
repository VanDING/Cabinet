from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient
from uuid import uuid4

from cabinet.api.app import create_app
from cabinet.models.primitives import Employee


@pytest.mark.asyncio
async def test_list_employees_empty(app, mock_runtime):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/employees")
        assert response.status_code == 200
        assert response.json() == []


@pytest.mark.asyncio
async def test_create_employee(app, mock_runtime):
    emp = Employee(id=uuid4(), team_id=uuid4(), name="Advisor", role="advisor", kind="ai")
    mock_runtime.employee_store.add = AsyncMock()
    mock_runtime.employee_store.get = AsyncMock(return_value=emp)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/employees",
            json={"name": "Advisor", "role": "advisor"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Advisor"


@pytest.mark.asyncio
async def test_get_employee_found(app, mock_runtime):
    emp = Employee(id=uuid4(), team_id=uuid4(), name="Advisor", role="advisor", kind="ai")
    mock_runtime.employee_store.get = AsyncMock(return_value=emp)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(f"/api/employees/{emp.id}")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Advisor"


@pytest.mark.asyncio
async def test_get_employee_not_found(app, mock_runtime):
    mock_runtime.employee_store.get = AsyncMock(return_value=None)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/employees/00000000-0000-0000-0000-000000000000")
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_mount_skill(app, mock_runtime):
    mock_runtime.employee_store.mount_skill = AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/employees/00000000-0000-0000-0000-000000000000/skills/00000000-0000-0000-0000-000000000001"
        )
        assert response.status_code == 200
        assert response.json()["status"] == "ok"


@pytest.mark.asyncio
async def test_employees_503_when_no_store(mock_config):
    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.employee_store = None

    app = create_app(runtime, mock_config)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/employees")
        assert response.status_code == 503
