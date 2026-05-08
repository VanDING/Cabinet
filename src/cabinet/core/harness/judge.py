from __future__ import annotations

import json
from typing import Protocol, runtime_checkable
from uuid import UUID

from cabinet.core.harness.models import JudgeDecision

# ── Built-in rule table ──────────────────────────────────────────────

DEFAULT_JUDGE_RULES = [
    {
        "name": "API_RETRY_FIRST",
        "scenario": "api_call_failed",
        "condition": lambda ctx: ctx.get("attempt", 0) < ctx.get("max_attempts", 3),
        "level": "L0",
        "action": "retry",
        "reasoning": "首次 API 调用失败，完全可逆，自动重试",
    },
    {
        "name": "API_RETRY_EXHAUSTED",
        "scenario": "api_call_failed",
        "condition": lambda ctx: ctx.get("attempt", 0) >= ctx.get("max_attempts", 3),
        "level": "L2",
        "action": "escalate",
        "reasoning": "API 重试耗尽，需 Captain 决定是否继续等待",
    },
    {
        "name": "CONDITION_EVAL_NONE",
        "scenario": "condition_eval_none",
        "condition": lambda ctx: True,
        "level": "L1",
        "action": "choose_path",
        "reasoning": "条件表达式返回 None，基于上下文推理最可能路径",
    },
    {
        "name": "BRANCH_FAILED_NOT_REQUIRED",
        "scenario": "parallel_branch_failed",
        "condition": lambda ctx: not ctx.get("required_for_downstream", True),
        "level": "L1",
        "action": "skip_branch",
        "reasoning": "失败分支不被下游依赖，跳过继续执行",
    },
    {
        "name": "BRANCH_FAILED_REQUIRED",
        "scenario": "parallel_branch_failed",
        "condition": lambda ctx: ctx.get("required_for_downstream", True),
        "level": "L1",
        "action": "retry_branch",
        "reasoning": "失败分支被下游依赖，重试该分支",
    },
    {
        "name": "BRANCH_MILD_CONTRADICTION",
        "scenario": "parallel_contradiction",
        "condition": lambda ctx: ctx.get("contradiction_type") != "fundamental",
        "level": "L1",
        "action": "choose_best",
        "reasoning": "分支输出轻微不一致，选择置信度更高的结果",
    },
    {
        "name": "BRANCH_FUNDAMENTAL_CONTRADICTION",
        "scenario": "parallel_contradiction",
        "condition": lambda ctx: ctx.get("contradiction_type") == "fundamental",
        "level": "L2",
        "action": "escalate",
        "reasoning": "分支输出存在根本性矛盾，需 Captain 裁决",
    },
    {
        "name": "TIMEOUT_KNOWN_SLOW",
        "scenario": "node_timeout",
        "condition": lambda ctx: ctx.get("known_slow_pattern", False),
        "level": "L0",
        "action": "extend_timeout",
        "reasoning": "已知慢操作模式，延长等待",
    },
    {
        "name": "TIMEOUT_UNKNOWN",
        "scenario": "node_timeout",
        "condition": lambda ctx: not ctx.get("known_slow_pattern", False),
        "level": "L1",
        "action": "retry_once",
        "reasoning": "未知原因超时，重试一次后判断",
    },
    {
        "name": "RESOURCE_LOW_PRIORITY",
        "scenario": "resource_contention",
        "condition": lambda ctx: ctx.get("resource_type") not in (
            "budget_allocation", "authorization_rules"
        ),
        "level": "L1",
        "action": "enqueue",
        "reasoning": "低优先级资源竞争，自动排队",
    },
    {
        "name": "RESOURCE_STRATEGIC",
        "scenario": "resource_contention",
        "condition": lambda ctx: ctx.get("resource_type") in (
            "budget_allocation", "authorization_rules"
        ),
        "level": "L3",
        "action": "escalate",
        "reasoning": "涉及预算或授权规则的资源竞争，必须升级",
    },
]

AI_CLASSIFY_PROMPT = """你是 Cabinet 系统的执行判断模块。根据场景信息，将决策分为四级：
  L0 - 可自动执行，完全可逆，不影响其他节点
  L1 - 可自主判断，事后通知，工作流内可回退
  L2 - 需 Captain 确认，影响其他工作流或难以逆转
  L3 - 必须升级，影响组织级配置或 Captain 决策权

请返回 JSON: {"level": "L0"|"L1"|"L2"|"L3", "action": "...", "reasoning": "..."}"""


# ── Protocol ──────────────────────────────────────────────────

@runtime_checkable
class ExecutionJudge(Protocol):
    async def judge_condition(self, node, context: dict) -> JudgeDecision: ...
    async def resolve_parallel_conflict(self, node, branch_results: dict) -> JudgeDecision: ...
    async def handle_timeout(self, node_id: UUID, elapsed: float, context: dict) -> JudgeDecision: ...
    async def handle_resource_contention(self, resource_id: str, contenders: list[UUID]) -> JudgeDecision: ...


# ── Default implementation ────────────────────────────────────

class DefaultExecutionJudge:
    def __init__(self, gateway=None):
        self._rules = DEFAULT_JUDGE_RULES
        self._gateway = gateway

    async def judge_condition(self, node, context: dict) -> JudgeDecision:
        # 1. Rule table lookup — honor the context's own scenario key
        scenario = context.get("scenario", "")
        if scenario and (rule := self._match_rule(scenario, context)):
            return rule
        # 2. AI fallback
        if self._gateway:
            return await self._ai_classify("condition_ambiguous", context)
        # 3. Conservative
        return JudgeDecision(level="L2", action="escalate", reasoning="无匹配规则且无 AI 网关")

    async def resolve_parallel_conflict(self, node, branch_results: dict) -> JudgeDecision:
        context = self._extract_parallel_context(branch_results)
        scenario = context.get("scenario", "")
        if scenario and (rule := self._match_rule(scenario, context)):
            return rule
        if self._gateway:
            return await self._ai_classify("parallel_conflict", context)
        return JudgeDecision(level="L2", action="escalate", reasoning="并行分支异常且无法自动判断")

    async def handle_timeout(self, node_id: UUID, elapsed: float, context: dict) -> JudgeDecision:
        ctx = dict(context)
        ctx.setdefault("known_slow_pattern", False)
        # Only apply timeout rules when scenario is node_timeout or unset
        if ctx.get("scenario", "node_timeout") == "node_timeout":
            if rule := self._match_rule("node_timeout", ctx):
                return rule
        if self._gateway:
            return await self._ai_classify("node_timeout", ctx)
        return JudgeDecision(level="L2", action="escalate", reasoning="节点超时且无法自动判断")

    async def handle_resource_contention(self, resource_id: str, contenders: list[UUID]) -> JudgeDecision:
        resource_type = (
            "budget_allocation" if "budget" in resource_id.lower()
            else "authorization_rules" if "auth" in resource_id.lower()
            else "general"
        )
        ctx = {"resource_type": resource_type, "contender_count": len(contenders)}
        if rule := self._match_rule("resource_contention", ctx):
            return rule
        if self._gateway:
            return await self._ai_classify("resource_contention", ctx)
        return JudgeDecision(level="L2", action="escalate", reasoning="资源竞争且无法自动判断")

    # ── Internal ────────────────────────────────────────────

    def _match_rule(self, scenario: str, context: dict) -> JudgeDecision | None:
        for rule in self._rules:
            if rule["scenario"] == scenario:
                try:
                    if rule["condition"](context):
                        return JudgeDecision(
                            level=rule["level"],
                            action=rule["action"],
                            reasoning=rule["reasoning"],
                        )
                except Exception:
                    continue
        return None

    async def _ai_classify(self, scenario: str, context: dict) -> JudgeDecision:
        response = await self._gateway.complete(
            messages=[
                {"role": "system", "content": AI_CLASSIFY_PROMPT},
                {"role": "user", "content": f"场景：{scenario}\n上下文：{json.dumps(context, default=str)}"},
            ],
            model="fast",
            temperature=0.1,
        )
        try:
            data = json.loads(response.content)
            return JudgeDecision(
                level=data.get("level", "L2"),
                action=data.get("action", "escalate"),
                reasoning=data.get("reasoning", "AI 判断"),
            )
        except (json.JSONDecodeError, KeyError):
            return JudgeDecision(level="L2", action="escalate", reasoning="AI 判断解析失败，升级处理")

    @staticmethod
    def _extract_parallel_context(branch_results: dict) -> dict:
        ctx: dict = {}
        outputs = set()
        for key, val in branch_results.items():
            if isinstance(val, dict):
                if "error" in val:
                    ctx.setdefault("scenario", "parallel_branch_failed")
                    ctx["required_for_downstream"] = val.get("required_for_downstream", True)
                if "contradiction_type" in val:
                    ctx.setdefault("scenario", "parallel_contradiction")
                    ctx["contradiction_type"] = val["contradiction_type"]
                if "output" in val:
                    outputs.add(val["output"])
        ctx.setdefault("scenario", "parallel_branch_failed")
        # If no branch errors but outputs differ, treat as contradiction
        if "required_for_downstream" not in ctx and len(outputs) > 1:
            ctx["scenario"] = "parallel_contradiction"
        return ctx
