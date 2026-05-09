import uuid

from cabinet.rooms.summary.models import (
    AuthorizationAudit,
    AutonomyAudit,
    AutonomyRecommendation,
    DecisionTree,
    DecisionTreeNode,
    ImprovementSuggestion,
    Insight,
    MemoryMatch,
    RehearsalReport,
    ReviewSession,
    ReviewType,
    RiskPattern,
    ScenarioResult,
    SimilarCase,
)


def test_review_type_values():
    assert ReviewType.PROJECT_REVIEW == "project_review"
    assert ReviewType.ORG_OPTIMIZATION == "org_optimization"
    assert ReviewType.CAPTAIN_INSIGHT == "captain_insight"


def test_review_session_creation():
    proj_id = uuid.uuid4()
    session = ReviewSession(
        project_id=proj_id,
        review_type=ReviewType.PROJECT_REVIEW,
    )
    assert session.status == "in_progress"
    assert session.completed_at is None


def test_review_session_completed():
    from datetime import datetime, timezone
    proj_id = uuid.uuid4()
    now = datetime.now(timezone.utc)
    session = ReviewSession(
        project_id=proj_id,
        review_type=ReviewType.ORG_OPTIMIZATION,
        status="completed",
        completed_at=now,
    )
    assert session.status == "completed"
    assert session.completed_at is not None


def test_insight_auto_applicable():
    session_id = uuid.uuid4()
    insight = Insight(
        session_id=session_id,
        insight_type="prompt_optimization",
        content="Improve the resume parsing prompt",
        confidence=0.85,
        auto_applicable=True,
        requires_captain=False,
    )
    assert insight.auto_applicable is True
    assert insight.requires_captain is False


def test_insight_requires_captain():
    session_id = uuid.uuid4()
    insight = Insight(
        session_id=session_id,
        insight_type="skill_suggestion",
        content="Consider adding email drafting skill",
        confidence=0.7,
        auto_applicable=False,
        requires_captain=True,
    )
    assert insight.auto_applicable is False
    assert insight.requires_captain is True


def test_decision_tree_node_root():
    node = DecisionTreeNode(
        node_type="root",
        label="Project Start",
    )
    assert node.node_type == "root"
    assert node.decision_id is None
    assert node.outcome is None
    assert node.children == []


def test_decision_tree_node_decision():
    decision_id = uuid.uuid4()
    child_id = uuid.uuid4()
    node = DecisionTreeNode(
        node_type="decision",
        label="Market Expansion",
        decision_id=decision_id,
        outcome="approved",
        children=[child_id],
    )
    assert node.outcome == "approved"
    assert len(node.children) == 1


def test_decision_tree():
    proj_id = uuid.uuid4()
    root = DecisionTreeNode(node_type="root", label="Start")
    child = DecisionTreeNode(node_type="decision", label="Decide", children=[])
    root.children.append(child.id)
    tree = DecisionTree(
        project_id=proj_id,
        root_node_id=root.id,
        nodes={root.id: root, child.id: child},
    )
    assert tree.root_node_id == root.id
    assert len(tree.nodes) == 2


def test_improvement_suggestion():
    session_id = uuid.uuid4()
    suggestion = ImprovementSuggestion(
        session_id=session_id,
        category="workflow",
        description="Parallelize resume screening steps",
        impact="high",
        effort="medium",
        auto_applicable=False,
    )
    assert suggestion.category == "workflow"
    assert suggestion.impact == "high"
    assert suggestion.auto_applicable is False


def test_authorization_audit():
    audit = AuthorizationAudit(
        captain_id="captain-1",
        period="2026-05",
        total_decisions=45,
        manually_approved=30,
        could_auto_process=12,
        suggestion="Consider adjusting authorization rules for execution decisions",
    )
    assert audit.total_decisions == 45
    assert audit.manually_approved == 30
    assert audit.could_auto_process == 12
    assert audit.suggestion is not None


def test_authorization_audit_no_suggestion():
    audit = AuthorizationAudit(
        captain_id="captain-1",
        period="2026-05",
        total_decisions=10,
        manually_approved=2,
        could_auto_process=0,
    )
    assert audit.suggestion is None


def test_similar_case_creation():
    case = SimilarCase(
        decision_id=uuid.uuid4(),
        title="增加 Q4 营销预算 25%",
        decision_type="strategic",
        outcome="approved",
        result_summary="ROAS 下降 15%",
        similarity_score=0.82,
    )
    assert case.similarity_score == 0.82


def test_risk_pattern_creation():
    pattern = RiskPattern(
        pattern_name="Q4预算增幅>20%→现金流紧张",
        description="第四季度大幅增加预算通常导致现金流紧张",
        matched_conditions=["预算增幅 30% > 阈值 20%", "当前为 Q4"],
        historical_occurrence_count=3,
        severity="critical",
    )
    assert pattern.historical_occurrence_count == 3


def test_scenario_result_creation():
    result = ScenarioResult(
        scenario_type="pessimistic",
        description="渠道成本上浮 20%",
        key_assumptions=["渠道成本季节性上涨"],
        expected_outcome="预算使用率不足 70%",
        risks=["现金流紧张"],
        probability=0.45,
    )
    assert result.scenario_type == "pessimistic"
    assert result.probability == 0.45


def test_rehearsal_report_creation():
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
            key_assumptions=[], expected_outcome="bad", risks=["风险1"], probability=0.4,
        ),
        baseline_scenario=ScenarioResult(
            scenario_type="baseline", description="normal",
            key_assumptions=[], expected_outcome="normal", risks=[], probability=0.3,
        ),
        risk_level="medium",
        recommendations=["分阶段执行"],
    )
    assert report.risk_level == "medium"
    assert len(report.similar_cases) == 1


def test_memory_match_creation():
    match = MemoryMatch(
        memory_id=uuid.uuid4(),
        content="上次招聘项目时，技术笔试环节筛掉了 60% 的候选人",
        source="insight",
        relevance_score=0.75,
        project_context="招聘项目 Alpha",
    )
    assert match.source == "insight"


def test_autonomy_audit_creation():
    audit = AutonomyAudit(
        captain_id="captain-1",
        period="2026-Q1",
        l0_total=100, l0_correct=98, l0_correct_rate=0.98,
        l1_total=50, l1_correct=42, l1_correct_rate=0.84,
        expand_autonomy_to=[
            AutonomyRecommendation(
                scenario="api_call_failed", current_level="L2",
                total_decisions=20, correct_decisions=20,
                recommended_level="L1", reasoning="准确率 100%",
            ),
        ],
        restrict_autonomy_from=[],
    )
    assert audit.l0_correct_rate == 0.98
    assert len(audit.expand_autonomy_to) == 1


def test_autonomy_recommendation_restrict():
    rec = AutonomyRecommendation(
        scenario="parallel_contradiction", current_level="L1",
        total_decisions=15, correct_decisions=9,
        recommended_level="L2", reasoning="准确率仅 60%",
    )
    assert rec.recommended_level == "L2"
