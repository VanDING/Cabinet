from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.designer.designer import DefaultDesigner
from cabinet.core.designer.protocol import DesignRequest
from cabinet.core.designer.template_store import TemplateStore
from cabinet.core.pipes.registry import PipeRegistry


@pytest.fixture
def mock_gateway():
    gw = AsyncMock()
    gw.complete.return_value.content = """```json
{
  "workflow": {
    "name": "测试流程",
    "nodes": [
      {"id": "n1", "kind": "trigger", "name": "start", "trigger_type": "manual"},
      {"id": "n2", "kind": "skill", "name": "test", "skill_id": "s1", "employee_id": "e1", "inputs": {}},
      {"id": "n3", "kind": "end", "name": "end"}
    ],
    "edges": [
      {"source_node_id": "n1", "target_node_id": "n2"},
      {"source_node_id": "n2", "target_node_id": "n3"}
    ]
  },
  "pipes": [
    {"name": "test", "description": "t", "kind": "atomic", "system_prompt": "test", "reasoning": {"temperature": 0.3}}
  ]
}
```"""
    return gw


@pytest.fixture
def designer(mock_gateway):
    registry = PipeRegistry()
    store = TemplateStore(pipe_registry=registry)
    return DefaultDesigner(gateway=mock_gateway, template_store=store, pipe_registry=registry)


@pytest.mark.asyncio
async def test_start_design_creates_session(designer):
    req = DesignRequest(description="搭建测试流程")
    session = await designer.start_design(req)
    assert session.status == "drafting"
    assert session.description == "搭建测试流程"
    assert session.draft_workflow is not None
    assert len(session.draft_pipes) >= 1


@pytest.mark.asyncio
async def test_refine_design_updates_workflow(designer):
    req = DesignRequest(description="初始流程")
    session = await designer.start_design(req)
    refined = await designer.refine_design(session.id, "在第一步后增加验证步骤")
    assert refined.status == "awaiting_confirm"
    assert len(refined.conversation_history) == 1
    assert refined.conversation_history[0]["role"] == "captain"


@pytest.mark.asyncio
async def test_confirm_design_changes_status(designer):
    req = DesignRequest(description="测试")
    session = await designer.start_design(req)
    confirmed = await designer.confirm_design(session.id)
    assert confirmed.status == "confirmed"


@pytest.mark.asyncio
async def test_reject_design_changes_status(designer):
    req = DesignRequest(description="测试")
    session = await designer.start_design(req)
    rejected = await designer.reject_design(session.id)
    assert rejected.status == "rejected"


@pytest.mark.asyncio
async def test_refine_nonexistent_session_raises(designer):
    with pytest.raises(KeyError):
        await designer.refine_design(uuid.uuid4(), "feedback")


@pytest.mark.asyncio
async def test_get_preview_returns_summary(designer):
    req = DesignRequest(description="测试")
    session = await designer.start_design(req)
    preview = await designer.get_preview(session.id)
    assert preview.session_id == session.id
    assert preview.node_count > 0
    assert len(preview.pipes) >= 1
