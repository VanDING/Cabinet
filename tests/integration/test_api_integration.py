from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from cabinet.api.app import create_app
from cabinet.cli.config import CabinetConfig
from cabinet.models.primitives import Employee, Organization


@pytest.fixture
def mock_config():
    return CabinetConfig(
        organization=Organization(name="integration-test", captain_id="cap1"),
        default_project=uuid4(),
        api_token="test-secret-token",
        cors_origins=["http://localhost:3000"],
    )


@pytest.fixture
def mock_runtime():
    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.secretary = AsyncMock()
    runtime.gateway = MagicMock()
    runtime.employee_store = AsyncMock()
    runtime.tool_registry = AsyncMock()
    runtime.knowledge_base = AsyncMock()
    runtime.meeting = AsyncMock()
    runtime.decision = AsyncMock()
    runtime.office = AsyncMock()
    runtime.strategy = AsyncMock()
    runtime.summary = AsyncMock()
    return runtime


@pytest.fixture
def app(mock_runtime, mock_config):
    return create_app(mock_runtime, mock_config)


@pytest.mark.asyncio
async def test_auth_blocks_unauthenticated_request(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/config")
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_auth_allows_valid_token(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/config",
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_auth_rejects_invalid_token(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/config",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_no_token_required_when_not_configured():
    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.gateway = MagicMock()
    runtime.gateway.list_models = MagicMock(return_value=[])

    config = CabinetConfig(
        organization=Organization(name="open", captain_id="cap1"),
        default_project=uuid4(),
        api_token="",
    )
    app = create_app(runtime, config)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/config")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_employee_crud_lifecycle(app, mock_runtime):
    emp = Employee(id=uuid4(), team_id=uuid4(), name="Analyst", role="analyst", kind="ai")
    mock_runtime.employee_store.list_all = AsyncMock(return_value=[])
    mock_runtime.employee_store.add = AsyncMock()
    mock_runtime.employee_store.get = AsyncMock(return_value=emp)
    mock_runtime.employee_store.mount_skill = AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"Authorization": "Bearer test-secret-token"}

        list_resp = await client.get("/api/employees", headers=headers)
        assert list_resp.status_code == 200
        assert list_resp.json() == []

        create_resp = await client.post(
            "/api/employees",
            json={"name": "Analyst", "role": "analyst"},
            headers=headers,
        )
        assert create_resp.status_code == 200

        get_resp = await client.get(f"/api/employees/{emp.id}", headers=headers)
        assert get_resp.status_code == 200
        assert get_resp.json()["name"] == "Analyst"

        mount_resp = await client.post(
            f"/api/employees/{emp.id}/skills/{uuid4()}",
            headers=headers,
        )
        assert mount_resp.status_code == 200


@pytest.mark.asyncio
async def test_knowledge_index_then_query(app, mock_runtime):
    mock_runtime.knowledge_base.index = AsyncMock()
    mock_runtime.knowledge_base.query = AsyncMock(return_value=[])

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        headers = {"Authorization": "Bearer test-secret-token"}

        query_resp = await client.post(
            "/api/knowledge/query",
            json={"question": "What is Cabinet?"},
            headers=headers,
        )
        assert query_resp.status_code == 200
        assert query_resp.json()["results"] == []


@pytest.mark.asyncio
async def test_config_does_not_leak_secrets(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/config",
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "api_keys" not in data
        assert "api_token" not in data


@pytest.mark.asyncio
async def test_chat_to_secretary_flow(app, mock_runtime):
    from cabinet.rooms.secretary.models import SecretaryLevel, SecretaryResponse

    mock_runtime.secretary.process_input = AsyncMock(
        return_value=SecretaryResponse(message="Hello, Captain!", level=SecretaryLevel.L1)
    )

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/chat",
            json={"message": "Hello", "captain_id": "cap1"},
            headers={"Authorization": "Bearer test-secret-token"},
        )
        assert response.status_code == 200
        data = response.json()
        assert "response" in data
        assert data["captain_id"] == "cap1"
