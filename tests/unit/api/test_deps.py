import logging

import pytest


@pytest.mark.asyncio
async def test_audit_failure_logs_warning(caplog):
    from unittest.mock import AsyncMock, MagicMock

    from cabinet.api.deps import get_current_user
    from fastapi.security import HTTPAuthorizationCredentials

    mock_request = MagicMock()
    mock_request.app.state.config.api_token = "test-token"
    mock_request.client.host = "127.0.0.1"

    mock_runtime = MagicMock()
    mock_audit = AsyncMock()
    mock_audit.log = AsyncMock(side_effect=RuntimeError("DB locked"))
    mock_runtime._audit_store = mock_audit
    mock_request.app.state.runtime = mock_runtime

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="test-token")

    with caplog.at_level(logging.WARNING):
        result = await get_current_user(credentials, mock_request)

    assert result == {"role": "admin", "token_label": "legacy"}
    assert any("audit" in r.message.lower() for r in caplog.records)


@pytest.mark.asyncio
async def test_get_current_user_handles_hashed_api_token():
    from unittest.mock import MagicMock
    from cabinet.api.deps import get_current_user
    from fastapi.security import HTTPAuthorizationCredentials
    import hashlib

    mock_request = MagicMock()
    token_hash = hashlib.sha256(b"my-token").hexdigest()
    mock_request.app.state.config.api_token = f"sha256:{token_hash}"
    mock_request.app.state.config.api_tokens = []
    mock_request.app.state.config.auth_required = True
    mock_request.client = None

    mock_runtime = MagicMock()
    mock_runtime._audit_store = None
    mock_request.app.state.runtime = mock_runtime

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="my-token")
    result = await get_current_user(credentials, mock_request)
    assert result["role"] == "admin"
    assert result["token_label"] == "legacy"


@pytest.mark.asyncio
async def test_get_current_user_rejects_wrong_token_with_hashed_api_token():
    from unittest.mock import MagicMock
    from cabinet.api.deps import get_current_user
    from fastapi.security import HTTPAuthorizationCredentials
    from fastapi import HTTPException
    import hashlib

    mock_request = MagicMock()
    token_hash = hashlib.sha256(b"correct-token").hexdigest()
    mock_request.app.state.config.api_token = f"sha256:{token_hash}"
    mock_request.app.state.config.api_tokens = []
    mock_request.app.state.config.auth_required = True
    mock_request.client = None

    mock_runtime = MagicMock()
    mock_runtime._audit_store = None
    mock_request.app.state.runtime = mock_runtime

    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="wrong-token")
    with pytest.raises(HTTPException):
        await get_current_user(credentials, mock_request)
