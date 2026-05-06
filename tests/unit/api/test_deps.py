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
