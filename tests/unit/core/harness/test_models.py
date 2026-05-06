from cabinet.core.harness.models import EvaluationResult, EscalationVerdict, GateResult


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
