from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from cabinet.api.app import create_app
from cabinet.cli.config import CabinetConfig
from cabinet.models.primitives import Organization


@pytest.mark.asyncio
async def test_get_config(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/config")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_get_models(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/config/models")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_config_requires_auth_when_token_set():
    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.gateway = MagicMock()
    runtime.gateway.list_models = MagicMock(return_value=[])

    config = CabinetConfig(
        organization=Organization(name="test", captain_id="cap1"),
        default_project=uuid4(),
        api_token="secret-token",
    )
    app = create_app(runtime, config)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/config")
        assert response.status_code == 401


@pytest.mark.asyncio
async def test_config_succeeds_with_valid_token():
    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.gateway = MagicMock()
    runtime.gateway.list_models = MagicMock(return_value=[])

    config = CabinetConfig(
        organization=Organization(name="test", captain_id="cap1"),
        default_project=uuid4(),
        api_token="secret-token",
    )
    app = create_app(runtime, config)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/config",
            headers={"Authorization": "Bearer secret-token"},
        )
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_config_rejects_wrong_token():
    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.gateway = MagicMock()
    runtime.gateway.list_models = MagicMock(return_value=[])

    config = CabinetConfig(
        organization=Organization(name="test", captain_id="cap1"),
        default_project=uuid4(),
        api_token="secret-token",
    )
    app = create_app(runtime, config)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/api/config",
            headers={"Authorization": "Bearer wrong-token"},
        )
        assert response.status_code == 401
