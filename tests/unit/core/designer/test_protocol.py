from __future__ import annotations

import uuid

from cabinet.core.designer.protocol import (
    DesignPreview,
    DesignRequest,
    DesignSession,
    DesignerProtocol,
    PipeSummary,
)


def test_design_request_creation():
    req = DesignRequest(
        description="搭建招聘流程",
        project_id=uuid.uuid4(),
    )
    assert req.description == "搭建招聘流程"
    assert req.preferred_templates == []


def test_design_session_defaults():
    session = DesignSession(
        captain_id="captain-1",
        description="构建数据分析管道",
    )
    assert session.status == "drafting"
    assert session.matched_templates == []
    assert session.draft_workflow is None
    assert session.draft_pipes == []
    assert session.conversation_history == []
    assert session.id is not None


def test_design_session_status_transitions():
    session = DesignSession(
        captain_id="captain-1",
        description="test",
        status="awaiting_confirm",
    )
    assert session.status == "awaiting_confirm"


def test_design_preview_fields():
    preview = DesignPreview(
        session_id=uuid.uuid4(),
        workflow_summary="3 个步骤",
        node_count=3,
        pipes=[
            PipeSummary(name="简历解析", description="解析简历", kind="atomic", assigned_to_node="node-1"),
        ],
        suggestions=["建议在面试后增加背景调查环节"],
    )
    assert preview.node_count == 3
    assert len(preview.pipes) == 1
    assert len(preview.suggestions) == 1


def test_designer_protocol_has_methods():
    assert hasattr(DesignerProtocol, "start_design")
    assert hasattr(DesignerProtocol, "refine_design")
    assert hasattr(DesignerProtocol, "get_preview")
    assert hasattr(DesignerProtocol, "confirm_design")
    assert hasattr(DesignerProtocol, "reject_design")


def test_pipe_summary_model():
    summary = PipeSummary(
        name="数据分析管道",
        description="分析数据",
        kind="atomic",
        assigned_to_node="node-1",
    )
    assert summary.kind == "atomic"
    assert summary.assigned_to_node == "node-1"
