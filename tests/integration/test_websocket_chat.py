from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from cabinet.rooms.secretary.service import StreamingSecretaryResponse


@pytest.mark.asyncio
async def test_websocket_chat_with_auth():
    from cabinet.api.app import create_app
    from starlette.testclient import TestClient

    mock_runtime = MagicMock()
    mock_runtime.start = AsyncMock()
    mock_runtime.stop = AsyncMock()

    async def fake_stream():
        yield "Hello"

    async def fake_finalize():
        pass

    mock_runtime.secretary = AsyncMock()
    mock_runtime.secretary.process_input_stream = MagicMock(
        return_value=StreamingSecretaryResponse(stream=fake_stream(), finalize=fake_finalize)
    )

    mock_config = MagicMock()
    mock_config.cors_origins = ["*"]
    mock_config.api_token = "test-token"
    mock_config.api_tokens = []
    mock_config.auth_required = True

    app = create_app(mock_runtime, mock_config)

    client = TestClient(app)
    with client.websocket_connect("/api/chat/ws?token=test-token") as ws:
        ws.send_text("hello")
        chunks = []
        while True:
            data = ws.receive_json()
            if data.get("type") == "done":
                break
            if data.get("type") == "chunk":
                chunks.append(data["content"])
        assert len(chunks) >= 1
