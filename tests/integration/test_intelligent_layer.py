# tests/integration/test_intelligent_layer.py
from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.designer.designer import DefaultDesigner
from cabinet.core.designer.protocol import DesignRequest
from cabinet.core.designer.template_store import TemplateStore
from cabinet.core.pipes.registry import PipeRegistry
from cabinet.rooms.summary.models import (
    AutonomyAudit,
    AutonomyRecommendation,
    RehearsalReport,
    ScenarioResult,
    SimilarCase,
)


@pytest.mark.asyncio
async def test_full_designer_to_confirm_flow():
    """端到端：Designer 生成草案 → 微调 → 确认"""
    registry = PipeRegistry()
    store = TemplateStore(pipe_registry=registry)
    mock_gw = AsyncMock()
    mock_gw.complete.return_value.content = """```json
{
  "workflow": {
    "name": "集成测试流程",
    "nodes": [
      {"id": "n1", "kind": "trigger", "name": "开始", "trigger_type": "manual"},
      {"id": "n2", "kind": "skill", "name": "数据分析", "skill_id": "s1", "employee_id": "e1", "inputs": {}},
      {"id": "n3", "kind": "end", "name": "结束"}
    ],
    "edges": [
      {"source_node_id": "n1", "target_node_id": "n2"},
      {"source_node_id": "n2", "target_node_id": "n3"}
    ]
  },
  "pipes": [
    {"name": "数据分析管道", "description": "t", "kind": "atomic", "system_prompt": "分析数据", "reasoning": {"temperature": 0.3}}
  ]
}"""

    designer = DefaultDesigner(gateway=mock_gw, template_store=store, pipe_registry=registry)

    # 1. Start design
    req = DesignRequest(description="搭建数据分析流程")
    session = await designer.start_design(req)
    assert session.status == "drafting"
    assert session.draft_workflow is not None

    # 2. Template search should work
    templates = await store.search("数据分析")
    assert isinstance(templates, list)

    # 3. Refine -> confirm
    refined = await designer.refine_design(session.id, "增加结果导出步骤")
    assert refined.status == "awaiting_confirm"

    confirmed = await designer.confirm_design(session.id)
    assert confirmed.status == "confirmed"


@pytest.mark.asyncio
async def test_designer_reject_flow():
    """端到端：拒绝设计"""
    registry = PipeRegistry()
    store = TemplateStore(pipe_registry=registry)
    mock_gw = AsyncMock()
    mock_gw.complete.return_value.content = '{"workflow": {"nodes": [], "edges": [], "name": "t"}, "pipes": []}'

    designer = DefaultDesigner(gateway=mock_gw, template_store=store, pipe_registry=registry)
    req = DesignRequest(description="test")
    session = await designer.start_design(req)
    rejected = await designer.reject_design(session.id)
    assert rejected.status == "rejected"


@pytest.mark.asyncio
async def test_summary_models_roundtrip():
    """验证 RehearsalReport 和 AutonomyAudit 的序列化往返"""
    report = RehearsalReport(
        decision_id=uuid.uuid4(),
        similar_cases=[
            SimilarCase(
                decision_id=uuid.uuid4(), title="test", decision_type="execution",
                outcome="approved", result_summary="ok", similarity_score=0.9,
            ),
        ],
        matched_risk_patterns=[],
        optimistic_scenario=ScenarioResult(
            scenario_type="optimistic", description="ok",
            key_assumptions=[], expected_outcome="ok", risks=[], probability=0.3,
        ),
        pessimistic_scenario=ScenarioResult(
            scenario_type="pessimistic", description="bad",
            key_assumptions=[], expected_outcome="bad", risks=["r1"], probability=0.4,
        ),
        baseline_scenario=ScenarioResult(
            scenario_type="baseline", description="normal",
            key_assumptions=[], expected_outcome="normal", risks=[], probability=0.3,
        ),
        risk_level="medium",
        recommendations=["建议分阶段执行"],
    )
    data = report.model_dump()
    restored = RehearsalReport.model_validate(data)
    assert restored.risk_level == report.risk_level
    assert len(restored.similar_cases) == 1
    assert restored.similar_cases[0].similarity_score == 0.9

    audit = AutonomyAudit(
        captain_id="c1",
        period="all",
        l0_total=10, l0_correct=9, l0_correct_rate=0.9,
        l1_total=5, l1_correct=4, l1_correct_rate=0.8,
        expand_autonomy_to=[
            AutonomyRecommendation(
                scenario="test", current_level="L2",
                total_decisions=10, correct_decisions=10,
                recommended_level="L1", reasoning="准确率100%",
            ),
        ],
    )
    audit_data = audit.model_dump()
    restored_audit = AutonomyAudit.model_validate(audit_data)
    assert restored_audit.l0_correct_rate == 0.9
    assert len(restored_audit.expand_autonomy_to) == 1


@pytest.mark.asyncio
async def test_secretary_models_roundtrip():
    """验证秘书新模型的序列化往返"""
    from cabinet.rooms.secretary.models import DailyBrief, ConflictAlert

    brief = DailyBrief(
        captain_id="c1", date="2026-05-09",
        active_projects=2, pending_decisions=1,
        key_progress=["项目A完成"], risk_alerts=["资源不足"],
    )
    data = brief.model_dump()
    restored = DailyBrief.model_validate(data)
    assert restored.active_projects == 2

    alert = ConflictAlert(
        alert_type="resource",
        projects_involved=[uuid.uuid4()],
        description="冲突",
        severity="critical",
        suggestion="建议",
    )
    alert_data = alert.model_dump()
    restored_alert = ConflictAlert.model_validate(alert_data)
    assert restored_alert.severity == "critical"
