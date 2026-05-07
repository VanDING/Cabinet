from uuid import uuid4

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from cabinet.api.app import create_app
from cabinet.cli.config import CabinetConfig
from cabinet.models.primitives import Organization
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def ws_mock_config():
    return CabinetConfig(
        organization=Organization(name="ws-test", captain_id="cap1"),
        default_project=uuid4(),
        api_token="ws-secret",
        auth_required=True,
    )


@pytest.fixture
def ws_mock_runtime():
    runtime = MagicMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()

    # Build a response that mirrors StreamingSecretaryResponse
    async def fake_stream():
        yield "Hello"

    async def fake_finalize():
        pass

    mock_response = MagicMock()
    mock_response.stream = fake_stream()
    mock_response.finalize = MagicMock(return_value=fake_finalize())

    runtime.secretary = MagicMock()
    runtime.secretary.process_input_stream = MagicMock(return_value=mock_response)
    return runtime


@pytest.fixture
def ws_client(ws_mock_runtime, ws_mock_config):
    app = create_app(ws_mock_runtime, ws_mock_config)
    return TestClient(app)


def test_websocket_invalid_token_rejected(ws_client):
    with pytest.raises(WebSocketDisconnect):
        with ws_client.websocket_connect("/api/chat/ws?token=bad-token") as ws:
            ws.receive_text()


def test_websocket_missing_token_rejected(ws_client):
    with pytest.raises(WebSocketDisconnect):
        with ws_client.websocket_connect("/api/chat/ws") as ws:
            ws.receive_text()


def test_websocket_client_disconnect_clean(ws_client):
    with ws_client.websocket_connect("/api/chat/ws?token=ws-secret") as ws:
        ws.send_text("hello")
        ws.close()
