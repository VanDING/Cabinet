from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from cabinet.core.harness.judge import (
    DEFAULT_JUDGE_RULES,
    DefaultExecutionJudge,
    ExecutionJudge,
    JudgeDecision,
)
from cabinet.models.workflows import ConditionNode, ParallelNode


@pytest.fixture
def judge_no_ai():
    return DefaultExecutionJudge(gateway=None)


@pytest.fixture
def condition_node():
    return ConditionNode(
        id=uuid.uuid4(),
        name="test_condition",
        expression="unknown_var > 0",
        true_next=uuid.uuid4(),
        false_next=uuid.uuid4(),
    )


@pytest.fixture
def parallel_node():
    return ParallelNode(
        id=uuid.uuid4(),
        name="test_parallel",
        branch_node_ids=[uuid.uuid4(), uuid.uuid4()],
    )


# ── L0 rule tests ──

@pytest.mark.asyncio
async def test_rule_retry_on_first_api_failure(judge_no_ai):
    decision = await judge_no_ai.judge_condition(
        None,
        {"scenario": "api_call_failed", "attempt": 1, "max_attempts": 3},
    )
    assert decision.level == "L0"
    assert decision.action == "retry"


@pytest.mark.asyncio
async def test_rule_extend_timeout_known_slow(judge_no_ai):
    decision = await judge_no_ai.handle_timeout(
        uuid.uuid4(), 30.0, {"known_slow_pattern": True}
    )
    assert decision.level == "L0"
    assert decision.action == "extend_timeout"


# ── L1 rule tests ──

@pytest.mark.asyncio
async def test_rule_choose_path_on_none_condition(judge_no_ai, condition_node):
    decision = await judge_no_ai.judge_condition(
        condition_node,
        {"scenario": "condition_eval_none", "expression": "unknown_var > 0"},
    )
    assert decision.level == "L1"
    assert decision.action == "choose_path"


@pytest.mark.asyncio
async def test_rule_skip_branch_if_not_required(judge_no_ai, parallel_node):
    branch_results = {
        "branch_1": {"output": "success"},
        "branch_2": {"error": "failed", "required_for_downstream": False},
    }
    decision = await judge_no_ai.resolve_parallel_conflict(parallel_node, branch_results)
    assert decision.level == "L1"
    assert decision.action == "skip_branch"


@pytest.mark.asyncio
async def test_rule_retry_branch_if_required(judge_no_ai, parallel_node):
    branch_results = {
        "branch_1": {"output": "success"},
        "branch_2": {"error": "failed", "required_for_downstream": True},
    }
    decision = await judge_no_ai.resolve_parallel_conflict(parallel_node, branch_results)
    assert decision.level == "L1"
    assert decision.action == "retry_branch"


@pytest.mark.asyncio
async def test_rule_choose_best_on_mild_contradiction(judge_no_ai, parallel_node):
    branch_results = {
        "branch_1": {"output": "result_a", "confidence": 0.9},
        "branch_2": {"output": "result_a_alt", "confidence": 0.6},
    }
    decision = await judge_no_ai.resolve_parallel_conflict(parallel_node, branch_results)
    assert decision.level == "L1"
    assert decision.action == "choose_best"


@pytest.mark.asyncio
async def test_rule_retry_once_on_unknown_timeout(judge_no_ai):
    decision = await judge_no_ai.handle_timeout(
        uuid.uuid4(), 30.0, {"known_slow_pattern": False}
    )
    assert decision.level == "L1"
    assert decision.action == "retry_once"


@pytest.mark.asyncio
async def test_rule_enqueue_low_priority_resource(judge_no_ai):
    decision = await judge_no_ai.handle_resource_contention(
        "gpu_pool", [uuid.uuid4(), uuid.uuid4()]
    )
    assert decision.level == "L1"
    assert decision.action == "enqueue"


# ── L2 rule tests ──

@pytest.mark.asyncio
async def test_rule_escalate_on_retry_exhausted(judge_no_ai):
    decision = await judge_no_ai.judge_condition(
        None,
        {"scenario": "api_call_failed", "attempt": 3, "max_attempts": 3},
    )
    assert decision.level == "L2"
    assert decision.action == "escalate"


@pytest.mark.asyncio
async def test_rule_escalate_on_fundamental_contradiction(judge_no_ai, parallel_node):
    branch_results = {
        "branch_1": {"output": "buy", "confidence": 0.95},
        "branch_2": {"output": "sell", "confidence": 0.92, "contradiction_type": "fundamental"},
    }
    decision = await judge_no_ai.resolve_parallel_conflict(parallel_node, branch_results)
    assert decision.level == "L2"
    assert decision.action == "escalate"


# ── L3 rule tests ──

@pytest.mark.asyncio
async def test_rule_l3_on_strategic_resource(judge_no_ai):
    decision = await judge_no_ai.handle_resource_contention(
        "budget_allocation", [uuid.uuid4()]
    )
    assert decision.level == "L3"
    assert decision.action == "escalate"


@pytest.mark.asyncio
async def test_rule_l3_on_auth_change(judge_no_ai):
    decision = await judge_no_ai.handle_resource_contention(
        "authorization_rules", [uuid.uuid4()]
    )
    assert decision.level == "L3"
    assert decision.action == "escalate"


# ── AI fallback tests ──

@pytest.mark.asyncio
async def test_ai_fallback_when_no_rule_matches():
    mock_gateway = AsyncMock()
    mock_response = AsyncMock()
    mock_response.content = '{"level": "L1", "action": "retry", "reasoning": "AI decided"}'
    mock_gateway.complete.return_value = mock_response

    judge = DefaultExecutionJudge(gateway=mock_gateway)
    decision = await judge.judge_condition(
        None,
        {"scenario": "unknown_scenario", "data": "something_never_seen"},
    )
    assert decision.level == "L1"
    assert decision.action == "retry"
    assert mock_gateway.complete.called


@pytest.mark.asyncio
async def test_conservative_fallback_when_no_gateway_and_no_rule(judge_no_ai):
    decision = await judge_no_ai.judge_condition(
        None,
        {"scenario": "unknown_scenario"},
    )
    assert decision.level == "L2"
    assert decision.action == "escalate"


@pytest.mark.asyncio
async def test_ai_fallback_bad_json_returns_conservative():
    mock_gateway = AsyncMock()
    mock_response = AsyncMock()
    mock_response.content = "not valid json"
    mock_gateway.complete.return_value = mock_response

    judge = DefaultExecutionJudge(gateway=mock_gateway)
    decision = await judge.handle_timeout(
        uuid.uuid4(), 60.0, {"known_slow_pattern": False, "scenario": "weird_timeout"},
    )
    assert decision.level == "L2"
    assert decision.action == "escalate"


# ── Protocol compliance ──

def test_default_execution_judge_satisfies_protocol():
    judge = DefaultExecutionJudge()
    assert isinstance(judge, ExecutionJudge)
