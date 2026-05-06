from unittest.mock import AsyncMock

import pytest
from httpx import ASGITransport, AsyncClient

from cabinet.api.app import create_app


@pytest.mark.asyncio
async def test_query_knowledge_empty(app, mock_runtime):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/knowledge/query",
            json={"question": "test"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["results"] == []


@pytest.mark.asyncio
async def test_index_documents_file(app, mock_runtime, tmp_path):
    test_file = tmp_path / "test.txt"
    test_file.write_text("Hello world")

    mock_runtime.knowledge_base.index = AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/knowledge/index",
            json={"path": str(test_file)},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["indexed"] == 1


@pytest.mark.asyncio
async def test_index_documents_empty_dir(app, mock_runtime, tmp_path):
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/knowledge/index",
            json={"path": str(empty_dir)},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["indexed"] == 0


@pytest.mark.asyncio
async def test_knowledge_503_when_no_kb(mock_config):
    runtime = AsyncMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.knowledge_base = None

    app = create_app(runtime, mock_config)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/knowledge/query",
            json={"question": "test"},
        )
        assert response.status_code == 503
