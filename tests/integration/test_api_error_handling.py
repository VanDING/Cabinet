from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from cabinet.api.app import create_app
from cabinet.cli.config import CabinetConfig
from cabinet.models.primitives import Organization


@pytest.fixture
def mock_config():
    return CabinetConfig(
        organization=Organization(name="error-test", captain_id="cap1"),
        default_project=uuid4(),
        api_token="test-token",
    )


@pytest.fixture
def mock_runtime():
    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.secretary = AsyncMock()
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
async def test_400_malformed_json(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/chat",
            content=b"not json",
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer test-token"},
        )
        assert response.status_code == 400


@pytest.mark.asyncio
async def test_404_nonexistent_route(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/nonexistent",
            headers={"Authorization": "Bearer test-token"},
        )
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_405_method_not_allowed(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.delete(
            "/api/config",
            headers={"Authorization": "Bearer test-token"},
        )
        assert response.status_code == 405


@pytest.mark.asyncio
async def test_413_payload_too_large(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        big_payload = "x" * (1024 * 1024 + 1)  # > 1MB
        response = await client.post(
            "/api/chat",
            content=big_payload,
            headers={"Content-Type": "application/json",
                     "Authorization": "Bearer test-token"},
        )
        assert response.status_code == 413
