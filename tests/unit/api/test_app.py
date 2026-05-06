import pytest
from httpx import ASGITransport, AsyncClient
from uuid import uuid4

from cabinet.api.app import create_app
from cabinet.cli.config import CabinetConfig
from cabinet.models.primitives import Organization


@pytest.fixture
def mock_runtime():
    from unittest.mock import AsyncMock

    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    return runtime


@pytest.fixture
def mock_config():
    return CabinetConfig(
        organization=Organization(name="test", captain_id="cap1"),
        default_project=uuid4(),
    )


@pytest.fixture
def app(mock_runtime, mock_config):
    return create_app(mock_runtime, mock_config)


@pytest.mark.asyncio
async def test_app_creates_successfully(app):
    assert app.title == "Cabinet API"


@pytest.mark.asyncio
async def test_openapi_docs_available(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/docs")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_openapi_json_available(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/openapi.json")
        assert response.status_code == 200
        data = response.json()
        assert data["info"]["title"] == "Cabinet API"


@pytest.mark.asyncio
async def test_app_uses_lifespan(mock_runtime, mock_config):
    app = create_app(mock_runtime, mock_config)
    assert app.router.lifespan_context is not None


@pytest.mark.asyncio
async def test_cors_headers(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/openapi.json",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


@pytest.mark.asyncio
async def test_cors_restricts_unknown_origin(mock_runtime, mock_config):
    mock_config.cors_origins = ["http://localhost:3000"]
    app = create_app(mock_runtime, mock_config)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/openapi.json",
            headers={
                "Origin": "http://evil-site.com",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers.get("access-control-allow-origin") is None


@pytest.mark.asyncio
async def test_cors_allows_configured_origin(mock_runtime, mock_config):
    mock_config.cors_origins = ["http://localhost:3000"]
    app = create_app(mock_runtime, mock_config)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/openapi.json",
            headers={
                "Origin": "http://localhost:3000",
                "Access-Control-Request-Method": "GET",
            },
        )
        assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


@pytest.mark.asyncio
async def test_generic_error_hides_detail_in_production(mock_runtime, mock_config):
    import os

    original_env = os.environ.get("CABINET_ENV")
    os.environ["CABINET_ENV"] = "production"
    try:
        from fastapi import Request
        from unittest.mock import MagicMock

        from cabinet.api.app import create_app
        app = create_app(mock_runtime, mock_config)

        mock_request = MagicMock(spec=Request)
        exc = RuntimeError("db:///secret/path")

        handler = app.exception_handlers[Exception]
        response = await handler(mock_request, exc)

        assert response.status_code == 500
        assert "secret" not in str(response.body)
        assert b"Internal server error" in response.body
    finally:
        if original_env is None:
            os.environ.pop("CABINET_ENV", None)
        else:
            os.environ["CABINET_ENV"] = original_env


@pytest.mark.asyncio
async def test_generic_error_shows_detail_in_development(mock_runtime, mock_config):
    import os

    original_env = os.environ.get("CABINET_ENV")
    os.environ["CABINET_ENV"] = "development"
    try:
        from fastapi import Request
        from unittest.mock import MagicMock

        from cabinet.api.app import create_app
        app = create_app(mock_runtime, mock_config)

        mock_request = MagicMock(spec=Request)
        exc = RuntimeError("db:///secret/path")

        handler = app.exception_handlers[Exception]
        response = await handler(mock_request, exc)

        assert response.status_code == 500
        assert b"secret" in response.body
    finally:
        if original_env is None:
            os.environ.pop("CABINET_ENV", None)
        else:
            os.environ["CABINET_ENV"] = original_env
