import uuid
from datetime import datetime

from cabinet.core.harness.models import (
    EvaluationResult,
    EscalationVerdict,
    GateResult,
    JudgeDecision,
    JudgeLog,
)


def test_evaluation_result_passed():
    result = EvaluationResult(passed=True, score=0.95)
    assert result.passed is True
    assert result.score == 0.95
    assert result.issues == []
    assert result.suggestions == []


def test_evaluation_result_failed_with_issues():
    result = EvaluationResult(
        passed=False,
        score=0.3,
        issues=["Missing required field", "Invalid format"],
        suggestions=["Add the 'name' field", "Use ISO 8601 date format"],
    )
    assert result.passed is False
    assert len(result.issues) == 2
    assert len(result.suggestions) == 2


def test_gate_result_passed():
    result = GateResult(passed=True)
    assert result.passed is True
    assert result.reason is None
    assert result.retry_allowed is True


def test_gate_result_failed_with_reason():
    result = GateResult(
        passed=False,
        reason="Output quality below threshold",
        retry_allowed=False,
    )
    assert result.passed is False
    assert result.reason == "Output quality below threshold"
    assert result.retry_allowed is False


def test_escalation_verdict_escalate():
    verdict = EscalationVerdict(
        escalate=True,
        reason="High-risk operation detected",
    )
    assert verdict.escalate is True
    assert verdict.auto_action is None


def test_escalation_verdict_no_escalate_with_auto_action():
    verdict = EscalationVerdict(
        escalate=False,
        reason="Known anomaly pattern, auto-retry",
        auto_action="retry_with_backoff",
    )
    assert verdict.escalate is False
    assert verdict.auto_action == "retry_with_backoff"


def test_judge_decision_l0_retry():
    d = JudgeDecision(
        level="L0",
        action="retry",
        reasoning="第一次重试，完全可逆",
    )
    assert d.level == "L0"
    assert d.action == "retry"
    assert d.suggestion is None
    assert d.fallback is None


def test_judge_decision_l2_escalate_with_suggestion():
    d = JudgeDecision(
        level="L2",
        action="escalate",
        reasoning="重试耗尽，需要 Captain 决定",
        suggestion="API 调用连续失败 3 次，建议切换备用 API",
    )
    assert d.level == "L2"
    assert d.suggestion is not None
    assert "备用 API" in d.suggestion


def test_judge_decision_l3_must_escalate():
    d = JudgeDecision(
        level="L3",
        action="escalate",
        reasoning="涉及预算调整",
        fallback={"budget_line": "marketing_q4"},
    )
    assert d.level == "L3"
    assert d.fallback is not None
    assert d.fallback["budget_line"] == "marketing_q4"


def test_judge_decision_all_levels():
    for level in ["L0", "L1", "L2", "L3"]:
        d = JudgeDecision(level=level, action="retry", reasoning="test")
        assert d.level == level


def test_judge_log_creation():
    log = JudgeLog(
        node_id=uuid.uuid4(),
        scenario="condition_ambiguous",
        rule_triggered="DEFAULT_CONDITION_AMBIGUOUS",
        level="L1",
        action="choose_path",
        reasoning="基于上下文推理最可能路径",
        timestamp=datetime.utcnow(),
    )
    assert log.scenario == "condition_ambiguous"
    assert log.rule_triggered == "DEFAULT_CONDITION_AMBIGUOUS"


def test_judge_log_ai_fallback():
    log = JudgeLog(
        node_id=uuid.uuid4(),
        scenario="parallel_conflict",
        rule_triggered="ai_fallback",
        level="L2",
        action="escalate",
        reasoning="AI 判断为根本性冲突",
        timestamp=datetime.utcnow(),
    )
    assert log.rule_triggered == "ai_fallback"
