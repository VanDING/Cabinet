import hashlib
from unittest.mock import AsyncMock, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from cabinet.rooms.secretary.models import SecretaryResponse, SecretaryLevel


@pytest.mark.asyncio
async def test_chat_post(app, mock_runtime):
    mock_runtime.secretary.process_input = AsyncMock(
        return_value=SecretaryResponse(
            message="Hello Captain!", level=SecretaryLevel.L2
        )
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/chat",
            json={"message": "hello"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["response"] == "Hello Captain!"
        assert data["captain_id"] == "captain"


@pytest.mark.asyncio
async def test_chat_post_with_captain_id(app, mock_runtime):
    mock_runtime.secretary.process_input = AsyncMock(
        return_value=SecretaryResponse(
            message="Hello Captain!", level=SecretaryLevel.L2
        )
    )
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/chat",
            json={"message": "hello", "captain_id": "cap2"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["captain_id"] == "cap2"


@pytest.mark.asyncio
async def test_websocket_chat(app, mock_runtime):
    from cabinet.rooms.secretary.service import StreamingSecretaryResponse
    from starlette.testclient import TestClient

    async def fake_stream():
        yield "Hello"
        yield " Captain"

    async def fake_finalize():
        pass

    mock_runtime.secretary.process_input_stream = MagicMock(
        return_value=StreamingSecretaryResponse(stream=fake_stream(), finalize=fake_finalize)
    )

    client = TestClient(app)
    with client.websocket_connect("/api/chat/ws") as ws:
        ws.send_text("hello")
        chunks = []
        while True:
            data = ws.receive_json()
            if data.get("type") == "done":
                break
            if data.get("type") == "chunk":
                chunks.append(data["content"])
        assert len(chunks) == 2


@pytest.mark.asyncio
async def test_websocket_accepts_rbac_token(app, mock_runtime):
    from cabinet.core.auth import Role
    from cabinet.cli.config import ApiTokenEntry
    from cabinet.rooms.secretary.service import StreamingSecretaryResponse
    from starlette.testclient import TestClient

    mock_config = app.state.config
    mock_config.api_token = ""
    mock_config.auth_required = True
    mock_config.api_tokens = [
        ApiTokenEntry(
            token_hash=hashlib.sha256(b"rbac-token").hexdigest(),
            role=Role.VIEWER,
            label="test-viewer",
        )
    ]

    async def fake_stream():
        yield "Hi"

    async def fake_finalize():
        pass

    mock_runtime.secretary.process_input_stream = MagicMock(
        return_value=StreamingSecretaryResponse(stream=fake_stream(), finalize=fake_finalize)
    )

    client = TestClient(app)
    with client.websocket_connect("/api/chat/ws?token=rbac-token&captain_id=test") as ws:
        ws.send_text("hello")
        data = ws.receive_json()
        assert data["type"] in ("chunk", "done")
