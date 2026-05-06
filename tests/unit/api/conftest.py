from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.fixture
def mock_config():
    config = MagicMock()
    config.cors_origins = ["*"]
    config.api_token = ""
    config.api_tokens = []
    config.auth_required = False
    return config


@pytest.fixture
def mock_runtime():
    runtime = MagicMock()
    runtime.start = AsyncMock()
    runtime.stop = AsyncMock()
    runtime.health_check = AsyncMock(return_value={
        "status": "healthy", "version": "0.1.0", "components": [], "uptime_seconds": 1.0,
    })
    runtime.agent_pool = MagicMock()
    runtime.agent_pool.health_check = AsyncMock(return_value={"total": 0})
    runtime.capability_registry = MagicMock()
    runtime.capability_registry.discover = AsyncMock(return_value=[])
    runtime.handoff_manager = MagicMock()
    runtime.handoff_manager.request_handoff = AsyncMock(return_value=None)
    runtime.mailbox_router = MagicMock()
    runtime.mailbox_router.get_mailbox = MagicMock(return_value=None)
    runtime.office = MagicMock()
    runtime.office.execute_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "completed"}),
    ))
    runtime.office.resume_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "completed"}),
    ))
    runtime.office.cancel_workflow = AsyncMock(return_value=MagicMock(
        model_dump=MagicMock(return_value={"status": "cancelled"}),
    ))
    runtime.office._executions = {}
    runtime.tool_registry = AsyncMock()
    runtime.tool_registry.list_skills = AsyncMock(return_value=[])
    runtime.tool_registry.execute = AsyncMock()
    runtime.secretary = AsyncMock()
    runtime.meeting = AsyncMock()
    runtime.decision = AsyncMock()
    runtime.strategy = AsyncMock()
    runtime.summary = AsyncMock()
    runtime.knowledge_base = AsyncMock()
    runtime.knowledge_base.query = AsyncMock(return_value=[])
    runtime.knowledge_base.index = AsyncMock()
    runtime.employee_store = AsyncMock()
    runtime.employee_store.list_all = AsyncMock(return_value=[])
    runtime.employee_store.add = AsyncMock()
    runtime.employee_store.get = AsyncMock(return_value=None)
    runtime.employee_store.mount_skill = AsyncMock()
    runtime.gateway = MagicMock()
    runtime.gateway.list_models = MagicMock(return_value=[])
    return runtime


@pytest.fixture
def app(mock_runtime, mock_config):
    from cabinet.api.app import create_app
    return create_app(mock_runtime, mock_config)


@pytest.fixture
def client(app):
    from httpx import ASGITransport, AsyncClient
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
